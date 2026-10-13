const { getDb, newId, nowIso } = require('../db');
const { hasPermission, canAccessProject, canViewTask } = require('../auth');
const { logAudit, getAuditLogs, safeParseJson } = require('../audit');
const { processCompanyReminders } = require('../notifications');

function handleCompanyRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;

  // GET /api/company/setup-status
  if (req.method === 'GET' && pathname === '/api/company/setup-status') {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
    const settings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId);
    const deptCount = Number(db.prepare('SELECT COUNT(*) AS c FROM departments WHERE company_id = ?').get(companyId).c);
    const empCount = Number(db.prepare("SELECT COUNT(*) AS c FROM company_memberships WHERE company_id = ? AND role != 'owner'").get(companyId).c);
    const inviteCount = Number(db.prepare("SELECT COUNT(*) AS c FROM invitations WHERE company_id = ? AND status = 'pending'").get(companyId).c);
    const projCount = Number(db.prepare('SELECT COUNT(*) AS c FROM projects WHERE company_id = ?').get(companyId).c);
    const taskCount = Number(db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE company_id = ?').get(companyId).c);

    const profileCompleted = Boolean(company.industry || company.description || company.size || company.setup_wizard_completed);

    return sendJson(res, 200, {
      wizard_dismissed: Boolean(company.setup_wizard_completed),
      checklist: {
        company_profile: { completed: profileCompleted },
        timezone: { completed: Boolean(settings && settings.timezone), value: settings ? settings.timezone : 'Asia/Riyadh' },
        departments: { completed: deptCount > 0, count: deptCount },
        employees: { completed: empCount > 0 || inviteCount > 0, count: empCount, pending_invites: inviteCount },
        projects: { completed: projCount > 0, count: projCount },
        tasks: { completed: taskCount > 0, count: taskCount }
      }
    });
  }

  // PUT /api/company/setup-wizard
  if (req.method === 'PUT' && pathname === '/api/company/setup-wizard') {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_settings')) {
      return sendJson(res, 403, { error: 'Only the company owner can update setup wizard status.' });
    }
    const now = nowIso();
    if (body.industry !== undefined || body.size !== undefined || body.description !== undefined || body.company_name !== undefined) {
      db.prepare(`
        UPDATE companies
        SET name = COALESCE(?, name),
            industry = COALESCE(?, industry),
            size = COALESCE(?, size),
            description = COALESCE(?, description),
            brand_color = COALESCE(?, brand_color),
            updated_at = ?
        WHERE id = ?
      `).run(
        body.company_name ? String(body.company_name).trim() : null,
        body.industry !== undefined ? String(body.industry).trim() : null,
        body.size !== undefined ? String(body.size).trim() : null,
        body.description !== undefined ? String(body.description).trim() : null,
        body.brand_color !== undefined ? String(body.brand_color).trim() : null,
        now,
        companyId
      );
    }
    if (body.timezone) {
      db.prepare('UPDATE company_settings SET timezone = ?, updated_at = ? WHERE company_id = ?')
        .run(String(body.timezone).trim(), now, companyId);
    }
    if (body.setup_wizard_completed !== undefined) {
      db.prepare('UPDATE companies SET setup_wizard_completed = ?, updated_at = ? WHERE id = ?')
        .run(body.setup_wizard_completed ? 1 : 0, now, companyId);
    }

    return sendJson(res, 200, { ok: true });
  }

  // GET /api/company/settings
  if (req.method === 'GET' && pathname === '/api/company/settings') {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
    const settings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId);
    const roles = db.prepare('SELECT * FROM roles WHERE company_id = ?').all(companyId);
    const permissionsCatalog = db.prepare('SELECT * FROM permissions').all();

    // Calculate current usage for subscription readiness
    const seatUsed = Number(db.prepare("SELECT COUNT(*) AS c FROM company_memberships WHERE company_id = ? AND status = 'active'").get(companyId).c);
    const projectsUsed = Number(db.prepare("SELECT COUNT(*) AS c FROM projects WHERE company_id = ? AND status != 'archived'").get(companyId).c);
    const storageBytes = Number(db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS s FROM task_attachments WHERE company_id = ?').get(companyId).s);

    return sendJson(res, 200, {
      company,
      settings: {
        ...settings,
        custom_task_statuses: safeParseJson(settings.custom_task_statuses_json, [])
      },
      roles: roles.map((r) => ({
        ...r,
        default_permissions: safeParseJson(r.default_permissions_json, {})
      })),
      permissions_catalog: permissionsCatalog,
      usage: {
        seats_used: seatUsed,
        seat_limit: company.seat_limit,
        projects_used: projectsUsed,
        project_limit: company.project_limit,
        storage_used_mb: Number((storageBytes / (1024 * 1024)).toFixed(2)),
        storage_limit_mb: company.storage_limit_mb
      }
    });
  }

  // PUT /api/company/settings
  if (req.method === 'PUT' && pathname === '/api/company/settings') {
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_manage_settings')) {
      return sendJson(res, 403, { error: 'You do not have permission to modify company settings.' });
    }

    const prevCompany = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
    const prevSettings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId);
    const now = nowIso();

    if (body.company) {
      const c = body.company;
      db.prepare(`
        UPDATE companies
        SET name = COALESCE(?, name),
            industry = COALESCE(?, industry),
            size = COALESCE(?, size),
            description = COALESCE(?, description),
            logo_url = COALESCE(?, logo_url),
            brand_color = COALESCE(?, brand_color),
            subscription_plan = COALESCE(?, subscription_plan),
            updated_at = ?
        WHERE id = ?
      `).run(
        c.name ? String(c.name).trim() : null,
        c.industry !== undefined ? String(c.industry).trim() : null,
        c.size !== undefined ? String(c.size).trim() : null,
        c.description !== undefined ? String(c.description).trim() : null,
        c.logo_url !== undefined ? String(c.logo_url).trim() : null,
        c.brand_color !== undefined ? String(c.brand_color).trim() : null,
        c.subscription_plan !== undefined ? String(c.subscription_plan).trim() : null,
        now,
        companyId
      );
    }

    if (body.settings) {
      const s = body.settings;
      const boolOrNull = (v) => (v === undefined ? null : (v ? 1 : 0));
      const customStatusesStr = s.custom_task_statuses !== undefined
        ? JSON.stringify(Array.isArray(s.custom_task_statuses) ? s.custom_task_statuses : [])
        : null;

      db.prepare(`
        UPDATE company_settings
        SET timezone = COALESCE(?, timezone),
            week_start_day = COALESCE(?, week_start_day),
            date_format = COALESCE(?, date_format),
            time_format = COALESCE(?, time_format),
            default_language = COALESCE(?, default_language),
            default_task_priority = COALESCE(?, default_task_priority),
            default_task_status = COALESCE(?, default_task_status),
            custom_task_statuses_json = COALESCE(?, custom_task_statuses_json),
            default_project_visibility = COALESCE(?, default_project_visibility),
            require_task_approval = COALESCE(?, require_task_approval),
            warn_incomplete_subtasks = COALESCE(?, warn_incomplete_subtasks),
            allow_employee_personal_tasks = COALESCE(?, allow_employee_personal_tasks),
            enable_time_tracking = COALESCE(?, enable_time_tracking),
            allow_manual_time_entries = COALESCE(?, allow_manual_time_entries),
            allow_edit_past_time_entries = COALESCE(?, allow_edit_past_time_entries),
            prevent_overlapping_timers = COALESCE(?, prevent_overlapping_timers),
            max_upload_size_mb = COALESCE(?, max_upload_size_mb),
            remind_before_hours = COALESCE(?, remind_before_hours),
            remind_on_due_date = COALESCE(?, remind_on_due_date),
            notify_manager_on_overdue = COALESCE(?, notify_manager_on_overdue),
            daily_overdue_summary = COALESCE(?, daily_overdue_summary),
            daily_report_reminder = COALESCE(?, daily_report_reminder),
            invitation_expiry_hours = COALESCE(?, invitation_expiry_hours),
            updated_at = ?
        WHERE company_id = ?
      `).run(
        s.timezone || null,
        s.week_start_day || null,
        s.date_format || null,
        s.time_format || null,
        s.default_language || null,
        s.default_task_priority || null,
        s.default_task_status || null,
        customStatusesStr,
        s.default_project_visibility || null,
        boolOrNull(s.require_task_approval),
        boolOrNull(s.warn_incomplete_subtasks),
        boolOrNull(s.allow_employee_personal_tasks),
        boolOrNull(s.enable_time_tracking),
        boolOrNull(s.allow_manual_time_entries),
        boolOrNull(s.allow_edit_past_time_entries),
        boolOrNull(s.prevent_overlapping_timers),
        s.max_upload_size_mb !== undefined ? Number(s.max_upload_size_mb) : null,
        s.remind_before_hours !== undefined ? Number(s.remind_before_hours) : null,
        boolOrNull(s.remind_on_due_date),
        boolOrNull(s.notify_manager_on_overdue),
        boolOrNull(s.daily_overdue_summary),
        boolOrNull(s.daily_report_reminder),
        s.invitation_expiry_hours !== undefined ? Number(s.invitation_expiry_hours) : null,
        now,
        companyId
      );
    }

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'company.settings_updated',
      entityType: 'company',
      entityId: companyId,
      previousValues: { name: prevCompany.name, timezone: prevSettings.timezone, require_task_approval: prevSettings.require_task_approval },
      newValues: body
    });

    const updatedCompany = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
    const updatedSettings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId);
    return sendJson(res, 200, { company: updatedCompany, settings: updatedSettings });
  }

  // GET /api/audit-logs
  if (req.method === 'GET' && pathname === '/api/audit-logs') {
    const entityType = query.get('entity_type') || null;
    const entityId = query.get('entity_id') || null;

    // Task or Project specific activity timeline can be viewed by users who have access to that task/project
    if (entityType === 'task' && entityId) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(entityId, companyId);
      if (!task || !canViewTask(db, auth, task)) {
        return sendJson(res, 403, { error: 'Access denied to task activity history.' });
      }
      const logs = getAuditLogs({ companyId, entityType: 'task', entityId, limit: 100 });
      return sendJson(res, 200, { audit_logs: logs });
    }

    if (entityType === 'project' && entityId) {
      const project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(entityId, companyId);
      if (!project || !canAccessProject(db, auth, project)) {
        return sendJson(res, 403, { error: 'Access denied to project activity history.' });
      }
      const logs = getAuditLogs({ companyId, entityType: 'project', entityId, limit: 100 });
      return sendJson(res, 200, { audit_logs: logs });
    }

    // Company-wide audit log requires owner or can_view_audit_logs permission
    if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_view_audit_logs')) {
      return sendJson(res, 403, { error: 'Only authorized administrators can view company-wide audit logs.' });
    }

    const logs = getAuditLogs({
      companyId,
      entityType,
      entityId,
      actorUserId: query.get('actor_user_id') || null,
      action: query.get('action') || null,
      limit: Number(query.get('limit') || 100),
      offset: Number(query.get('offset') || 0)
    });
    return sendJson(res, 200, { audit_logs: logs });
  }

  // GET /api/notifications
  if (req.method === 'GET' && pathname === '/api/notifications') {
    const unreadOnly = query.get('unread_only') === '1' || query.get('unread_only') === 'true';
    const limit = Math.min(200, Math.max(1, Number(query.get('limit') || 50)));
    const rows = db.prepare(`
      SELECT * FROM notifications
      WHERE company_id = ? AND user_id = ?
      ${unreadOnly ? 'AND is_read = 0' : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(companyId, auth.user.id, limit);

    const unreadCount = Number(
      db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE company_id = ? AND user_id = ? AND is_read = 0')
        .get(companyId, auth.user.id).c
    );

    return sendJson(res, 200, { notifications: rows, unread_count: unreadCount });
  }

  // PUT /api/notifications/read-all
  if (req.method === 'PUT' && pathname === '/api/notifications/read-all') {
    db.prepare(`
      UPDATE notifications SET is_read = 1, read_at = ?
      WHERE company_id = ? AND user_id = ? AND is_read = 0
    `).run(nowIso(), companyId, auth.user.id);
    return sendJson(res, 200, { ok: true, unread_count: 0 });
  }

  // PUT /api/notifications/:id/read
  const notifReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (req.method === 'PUT' && notifReadMatch) {
    const notifId = notifReadMatch[1];
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ? AND company_id = ? AND user_id = ?')
      .get(notifId, companyId, auth.user.id);
    if (!notif) {
      return sendJson(res, 404, { error: 'Notification not found.' });
    }
    db.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?')
      .run(nowIso(), notifId);
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/reminders/process (Trigger automatic deadline & overdue reminders check)
  if (req.method === 'POST' && pathname === '/api/reminders/process') {
    const result = processCompanyReminders(companyId);
    return sendJson(res, 200, { ok: true, ...result });
  }

  // GET /api/labels & POST /api/labels
  if (req.method === 'GET' && pathname === '/api/labels') {
    const labels = db.prepare('SELECT * FROM labels WHERE company_id = ? ORDER BY name ASC').all(companyId);
    return sendJson(res, 200, { labels });
  }

  if (req.method === 'POST' && pathname === '/api/labels') {
    const name = String(body.name || '').trim();
    const color = String(body.color || '#3b82f6').trim();
    if (!name) return sendJson(res, 400, { error: 'Label name is required.' });
    const existing = db.prepare('SELECT * FROM labels WHERE company_id = ? AND name = ?').get(companyId, name);
    if (existing) return sendJson(res, 200, { label: existing });
    const id = newId('lbl');
    db.prepare('INSERT INTO labels (id, company_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, companyId, name, color, nowIso());
    const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(id);
    return sendJson(res, 201, { label });
  }

  // GET /api/search?q=...&type=...
  if (req.method === 'GET' && pathname === '/api/search') {
    const q = String(query.get('q') || '').trim();
    const filterType = query.get('type') || 'all';
    if (!q) {
      return sendJson(res, 200, {
        query: '',
        tasks: [],
        projects: [],
        employees: [],
        departments: [],
        comments: []
      });
    }

    const like = `%${q}%`;
    const results = {
      query: q,
      tasks: [],
      projects: [],
      employees: [],
      departments: [],
      comments: []
    };

    if (filterType === 'all' || filterType === 'projects') {
      const rawProjects = db.prepare(`
        SELECT p.*, u.full_name AS manager_name, d.name AS department_name
        FROM projects p
        LEFT JOIN users u ON u.id = p.manager_user_id
        LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.company_id = ? AND (p.name LIKE ? OR p.description LIKE ?)
        ORDER BY p.updated_at DESC LIMIT 30
      `).all(companyId, like, like);
      results.projects = rawProjects.filter((p) => canAccessProject(db, auth, p));
    }

    if (filterType === 'all' || filterType === 'tasks') {
      const rawTasks = db.prepare(`
        SELECT t.*, p.name AS project_name, u.full_name AS assignee_name
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN users u ON u.id = t.assignee_user_id
        WHERE t.company_id = ? AND (t.title LIKE ? OR t.description LIKE ?)
        ORDER BY t.updated_at DESC LIMIT 50
      `).all(companyId, like, like);
      results.tasks = rawTasks.filter((t) => canViewTask(db, auth, t));
    }

    if ((filterType === 'all' || filterType === 'employees') &&
        (auth.membership.role === 'owner' || auth.membership.role === 'manager' || hasPermission(auth, 'can_manage_employees'))) {
      results.employees = db.prepare(`
        SELECT m.id AS membership_id, m.user_id, m.role, m.job_title, m.status, m.employee_code,
               u.full_name, u.email, d.name AS department_name
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN departments d ON d.id = m.department_id
        WHERE m.company_id = ? AND (u.full_name LIKE ? OR u.email LIKE ? OR m.job_title LIKE ? OR m.employee_code LIKE ?)
        LIMIT 25
      `).all(companyId, like, like, like, like);
    }

    if (filterType === 'all' || filterType === 'departments') {
      results.departments = db.prepare(`
        SELECT d.*, u.full_name AS manager_name
        FROM departments d
        LEFT JOIN users u ON u.id = d.manager_user_id
        WHERE d.company_id = ? AND (d.name LIKE ? OR d.description LIKE ?)
        LIMIT 25
      `).all(companyId, like, like);
    }

    if (filterType === 'all' || filterType === 'comments') {
      const rawComments = db.prepare(`
        SELECT c.*, u.full_name AS author_name, t.title AS task_title
        FROM task_comments c
        JOIN users u ON u.id = c.user_id
        JOIN tasks t ON t.id = c.task_id
        WHERE c.company_id = ? AND c.content LIKE ?
        ORDER BY c.created_at DESC LIMIT 30
      `).all(companyId, like);

      results.comments = rawComments.filter((c) => {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(c.task_id, companyId);
        return task && canViewTask(db, auth, task);
      });
    }

    return sendJson(res, 200, results);
  }

  return false;
}

module.exports = {
  handleCompanyRoutes
};
