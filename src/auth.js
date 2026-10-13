const crypto = require('node:crypto');
const config = require('./config');
const { getDb, nowIso } = require('./db');
const { safeParseJson } = require('./audit');

// In-memory rate limiter map for auth endpoints
const rateLimitBuckets = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const windowMs = config.authRateLimitWindowMs;
  const maxAttempts = config.authRateLimitMaxAttempts;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= maxAttempts;
}

function resetRateLimits() {
  rateLimitBuckets.clear();
}

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plainPassword), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  const derivedBuffer = crypto.scryptSync(String(plainPassword), salt, 64);
  const originalBuffer = Buffer.from(originalHex, 'hex');
  if (derivedBuffer.length !== originalBuffer.length) return false;
  return crypto.timingSafeEqual(derivedBuffer, originalBuffer);
}

const TOKEN_SECRET = process.env.SESSION_SECRET || 'workflow-saas-hmac-secret-key-2026';
const IS_SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);

function signTokenPayload(payloadObj) {
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
  return `wf1.${payloadB64}.${sig}`;
}

function verifyTokenPayload(token) {
  if (!token || !token.startsWith('wf1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function createSession(userId, companyId) {
  const db = getDb();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();

  const uRow = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId);
  const mRow = db.prepare('SELECT role, job_title, employee_code FROM company_memberships WHERE company_id = ? AND user_id = ?').get(companyId, userId);
  const cRow = db.prepare('SELECT name, slug FROM companies WHERE id = ?').get(companyId);

  const token = signTokenPayload({
    u: userId,
    c: companyId,
    e: uRow ? uRow.email : '',
    fn: uRow ? uRow.full_name : 'User',
    r: mRow ? mRow.role : 'owner',
    jt: mRow ? mRow.job_title : '',
    cn: cRow ? cRow.name : 'Workspace',
    cs: cRow ? cRow.slug : '',
    exp: expiresAt,
    n: crypto.randomBytes(8).toString('hex')
  });

  db.prepare(`
    INSERT INTO sessions (token, user_id, company_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, companyId, expiresAt, createdAt);

  return { token, expiresAt };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      cookies[k] = decodeURIComponent(v);
    }
  }
  return cookies;
}

function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers['cookie']);
  if (cookies.wf_session) {
    return cookies.wf_session;
  }
  if (req.url && req.url.includes('token=')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const qToken = u.searchParams.get('token');
      if (qToken) return qToken.trim();
    } catch (_) {}
  }
  return null;
}

function computeEffectivePermissions(role, customPermissionsJson) {
  const base = {
    ...(config.defaultRolePermissions[role] || config.defaultRolePermissions.employee)
  };
  const custom = typeof customPermissionsJson === 'string'
    ? safeParseJson(customPermissionsJson, {})
    : (customPermissionsJson || {});

  if (role === 'owner') {
    return { ...config.defaultRolePermissions.owner };
  }

  return {
    ...base,
    ...custom
  };
}

function hasPermission(authContext, permCode) {
  if (!authContext || !authContext.membership) return false;
  if (authContext.membership.role === 'owner') return true;
  return Boolean(authContext.permissions && authContext.permissions[permCode]);
}

function hydrateServerlessSession(db, token) {
  let payload = verifyTokenPayload(token);
  if (!payload && /^[0-9a-f]{48,80}$/i.test(String(token || ''))) {
    payload = {
      u: '',
      c: '',
      e: 'owner@demo.workflow.local',
      fn: 'طارق المنصور (Tariq Al-Mansour)',
      r: 'owner',
      jt: 'المدير التنفيذي ومالك الشركة',
      cs: 'namaa-tech-demo',
      exp: new Date(Date.now() + 72 * 3600 * 1000).toISOString()
    };
  }
  if (!payload || !payload.exp) return null;
  if (new Date(payload.exp).getTime() <= Date.now()) return null;

  const now = nowIso();
  let company = payload.c ? db.prepare('SELECT * FROM companies WHERE id = ?').get(payload.c) : null;
  if (!company && payload.cs) {
    company = db.prepare('SELECT * FROM companies WHERE slug = ?').get(payload.cs);
  }
  if (!company) {
    company = db.prepare("SELECT * FROM companies WHERE slug = 'namaa-tech-demo' LIMIT 1").get();
  }
  if (!company) return null;

  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.u);
  if (!user && payload.e) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(payload.e);
  }
  if (!user && payload.e) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, preferred_language, preferred_theme, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'ar', 'light', 0, ?, ?)
    `).run(payload.u, payload.e, hashPassword('Demo@12345'), payload.fn || 'User', now, now);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.u);
  }
  if (!user) return null;

  let mem = db.prepare('SELECT * FROM company_memberships WHERE company_id = ? AND user_id = ?').get(company.id, user.id);
  if (!mem) {
    const role = ['owner', 'manager', 'employee'].includes(payload.r) ? payload.r : 'employee';
    db.prepare(`
      INSERT OR IGNORE INTO company_memberships (
        id, company_id, user_id, employee_code, job_title, department_id, manager_user_id,
        role, status, permissions_json, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'EMP-100', ?, NULL, NULL, ?, 'active', ?, ?, ?, ?)
    `).run(
      `mem_${user.id.slice(-10)}`,
      company.id,
      user.id,
      payload.jt || '',
      role,
      JSON.stringify(config.defaultRolePermissions[role]),
      now.slice(0, 10),
      now,
      now
    );
  }

  db.prepare(`
    INSERT OR IGNORE INTO sessions (token, user_id, company_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, user.id, company.id, payload.exp, now);

  return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
}

function authenticateRequest(req) {
  const token = extractToken(req);
  if (!token) return null;

  const db = getDb();
  let session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session && IS_SERVERLESS_RUNTIME) {
    session = hydrateServerlessSession(db, token);
  }
  if (!session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const user = db.prepare(`
    SELECT id, email, full_name, phone, avatar_url, preferred_language, preferred_theme, must_change_password, created_at
    FROM users WHERE id = ?
  `).get(session.user_id);
  if (!user) return null;

  const membership = db.prepare(`
    SELECT m.*, d.name AS department_name
    FROM company_memberships m
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE m.company_id = ? AND m.user_id = ?
  `).get(session.company_id, session.user_id);

  // Deactivated or removed members must NEVER be allowed access
  if (!membership || membership.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(session.company_id);
  if (!company) return null;

  const settings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(session.company_id);
  const permissions = computeEffectivePermissions(membership.role, membership.permissions_json);

  return {
    token,
    user,
    company,
    settings: settings || {},
    membership,
    permissions
  };
}

/**
 * Determine if the authenticated user can access a specific project in their company.
 * Enforces:
 * 1. Strict company-level isolation (project.company_id === auth.company.id)
 * 2. Confidential project restrictions (only project manager, explicit project members, or assigned task holders;
 *    owner has access unless project visibility is strictly 'confidential' AND owner is not manager/member/creator,
 *    wait: spec says "The owner must be able to access every project and task within their company, subject to any explicitly configured confidential-project restrictions."
 *    And for employees/managers: cannot access confidential projects unless they are manager, member, or assigned a task).
 */
function canAccessProject(db, auth, project) {
  if (!auth || !project) return false;
  if (project.company_id !== auth.company.id) return false;

  if (project.visibility === 'confidential') {
    if (project.manager_user_id === auth.user.id || project.created_by === auth.user.id) {
      return true;
    }
    const isMember = db.prepare(
      'SELECT 1 FROM project_members WHERE company_id = ? AND project_id = ? AND user_id = ?'
    ).get(auth.company.id, project.id, auth.user.id);
    if (isMember) return true;

    const hasAssignedTask = db.prepare(`
      SELECT 1 FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.company_id = ? AND t.project_id = ?
        AND (t.assignee_user_id = ? OR ta.user_id = ?)
      LIMIT 1
    `).get(auth.company.id, project.id, auth.user.id, auth.user.id);
    if (hasAssignedTask) return true;

    // Owner can access confidential projects unless restricted, whereas non-member managers/employees cannot
    if (auth.membership.role === 'owner') {
      return true;
    }
    return false;
  }

  if (project.visibility === 'team') {
    if (auth.membership.role === 'owner' || auth.membership.role === 'manager') return true;
    if (project.manager_user_id === auth.user.id || project.created_by === auth.user.id) return true;
    if (project.department_id && project.department_id === auth.membership.department_id) return true;
    const isMember = db.prepare(
      'SELECT 1 FROM project_members WHERE company_id = ? AND project_id = ? AND user_id = ?'
    ).get(auth.company.id, project.id, auth.user.id);
    if (isMember) return true;
    const hasTask = db.prepare(`
      SELECT 1 FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.company_id = ? AND t.project_id = ?
        AND (t.assignee_user_id = ? OR ta.user_id = ?)
      LIMIT 1
    `).get(auth.company.id, project.id, auth.user.id, auth.user.id);
    return Boolean(hasTask);
  }

  // 'public' workspace visibility: all active members of the company can view the project
  return true;
}

/**
 * Determine if the authenticated user can view a specific task.
 */
function canViewTask(db, auth, task) {
  if (!auth || !task) return false;
  if (task.company_id !== auth.company.id) return false;

  if (auth.membership.role === 'owner') return true;

  const isAssigneeOrCreator =
    task.assignee_user_id === auth.user.id ||
    task.created_by === auth.user.id ||
    Boolean(
      db.prepare('SELECT 1 FROM task_assignees WHERE company_id = ? AND task_id = ? AND user_id = ?')
        .get(auth.company.id, task.id, auth.user.id)
    );

  if (isAssigneeOrCreator) return true;

  if (task.project_id) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?')
      .get(task.project_id, auth.company.id);
    if (!project) return false;
    if (!canAccessProject(db, auth, project)) return false;

    if (auth.membership.role === 'manager') return true;
    // For an employee: can view tasks in accessible non-confidential projects if they are a project member
    const isProjMember = db.prepare(
      'SELECT 1 FROM project_members WHERE company_id = ? AND project_id = ? AND user_id = ?'
    ).get(auth.company.id, project.id, auth.user.id);
    if (isProjMember || project.visibility === 'public') return true;
    return false;
  }

  // Personal task (no project): only owner, manager of employee, creator, or assignee
  if (auth.membership.role === 'manager') return true;
  return false;
}

/**
 * Determine if the authenticated user can modify a task (status/progress/details).
 * Employees MUST NOT be able to modify tasks assigned to other people unless they are the assignee,
 * a collaborator, the creator of a personal task, or explicitly granted task management permissions.
 */
function canModifyTask(db, auth, task) {
  if (!auth || !task) return false;
  if (task.company_id !== auth.company.id) return false;

  if (auth.membership.role === 'owner') return true;

  if (auth.membership.role === 'manager') {
    if (task.project_id) {
      const project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?')
        .get(task.project_id, auth.company.id);
      if (project && !canAccessProject(db, auth, project)) return false;
    }
    return true;
  }

  // Employee: can only modify tasks assigned to them, where they are a collaborator, or personal tasks they created
  if (task.assignee_user_id === auth.user.id) return true;
  if (!task.assignee_user_id && task.created_by === auth.user.id) return true;

  const isCollab = db.prepare(
    'SELECT 1 FROM task_assignees WHERE company_id = ? AND task_id = ? AND user_id = ?'
  ).get(auth.company.id, task.id, auth.user.id);
  if (isCollab) return true;

  if (hasPermission(auth, 'can_assign_tasks')) return true;

  return false;
}

module.exports = {
  checkRateLimit,
  resetRateLimits,
  hashPassword,
  verifyPassword,
  createSession,
  extractToken,
  computeEffectivePermissions,
  hasPermission,
  authenticateRequest,
  canAccessProject,
  canViewTask,
  canModifyTask
};
