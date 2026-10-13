const crypto = require('node:crypto');
const config = require('../config');
const { getDb, withTransaction, newId, nowIso } = require('../db');
const {
  checkRateLimit,
  hashPassword,
  verifyPassword,
  createSession,
  computeEffectivePermissions
} = require('../auth');
const { logAudit } = require('../audit');

function slugify(text) {
  const base = String(text || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function getRedirectForRole(role) {
  if (role === 'owner') return '/dashboard';
  if (role === 'manager') return '/dashboard';
  return '/my-tasks';
}

function buildAuthPayload(db, userId, companyId, token) {
  const user = db.prepare(`
    SELECT id, email, full_name, phone, avatar_url, preferred_language, preferred_theme, must_change_password, created_at
    FROM users WHERE id = ?
  `).get(userId);
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const settings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId);
  const membership = db.prepare(`
    SELECT m.*, d.name AS department_name
    FROM company_memberships m
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE m.company_id = ? AND m.user_id = ?
  `).get(companyId, userId);

  const permissions = computeEffectivePermissions(membership.role, membership.permissions_json);
  const unreadRow = db.prepare(
    'SELECT COUNT(*) AS cnt FROM notifications WHERE company_id = ? AND user_id = ? AND is_read = 0'
  ).get(companyId, userId);

  return {
    token,
    redirect_to: getRedirectForRole(membership.role),
    user,
    company,
    settings,
    membership,
    permissions,
    unread_notifications: unreadRow ? Number(unreadRow.cnt) : 0
  };
}

function handleAuthRoutes(req, res, { pathname, body, auth, sendJson, getClientIp }) {
  const db = getDb();

  // POST /api/auth/register
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const ip = getClientIp(req);
    if (!checkRateLimit(`register:${ip}`)) {
      return sendJson(res, 429, { error: 'Too many registration attempts. Please try again later.' });
    }

    const companyName = String(body.company_name || '').trim();
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirm_password !== undefined ? body.confirm_password : password);

    if (!companyName || !fullName || !email || !password) {
      return sendJson(res, 400, { error: 'All registration fields (company_name, full_name, email, password) are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Invalid business email address.' });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters long.' });
    }
    if (password !== confirmPassword) {
      return sendJson(res, 400, { error: 'Password and confirm password do not match.' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return sendJson(res, 409, { error: 'An account with this email address already exists.' });
    }

    const result = withTransaction(() => {
      const now = nowIso();
      const companyId = newId('cmp');
      const userId = newId('usr');
      const membershipId = newId('mem');
      const slug = slugify(companyName);
      const passwordHash = hashPassword(password);

      db.prepare(`
        INSERT INTO companies (
          id, name, slug, owner_user_id, setup_wizard_completed,
          subscription_plan, subscription_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 'free_trial', 'active', ?, ?)
      `).run(companyId, companyName, slug, userId, now, now);

      db.prepare(`
        INSERT INTO company_settings (
          company_id, timezone, week_start_day, default_language, updated_at
        ) VALUES (?, 'Asia/Riyadh', 'sunday', 'ar', ?)
      `).run(companyId, now);

      // Seed company default roles
      const insertRole = db.prepare(`
        INSERT INTO roles (id, company_id, code, name_ar, name_en, default_permissions_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertRole.run(newId('rol'), companyId, 'owner', 'مالك الشركة / المدير العام', 'Company Owner / Admin', JSON.stringify(config.defaultRolePermissions.owner), now);
      insertRole.run(newId('rol'), companyId, 'manager', 'مدير فريق / مشرف', 'Manager / Team Leader', JSON.stringify(config.defaultRolePermissions.manager), now);
      insertRole.run(newId('rol'), companyId, 'employee', 'موظف', 'Employee', JSON.stringify(config.defaultRolePermissions.employee), now);

      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, full_name, preferred_language, preferred_theme, must_change_password, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
      `).run(userId, email, passwordHash, fullName, now, now);

      db.prepare(`
        INSERT INTO company_memberships (
          id, company_id, user_id, employee_code, job_title, role, status, permissions_json, joined_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'EMP-001', 'Company Owner', 'owner', 'active', ?, ?, ?, ?)
      `).run(
        membershipId,
        companyId,
        userId,
        JSON.stringify(config.defaultRolePermissions.owner),
        now.slice(0, 10),
        now,
        now
      );

      logAudit({
        companyId,
        actorUserId: userId,
        action: 'company.registered',
        entityType: 'company',
        entityId: companyId,
        newValues: { company_name: companyName, owner_email: email }
      });

      const session = createSession(userId, companyId);
      return buildAuthPayload(db, userId, companyId, session.token);
    });

    res.setHeader('Set-Cookie', `wf_session=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlHours * 3600}`);
    return sendJson(res, 201, result);
  }

  // POST /api/auth/login
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const requestedCompanyId = body.company_id ? String(body.company_id) : null;
    const ip = getClientIp(req);

    if (!checkRateLimit(`login:${ip}:${email}`)) {
      return sendJson(res, 429, { error: 'Too many login attempts. Please wait before trying again.' });
    }

    if (!email || !password) {
      return sendJson(res, 400, { error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendJson(res, 401, { error: 'Invalid email or password.' });
    }

    const memberships = db.prepare(`
      SELECT m.*, c.name AS company_name
      FROM company_memberships m
      JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = ?
      ORDER BY m.created_at DESC
    `).all(user.id);

    if (!memberships.length) {
      return sendJson(res, 403, { error: 'No workspace membership found for this account.' });
    }

    let chosenMembership = requestedCompanyId
      ? memberships.find((m) => m.company_id === requestedCompanyId)
      : memberships.find((m) => m.status === 'active') || memberships[0];

    if (!chosenMembership) {
      return sendJson(res, 403, { error: 'You are not a member of the requested workspace.' });
    }

    if (chosenMembership.status !== 'active') {
      return sendJson(res, 403, { error: 'Your account has been deactivated by the company administrator.' });
    }

    const session = createSession(user.id, chosenMembership.company_id);
    const payload = buildAuthPayload(db, user.id, chosenMembership.company_id, session.token);

    res.setHeader('Set-Cookie', `wf_session=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlHours * 3600}`);
    return sendJson(res, 200, payload);
  }

  // POST /api/auth/logout
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    if (auth && auth.token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.token);
    }
    res.setHeader('Set-Cookie', 'wf_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/auth/me
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    if (!auth) {
      return sendJson(res, 401, { error: 'Authentication required.' });
    }
    const payload = buildAuthPayload(db, auth.user.id, auth.company.id, auth.token);
    return sendJson(res, 200, payload);
  }

  // PUT /api/auth/profile
  if (req.method === 'PUT' && pathname === '/api/auth/profile') {
    if (!auth) {
      return sendJson(res, 401, { error: 'Authentication required.' });
    }
    const fullName = body.full_name !== undefined ? String(body.full_name).trim() : auth.user.full_name;
    const phone = body.phone !== undefined ? String(body.phone).trim() : auth.user.phone;
    const avatarUrl = body.avatar_url !== undefined ? String(body.avatar_url).trim() : auth.user.avatar_url;
    const preferredLanguage = body.preferred_language || auth.user.preferred_language || 'ar';
    const preferredTheme = body.preferred_theme || auth.user.preferred_theme || 'light';

    if (!fullName) {
      return sendJson(res, 400, { error: 'Full name cannot be empty.' });
    }

    if (body.new_password) {
      const newPassword = String(body.new_password);
      if (newPassword.length < 6) {
        return sendJson(res, 400, { error: 'New password must be at least 6 characters.' });
      }
      if (body.current_password) {
        const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(auth.user.id);
        if (!verifyPassword(String(body.current_password), dbUser.password_hash)) {
          return sendJson(res, 400, { error: 'Current password is incorrect.' });
        }
      }
      const newHash = hashPassword(newPassword);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        .run(newHash, nowIso(), auth.user.id);
    }

    db.prepare(`
      UPDATE users
      SET full_name = ?, phone = ?, avatar_url = ?, preferred_language = ?, preferred_theme = ?, updated_at = ?
      WHERE id = ?
    `).run(fullName, phone, avatarUrl, preferredLanguage, preferredTheme, nowIso(), auth.user.id);

    logAudit({
      companyId: auth.company.id,
      actorUserId: auth.user.id,
      action: 'profile.updated',
      entityType: 'user',
      entityId: auth.user.id,
      newValues: { full_name: fullName, has_avatar: Boolean(avatarUrl) }
    });

    const payload = buildAuthPayload(db, auth.user.id, auth.company.id, auth.token);
    return sendJson(res, 200, payload);
  }

  // POST /api/auth/forgot-password
  if (req.method === 'POST' && pathname === '/api/auth/forgot-password') {
    const email = String(body.email || '').trim().toLowerCase();
    const ip = getClientIp(req);
    if (!checkRateLimit(`forgot:${ip}`)) {
      return sendJson(res, 429, { error: 'Too many password reset requests. Please try again later.' });
    }
    if (!email) {
      return sendJson(res, 400, { error: 'Email address is required.' });
    }

    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    let devResetInfo = null;

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const now = nowIso();
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      db.prepare(`
        INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(newId('rst'), user.id, token, expiresAt, now);

      if (config.isDev && !config.smtpConfigured) {
        devResetInfo = {
          dev_mode_notice: 'Email provider (SMTP) is not configured. Use this safe development reset token/URL to test password reset.',
          dev_reset_token: token,
          dev_reset_url: `#/reset-password?token=${token}`
        };
      }
    }

    return sendJson(res, 200, {
      message: 'If an account with that email exists, password reset instructions have been prepared.',
      ...(devResetInfo || {})
    });
  }

  // POST /api/auth/reset-password
  if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
    const token = String(body.token || '').trim();
    const newPassword = String(body.password || '');

    if (!token || !newPassword) {
      return sendJson(res, 400, { error: 'Reset token and new password are required.' });
    }
    if (newPassword.length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters long.' });
    }

    const resetRow = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
    if (!resetRow || resetRow.used_at) {
      return sendJson(res, 400, { error: 'Invalid or already used password reset token.' });
    }
    if (new Date(resetRow.expires_at).getTime() <= Date.now()) {
      return sendJson(res, 400, { error: 'Password reset token has expired.' });
    }

    const now = nowIso();
    const passwordHash = hashPassword(newPassword);
    withTransaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        .run(passwordHash, now, resetRow.user_id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?')
        .run(now, resetRow.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
    });

    return sendJson(res, 200, { ok: true, message: 'Password has been reset successfully. You may now log in.' });
  }

  // GET /api/auth/invite/:token
  const inviteMatch = pathname.match(/^\/api\/auth\/invite\/([^/]+)$/);
  if (req.method === 'GET' && inviteMatch) {
    const token = decodeURIComponent(inviteMatch[1]);
    const invite = db.prepare(`
      SELECT i.*, c.name AS company_name, d.name AS department_name
      FROM invitations i
      JOIN companies c ON c.id = i.company_id
      LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.token = ?
    `).get(token);

    if (!invite) {
      return sendJson(res, 404, { error: 'Invitation not found.' });
    }
    if (invite.status !== 'pending') {
      return sendJson(res, 400, { error: `Invitation is no longer valid (status: ${invite.status}).` });
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").run(invite.id);
      return sendJson(res, 400, { error: 'Invitation has expired.' });
    }

    return sendJson(res, 200, {
      invitation: {
        email: invite.email,
        full_name: invite.full_name,
        role: invite.role,
        job_title: invite.job_title,
        company_name: invite.company_name,
        department_name: invite.department_name,
        expires_at: invite.expires_at
      }
    });
  }

  // POST /api/auth/accept-invite
  if (req.method === 'POST' && pathname === '/api/auth/accept-invite') {
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const fullNameInput = body.full_name ? String(body.full_name).trim() : '';

    if (!token || !password) {
      return sendJson(res, 400, { error: 'Invitation token and password are required.' });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters long.' });
    }

    const invite = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
    if (!invite) {
      return sendJson(res, 404, { error: 'Invalid invitation token.' });
    }
    if (invite.status !== 'pending') {
      return sendJson(res, 400, { error: 'This invitation has already been used or revoked.' });
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").run(invite.id);
      return sendJson(res, 400, { error: 'This invitation has expired.' });
    }

    const result = withTransaction(() => {
      const now = nowIso();
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(invite.email.toLowerCase());
      const passwordHash = hashPassword(password);

      if (!user) {
        const userId = newId('usr');
        db.prepare(`
          INSERT INTO users (
            id, email, password_hash, full_name, preferred_language, preferred_theme, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
        `).run(userId, invite.email.toLowerCase(), passwordHash, fullNameInput || invite.full_name, now, now);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      } else {
        db.prepare('UPDATE users SET password_hash = ?, full_name = ?, updated_at = ? WHERE id = ?')
          .run(passwordHash, fullNameInput || user.full_name, now, user.id);
      }

      const existingMembership = db.prepare(
        'SELECT * FROM company_memberships WHERE company_id = ? AND user_id = ?'
      ).get(invite.company_id, user.id);

      const countRow = db.prepare(
        'SELECT COUNT(*) AS cnt FROM company_memberships WHERE company_id = ?'
      ).get(invite.company_id);
      const empCode = `EMP-${String((countRow ? Number(countRow.cnt) : 0) + 1).padStart(3, '0')}`;

      if (!existingMembership) {
        db.prepare(`
          INSERT INTO company_memberships (
            id, company_id, user_id, employee_code, job_title, department_id, manager_user_id,
            role, status, permissions_json, joined_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        `).run(
          newId('mem'),
          invite.company_id,
          user.id,
          empCode,
          invite.job_title || '',
          invite.department_id || null,
          invite.manager_user_id || null,
          invite.role || 'employee',
          invite.permissions_json || '{}',
          now.slice(0, 10),
          now,
          now
        );
      } else {
        db.prepare(`
          UPDATE company_memberships
          SET status = 'active', role = ?, department_id = COALESCE(?, department_id),
              manager_user_id = COALESCE(?, manager_user_id), updated_at = ?
          WHERE id = ?
        `).run(invite.role, invite.department_id, invite.manager_user_id, now, existingMembership.id);
      }

      db.prepare(`
        UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ?
      `).run(now, invite.id);

      logAudit({
        companyId: invite.company_id,
        actorUserId: user.id,
        action: 'employee.invitation_accepted',
        entityType: 'user',
        entityId: user.id,
        newValues: { email: user.email, role: invite.role }
      });

      const session = createSession(user.id, invite.company_id);
      return buildAuthPayload(db, user.id, invite.company_id, session.token);
    });

    res.setHeader('Set-Cookie', `wf_session=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlHours * 3600}`);
    return sendJson(res, 200, result);
  }

  // GET /api/auth/workspace-accounts (List active accounts for easy role/account switching)
  if (req.method === 'GET' && pathname === '/api/auth/workspace-accounts') {
    let targetCompanyId = auth && auth.company ? auth.company.id : null;
    if (!targetCompanyId) {
      const latestCompany = db.prepare("SELECT id FROM companies WHERE slug = 'namaa-tech-demo' UNION ALL SELECT id FROM companies ORDER BY rowid DESC LIMIT 1").get();
      if (latestCompany) targetCompanyId = latestCompany.id;
    }
    if (!targetCompanyId) {
      return sendJson(res, 200, { accounts: [] });
    }
    const accounts = db.prepare(`
      SELECT u.id AS user_id, u.full_name, u.email, u.avatar_url,
             m.role, m.status, m.job_title, d.name AS department_name
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.company_id = ? AND m.status = 'active'
      ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.full_name ASC
    `).all(targetCompanyId);
    return sendJson(res, 200, { accounts });
  }

  // POST /api/auth/quick-switch (Switch directly into a Manager, Employee, or Owner account)
  if (req.method === 'POST' && pathname === '/api/auth/quick-switch') {
    const targetUserId = body.user_id ? String(body.user_id).trim() : '';
    const targetEmail = body.email ? String(body.email).trim().toLowerCase() : '';
    let user = null;
    if (targetUserId) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
    } else if (targetEmail) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(targetEmail);
    }
    if (!user) {
      return sendJson(res, 404, { error: 'الحساب المطلوب غير موجود.' });
    }

    const membership = db.prepare(`
      SELECT * FROM company_memberships
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(user.id);

    if (!membership) {
      return sendJson(res, 403, { error: 'هذا الحساب غير نشط حالياً (يرجى تفعيله إلى نشط أولاً).' });
    }

    const session = createSession(user.id, membership.company_id);
    const payload = buildAuthPayload(db, user.id, membership.company_id, session.token);
    res.setHeader('Set-Cookie', `wf_session=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlHours * 3600}`);
    return sendJson(res, 200, payload);
  }

  return false;
}

module.exports = {
  handleAuthRoutes,
  buildAuthPayload
};
