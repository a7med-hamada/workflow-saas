const crypto = require('node:crypto');
const config = require('../config');
const { getDb, withTransaction, newId, nowIso } = require('../db');
const {
  hashPassword,
  computeEffectivePermissions,
  hasPermission
} = require('../auth');
const { logAudit, safeParseJson } = require('../audit');
const { evaluateDeadline } = require('../notifications');

function handleEmployeeRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;
  const tz = (auth.settings && auth.settings.timezone) || 'Asia/Riyadh';

  // GET /api/employees/directory (minimal lookup for @mentions and assignees within same company)
  if (req.method === 'GET' && pathname === '/api/employees/directory') {
    const members = db.prepare(`
      SELECT m.user_id AS id, u.full_name, m.role, m.job_title, m.department_id,
             d.name AS department_name, u.avatar_url, m.status
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.company_id = ? AND m.status = 'active'
      ORDER BY u.full_name ASC
    `).all(companyId);
    return sendJson(res, 200, { directory: members });
  }

  // GET /api/employees
  if (req.method === 'GET' && pathname === '/api/employees') {
    const canViewList =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_manage_employees') ||
      hasPermission(auth, 'can_assign_tasks');

    if (!canViewList) {
      return sendJson(res, 403, { error: 'Employees are not authorized to access the administrative employee management directory.' });
    }

    const departmentFilter = query.get('department_id') || null;
    const statusFilter = query.get('status') || null;
    const roleFilter = query.get('role') || null;
    const search = (query.get('q') || '').trim();

    const clauses = ['m.company_id = ?'];
    const params = [companyId];

    if (departmentFilter) {
      clauses.push('m.department_id = ?');
      params.push(departmentFilter);
    }
    if (statusFilter) {
      clauses.push('m.status = ?');
      params.push(statusFilter);
    }
    if (roleFilter) {
      clauses.push('m.role = ?');
      params.push(roleFilter);
    }
    if (search) {
      clauses.push('(u.full_name LIKE ? OR u.email LIKE ? OR m.job_title LIKE ? OR m.employee_code LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const rows = db.prepare(`
      SELECT m.id AS membership_id, m.user_id, m.employee_code, m.job_title,
             m.department_id, d.name AS department_name,
             m.manager_user_id, mgr.full_name AS manager_name,
             m.role, m.status, m.permissions_json, m.joined_at, m.created_at,
             u.full_name, u.email, u.phone, u.avatar_url
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users mgr ON mgr.id = m.manager_user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.full_name ASC
    `).all(...params);

    const allTasks = db.prepare(`
      SELECT id, assignee_user_id, status, priority, deadline
      FROM tasks
      WHERE company_id = ? AND status != 'cancelled'
    `).all(companyId);

    const employees = rows.map((r) => {
      const userTasks = allTasks.filter((t) => t.assignee_user_id === r.user_id);
      const openTasks = userTasks.filter((t) => t.status !== 'completed');
      const completedTasks = userTasks.filter((t) => t.status === 'completed');
      const overdueTasks = openTasks.filter((t) => evaluateDeadline(t.deadline, t.status, tz).isOverdue);
      const urgentOpenTasks = openTasks.filter((t) => t.priority === 'urgent');

      return {
        ...r,
        permissions: computeEffectivePermissions(r.role, r.permissions_json),
        custom_permissions: safeParseJson(r.permissions_json, {}),
        open_tasks_count: openTasks.length,
        completed_tasks_count: completedTasks.length,
        overdue_tasks_count: overdueTasks.length,
        urgent_tasks_count: urgentOpenTasks.length
      };
    });

    const invitations = db.prepare(`
      SELECT i.*, d.name AS department_name, u.full_name AS invited_by_name
      FROM invitations i
      LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.company_id = ?
      ORDER BY i.created_at DESC
    `).all(companyId);

    return sendJson(res, 200, { employees, invitations });
  }

  // GET /api/employees/:userId
  const empDetailMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (req.method === 'GET' && empDetailMatch && empDetailMatch[1] !== 'directory') {
    const targetUserId = empDetailMatch[1];
    const isSelf = targetUserId === auth.user.id;
    const isAdminOrMgr =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_manage_employees');

    if (!isSelf && !isAdminOrMgr) {
      return sendJson(res, 403, { error: 'You are not allowed to view another employee\'s private profile.' });
    }

    const row = db.prepare(`
      SELECT m.id AS membership_id, m.user_id, m.employee_code, m.job_title,
             m.department_id, d.name AS department_name,
             m.manager_user_id, mgr.full_name AS manager_name,
             m.role, m.status, m.permissions_json, m.joined_at, m.created_at,
             u.full_name, u.email, u.phone, u.avatar_url
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users mgr ON mgr.id = m.manager_user_id
      WHERE m.company_id = ? AND m.user_id = ?
    `).get(companyId, targetUserId);

    if (!row) {
      return sendJson(res, 404, { error: 'Employee not found in this workspace.' });
    }

    const tasks = db.prepare(`
      SELECT t.*, p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.company_id = ? AND t.assignee_user_id = ?
      ORDER BY t.updated_at DESC
    `).all(companyId, targetUserId).map((t) => ({
      ...t,
      deadline_info: evaluateDeadline(t.deadline, t.status, tz)
    }));

    const applicableTasks = tasks.filter((t) => t.status !== 'cancelled');
    const completedTasks = applicableTasks.filter((t) => t.status === 'completed');
    const openTasks = applicableTasks.filter((t) => t.status !== 'completed');
    const overdueTasks = openTasks.filter((t) => t.deadline_info.isOverdue);
    const completionRate = applicableTasks.length > 0
      ? Math.round((completedTasks.length / applicableTasks.length) * 100)
      : 0;

    const activity = db.prepare(`
      SELECT a.*, u.full_name AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.company_id = ? AND (a.actor_user_id = ? OR (a.entity_type = 'user' AND a.entity_id = ?))
      ORDER BY a.created_at DESC
      LIMIT 40
    `).all(companyId, targetUserId, targetUserId);

    return sendJson(res, 200, {
      employee: {
        ...row,
        permissions: computeEffectivePermissions(row.role, row.permissions_json),
        custom_permissions: safeParseJson(row.permissions_json, {})
      },
      summary: {
        total_assigned: applicableTasks.length,
        completed_count: completedTasks.length,
        open_count: openTasks.length,
        overdue_count: overdueTasks.length,
        in_review_count: applicableTasks.filter((t) => t.status === 'in_review').length,
        completion_rate: completionRate
      },
      tasks,
      activity
    });
  }

  // POST /api/employees (Option 1: Create employee account manually by Owner or Manager)
  if (req.method === 'POST' && pathname === '/api/employees') {
    const canCreateEmp =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_manage_employees');
    if (!canCreateEmp) {
      return sendJson(res, 403, { error: 'You do not have permission to create employee accounts.' });
    }

    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const phone = String(body.phone || '').trim();
    const avatarUrl = String(body.avatar_url || '').trim();
    const jobTitle = String(body.job_title || '').trim();
    const role = ['owner', 'manager', 'employee'].includes(body.role) ? body.role : 'employee';
    const departmentId = body.department_id || null;
    const managerUserId = body.manager_user_id || (auth.membership.role === 'manager' ? auth.user.id : null);
    const joinedAt = body.joined_at || nowIso().slice(0, 10);
    const customPerms = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};

    if (!fullName || !email || !password) {
      return sendJson(res, 400, { error: 'Full name, email, and initial password are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Invalid email address format.' });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: 'Password must be at least 6 characters long.' });
    }
    if (role === 'owner' && auth.membership.role !== 'owner') {
      return sendJson(res, 403, { error: 'Only the company owner can grant owner role.' });
    }

    if (departmentId) {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?').get(departmentId, companyId);
      if (!dept) return sendJson(res, 400, { error: 'Selected department does not exist in this company.' });
    }
    if (managerUserId) {
      const mgr = db.prepare('SELECT user_id FROM company_memberships WHERE user_id = ? AND company_id = ?').get(managerUserId, companyId);
      if (!mgr) return sendJson(res, 400, { error: 'Selected manager does not belong to this company.' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existingUser) {
      const existingMember = db.prepare(
        'SELECT id FROM company_memberships WHERE company_id = ? AND user_id = ?'
      ).get(companyId, existingUser.id);
      if (existingMember) {
        return sendJson(res, 409, { error: 'An employee with this email already exists in your company workspace.' });
      }
    }

    const created = withTransaction(() => {
      const now = nowIso();
      let userId = existingUser ? existingUser.id : newId('usr');
      const passwordHash = hashPassword(password);

      if (!existingUser) {
        db.prepare(`
          INSERT INTO users (
            id, email, password_hash, full_name, phone, avatar_url,
            preferred_language, preferred_theme, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
        `).run(userId, email, passwordHash, fullName, phone, avatarUrl, now, now);
      } else {
        db.prepare(`
          UPDATE users SET password_hash = ?, full_name = ?, phone = COALESCE(NULLIF(?, ''), phone),
                           avatar_url = COALESCE(NULLIF(?, ''), avatar_url), updated_at = ?
          WHERE id = ?
        `).run(passwordHash, fullName, phone, avatarUrl, now, userId);
      }

      const countRow = db.prepare('SELECT COUNT(*) AS c FROM company_memberships WHERE company_id = ?').get(companyId);
      const employeeCode = body.employee_code
        ? String(body.employee_code).trim()
        : `EMP-${String(Number(countRow.c) + 1).padStart(3, '0')}`;

      const defaultPerms = config.defaultRolePermissions[role] || config.defaultRolePermissions.employee;
      const mergedPerms = { ...defaultPerms, ...customPerms };

      const membershipId = newId('mem');
      db.prepare(`
        INSERT INTO company_memberships (
          id, company_id, user_id, employee_code, job_title, department_id, manager_user_id,
          role, status, permissions_json, joined_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(
        membershipId,
        companyId,
        userId,
        employeeCode,
        jobTitle,
        departmentId,
        managerUserId,
        role,
        JSON.stringify(mergedPerms),
        joinedAt,
        now,
        now
      );

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'employee.created',
        entityType: 'user',
        entityId: userId,
        newValues: { full_name: fullName, email, role, department_id: departmentId, employee_code: employeeCode }
      });

      return db.prepare(`
        SELECT m.id AS membership_id, m.user_id, m.employee_code, m.job_title,
               m.department_id, m.manager_user_id, m.role, m.status, m.joined_at,
               u.full_name, u.email, u.phone, u.avatar_url
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.id = ?
      `).get(membershipId);
    });

    return sendJson(res, 201, { employee: created });
  }

  // POST /api/employees/invite (Option 2: Invite by email)
  if (req.method === 'POST' && pathname === '/api/employees/invite') {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_employees')) {
      return sendJson(res, 403, { error: 'You do not have permission to invite employees.' });
    }

    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const role = ['manager', 'employee'].includes(body.role) ? body.role : 'employee';
    const jobTitle = String(body.job_title || '').trim();
    const departmentId = body.department_id || null;
    const managerUserId = body.manager_user_id || null;
    const customPerms = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};

    if (!fullName || !email) {
      return sendJson(res, 400, { error: 'Employee full name and email are required for invitation.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Invalid email address.' });
    }

    const existingMember = db.prepare(`
      SELECT m.id FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ? AND u.email = ?
    `).get(companyId, email);
    if (existingMember) {
      return sendJson(res, 409, { error: 'An employee with this email is already a member of this workspace.' });
    }

    const existingInvite = db.prepare(`
      SELECT id FROM invitations WHERE company_id = ? AND email = ? AND status = 'pending'
    `).get(companyId, email);
    if (existingInvite) {
      return sendJson(res, 409, { error: 'A pending invitation already exists for this email address.' });
    }

    const expiryHours = Number((auth.settings && auth.settings.invitation_expiry_hours) || 72);
    const token = crypto.randomBytes(32).toString('hex');
    const now = nowIso();
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();
    const inviteId = newId('inv');

    const defaultPerms = config.defaultRolePermissions[role] || config.defaultRolePermissions.employee;
    const mergedPerms = { ...defaultPerms, ...customPerms };

    db.prepare(`
      INSERT INTO invitations (
        id, company_id, email, full_name, role, job_title, department_id, manager_user_id,
        permissions_json, token, invited_by, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      inviteId,
      companyId,
      email,
      fullName,
      role,
      jobTitle,
      departmentId,
      managerUserId,
      JSON.stringify(mergedPerms),
      token,
      auth.user.id,
      expiresAt,
      now
    );

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'employee.invited',
      entityType: 'invitation',
      entityId: inviteId,
      newValues: { email, full_name: fullName, role, expires_at: expiresAt }
    });

    const invitation = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inviteId);
    const responseData = {
      invitation,
      email_provider_configured: config.smtpConfigured
    };

    if (config.isDev && !config.smtpConfigured) {
      responseData.dev_mode_notice = 'Email provider (SMTP) is not configured. Use the development invitation link below to accept the invitation.';
      responseData.dev_invite_token = token;
      responseData.dev_invite_url = `#/accept-invite?token=${token}`;
    }

    return sendJson(res, 201, responseData);
  }

  // DELETE /api/employees/invitations/:inviteId
  const revokeInviteMatch = pathname.match(/^\/api\/employees\/invitations\/([^/]+)$/);
  if (req.method === 'DELETE' && revokeInviteMatch) {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_employees')) {
      return sendJson(res, 403, { error: 'Not authorized to revoke invitations.' });
    }
    const inviteId = revokeInviteMatch[1];
    const invite = db.prepare('SELECT * FROM invitations WHERE id = ? AND company_id = ?').get(inviteId, companyId);
    if (!invite) {
      return sendJson(res, 404, { error: 'Invitation not found.' });
    }
    db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?").run(inviteId);
    return sendJson(res, 200, { ok: true });
  }

  // PUT /api/employees/:userId
  if (req.method === 'PUT' && empDetailMatch) {
    const canEditEmp =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_manage_employees');
    if (!canEditEmp) {
      return sendJson(res, 403, { error: 'You do not have permission to edit employee accounts.' });
    }

    const targetUserId = empDetailMatch[1];
    const membership = db.prepare(`
      SELECT m.*, u.full_name, u.email, u.phone, u.avatar_url
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ? AND m.user_id = ?
    `).get(companyId, targetUserId);

    if (!membership) {
      return sendJson(res, 404, { error: 'Employee not found in this workspace.' });
    }

    if (membership.role === 'owner' && body.status === 'inactive') {
      return sendJson(res, 400, { error: 'The company owner account cannot be deactivated.' });
    }
    if (membership.role === 'owner' && body.role && body.role !== 'owner') {
      return sendJson(res, 400, { error: 'Cannot downgrade the primary company owner role.' });
    }
    if (membership.role === 'owner' && auth.membership.role !== 'owner') {
      return sendJson(res, 403, { error: 'Only the company owner can edit the owner account.' });
    }

    const now = nowIso();
    const newFullName = body.full_name !== undefined ? String(body.full_name).trim() : membership.full_name;
    const newEmail = body.email !== undefined ? String(body.email).trim().toLowerCase() : membership.email;
    const newPhone = body.phone !== undefined ? String(body.phone).trim() : membership.phone;
    const newAvatar = body.avatar_url !== undefined ? String(body.avatar_url).trim() : membership.avatar_url;
    const newJobTitle = body.job_title !== undefined ? String(body.job_title).trim() : membership.job_title;
    const newEmpCode = body.employee_code !== undefined ? String(body.employee_code).trim() : membership.employee_code;
    const newDeptId = body.department_id !== undefined ? (body.department_id || null) : membership.department_id;
    const newMgrId = body.manager_user_id !== undefined ? (body.manager_user_id || null) : membership.manager_user_id;
    const newRole = body.role && ['owner', 'manager', 'employee'].includes(body.role) ? body.role : membership.role;
    const newStatus = body.status && ['active', 'inactive'].includes(body.status) ? body.status : membership.status;
    const newPassword = body.new_password ? String(body.new_password) : '';

    if (newEmail !== membership.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return sendJson(res, 400, { error: 'Invalid email address format.' });
      }
      const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, targetUserId);
      if (emailTaken) {
        return sendJson(res, 409, { error: 'This email address is already in use by another account.' });
      }
    }

    if (newPassword && newPassword.length < 6) {
      return sendJson(res, 400, { error: 'New password must be at least 6 characters long.' });
    }

    let newPermissionsJson = membership.permissions_json;
    if (body.permissions && typeof body.permissions === 'object') {
      const basePerms = config.defaultRolePermissions[newRole] || config.defaultRolePermissions.employee;
      newPermissionsJson = JSON.stringify({ ...basePerms, ...body.permissions });
    } else if (newRole !== membership.role) {
      newPermissionsJson = JSON.stringify(config.defaultRolePermissions[newRole] || config.defaultRolePermissions.employee);
    }

    withTransaction(() => {
      db.prepare(`
        UPDATE users SET full_name = ?, email = ?, phone = ?, avatar_url = ?, updated_at = ?
        WHERE id = ?
      `).run(newFullName, newEmail, newPhone, newAvatar, now, targetUserId);

      if (newPassword) {
        const pwdHash = hashPassword(newPassword);
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
          .run(pwdHash, now, targetUserId);
      }

      db.prepare(`
        UPDATE company_memberships
        SET employee_code = ?, job_title = ?, department_id = ?, manager_user_id = ?,
            role = ?, status = ?, permissions_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        newEmpCode,
        newJobTitle,
        newDeptId,
        newMgrId,
        newRole,
        newStatus,
        newPermissionsJson,
        now,
        membership.id
      );

      // If employee is deactivated, immediately invalidate their sessions for this company
      if (newStatus === 'inactive' && membership.status !== 'inactive') {
        db.prepare('DELETE FROM sessions WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'employee.deactivated',
          entityType: 'user',
          entityId: targetUserId,
          previousValues: { status: membership.status },
          newValues: { status: 'inactive' }
        });
      } else if (newStatus === 'active' && membership.status === 'inactive') {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'employee.reactivated',
          entityType: 'user',
          entityId: targetUserId,
          previousValues: { status: 'inactive' },
          newValues: { status: 'active' }
        });
      }

      if (newPermissionsJson !== membership.permissions_json || newRole !== membership.role) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'employee.permissions_changed',
          entityType: 'user',
          entityId: targetUserId,
          previousValues: { role: membership.role, permissions: safeParseJson(membership.permissions_json, {}) },
          newValues: { role: newRole, permissions: safeParseJson(newPermissionsJson, {}) }
        });
      } else {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'employee.updated',
          entityType: 'user',
          entityId: targetUserId,
          previousValues: { department_id: membership.department_id, manager_user_id: membership.manager_user_id, job_title: membership.job_title },
          newValues: { department_id: newDeptId, manager_user_id: newMgrId, job_title: newJobTitle }
        });
      }
    });

    const updated = db.prepare(`
      SELECT m.id AS membership_id, m.user_id, m.employee_code, m.job_title,
             m.department_id, d.name AS department_name,
             m.manager_user_id, mgr.full_name AS manager_name,
             m.role, m.status, m.permissions_json, m.joined_at,
             u.full_name, u.email, u.phone, u.avatar_url
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN users mgr ON mgr.id = m.manager_user_id
      WHERE m.id = ?
    `).get(membership.id);

    return sendJson(res, 200, {
      employee: {
        ...updated,
        permissions: computeEffectivePermissions(updated.role, updated.permissions_json),
        custom_permissions: safeParseJson(updated.permissions_json, {})
      }
    });
  }

  // DELETE /api/employees/:userId
  if (req.method === 'DELETE' && empDetailMatch && empDetailMatch[1] !== 'directory') {
    const canDeleteEmp =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_manage_employees');
    if (!canDeleteEmp) {
      return sendJson(res, 403, { error: 'You do not have permission to delete employee accounts.' });
    }

    const targetUserId = empDetailMatch[1];
    if (targetUserId === auth.user.id) {
      return sendJson(res, 400, { error: 'You cannot delete your own account.' });
    }

    const membership = db.prepare(`
      SELECT m.*, u.full_name, u.email
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ? AND m.user_id = ?
    `).get(companyId, targetUserId);

    if (!membership) {
      return sendJson(res, 404, { error: 'Employee not found in this workspace.' });
    }
    if (membership.role === 'owner') {
      return sendJson(res, 400, { error: 'The company owner account cannot be deleted.' });
    }

    withTransaction(() => {
      db.prepare('UPDATE tasks SET assignee_user_id = NULL, updated_at = ? WHERE company_id = ? AND assignee_user_id = ?')
        .run(nowIso(), companyId, targetUserId);
      db.prepare('UPDATE departments SET manager_user_id = NULL, updated_at = ? WHERE company_id = ? AND manager_user_id = ?')
        .run(nowIso(), companyId, targetUserId);
      db.prepare('UPDATE projects SET manager_user_id = NULL, updated_at = ? WHERE company_id = ? AND manager_user_id = ?')
        .run(nowIso(), companyId, targetUserId);
      db.prepare('UPDATE company_memberships SET manager_user_id = NULL, updated_at = ? WHERE company_id = ? AND manager_user_id = ?')
        .run(nowIso(), companyId, targetUserId);

      db.prepare('DELETE FROM project_members WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
      db.prepare('DELETE FROM task_assignees WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
      db.prepare('DELETE FROM sessions WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
      db.prepare('DELETE FROM notifications WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
      db.prepare('DELETE FROM company_memberships WHERE id = ?').run(membership.id);

      const otherMemberships = db.prepare('SELECT COUNT(*) AS c FROM company_memberships WHERE user_id = ?').get(targetUserId);
      if (Number(otherMemberships.c) === 0) {
        db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
      }

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'employee.deleted',
        entityType: 'user',
        entityId: targetUserId,
        previousValues: { full_name: membership.full_name, email: membership.email, role: membership.role }
      });
    });

    return sendJson(res, 200, { ok: true, deleted_user_id: targetUserId });
  }

  return false;
}

module.exports = {
  handleEmployeeRoutes
};
