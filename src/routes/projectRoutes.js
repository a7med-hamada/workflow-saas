const { getDb, withTransaction, newId, nowIso } = require('../db');
const { hasPermission, canAccessProject } = require('../auth');
const { logAudit, getAuditLogs } = require('../audit');
const { evaluateDeadline } = require('../notifications');

function enrichProject(db, project, tz = 'Asia/Riyadh') {
  const tasks = db.prepare(`
    SELECT id, title, status, priority, deadline, assignee_user_id, progress
    FROM tasks
    WHERE company_id = ? AND project_id = ?
  `).all(project.company_id, project.id);

  const applicableTasks = tasks.filter((t) => t.status !== 'cancelled');
  const completedTasks = applicableTasks.filter((t) => t.status === 'completed');
  const inProgressTasks = applicableTasks.filter((t) => t.status === 'in_progress');
  const inReviewTasks = applicableTasks.filter((t) => t.status === 'in_review');
  const blockedTasks = applicableTasks.filter((t) => t.status === 'blocked');
  const overdueTasks = applicableTasks.filter((t) => evaluateDeadline(t.deadline, t.status, tz).isOverdue);

  const progressPercentage = applicableTasks.length > 0
    ? Math.round((completedTasks.length / applicableTasks.length) * 100)
    : 0;

  const projectDeadlineInfo = evaluateDeadline(project.deadline, project.status, tz);

  let health = 'on_track';
  if (project.status === 'completed') {
    health = 'completed';
  } else if (projectDeadlineInfo.isOverdue || (applicableTasks.length > 0 && overdueTasks.length / applicableTasks.length > 0.25)) {
    health = 'delayed';
  } else if (overdueTasks.length > 0 || blockedTasks.length > 0) {
    health = 'at_risk';
  }

  const members = db.prepare(`
    SELECT pm.user_id, pm.member_role, u.full_name, u.email, u.avatar_url, m.job_title, m.role
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN company_memberships m ON m.user_id = pm.user_id AND m.company_id = pm.company_id
    WHERE pm.company_id = ? AND pm.project_id = ?
  `).all(project.company_id, project.id);

  return {
    ...project,
    progress_percentage: progressPercentage,
    progress_formula: 'Completed Tasks / Total Non-Cancelled Tasks × 100',
    total_tasks: applicableTasks.length,
    cancelled_tasks: tasks.length - applicableTasks.length,
    completed_tasks: completedTasks.length,
    in_progress_tasks: inProgressTasks.length,
    in_review_tasks: inReviewTasks.length,
    blocked_tasks: blockedTasks.length,
    overdue_tasks: overdueTasks.length,
    open_tasks: applicableTasks.length - completedTasks.length,
    health,
    deadline_info: projectDeadlineInfo,
    members
  };
}

function handleProjectRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;
  const tz = (auth.settings && auth.settings.timezone) || 'Asia/Riyadh';

  // GET /api/projects
  if (req.method === 'GET' && pathname === '/api/projects') {
    const statusFilter = query.get('status') || null;
    const deptFilter = query.get('department_id') || null;
    const priorityFilter = query.get('priority') || null;
    const managerFilter = query.get('manager_user_id') || null;
    const search = (query.get('q') || '').trim();

    const clauses = ['p.company_id = ?'];
    const params = [companyId];

    if (statusFilter) {
      clauses.push('p.status = ?');
      params.push(statusFilter);
    }
    if (deptFilter) {
      clauses.push('p.department_id = ?');
      params.push(deptFilter);
    }
    if (priorityFilter) {
      clauses.push('p.priority = ?');
      params.push(priorityFilter);
    }
    if (managerFilter) {
      clauses.push('p.manager_user_id = ?');
      params.push(managerFilter);
    }
    if (search) {
      clauses.push('(p.name LIKE ? OR p.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const rawProjects = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, u.avatar_url AS manager_avatar, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.created_at DESC
    `).all(...params);

    const accessible = rawProjects
      .filter((p) => canAccessProject(db, auth, p))
      .map((p) => enrichProject(db, p, tz));

    return sendJson(res, 200, { projects: accessible });
  }

  // POST /api/projects
  if (req.method === 'POST' && pathname === '/api/projects') {
    if (!hasPermission(auth, 'can_create_projects')) {
      return sendJson(res, 403, { error: 'You do not have permission to create projects.' });
    }

    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const color = String(body.color || '#2563eb').trim();
    const coverUrl = String(body.cover_url || '').trim();
    const managerUserId = body.manager_user_id || auth.user.id;
    const departmentId = body.department_id || null;
    const startDate = body.start_date || nowIso().slice(0, 10);
    const deadline = body.deadline || null;
    const priority = ['low', 'medium', 'high', 'urgent'].includes(body.priority) ? body.priority : 'medium';
    const status = ['planning', 'active', 'on_hold', 'completed', 'archived'].includes(body.status) ? body.status : 'active';
    const budget = Number(body.budget || 0);
    const estimatedHours = Number(body.estimated_hours || 0);
    const visibility = ['public', 'team', 'confidential'].includes(body.visibility)
      ? body.visibility
      : ((auth.settings && auth.settings.default_project_visibility) || 'public');
    const requireApproval = body.require_approval !== undefined
      ? (body.require_approval ? 1 : 0)
      : (auth.settings && auth.settings.require_task_approval !== undefined ? auth.settings.require_task_approval : 1);

    if (!name) {
      return sendJson(res, 400, { error: 'Project name is required.' });
    }

    if (managerUserId) {
      const mgr = db.prepare('SELECT user_id FROM company_memberships WHERE company_id = ? AND user_id = ?')
        .get(companyId, managerUserId);
      if (!mgr) return sendJson(res, 400, { error: 'Project manager must belong to your company.' });
    }
    if (departmentId) {
      const dept = db.prepare('SELECT id FROM departments WHERE company_id = ? AND id = ?')
        .get(companyId, departmentId);
      if (!dept) return sendJson(res, 400, { error: 'Department does not exist in your company.' });
    }

    const projectId = newId('prj');
    const now = nowIso();

    withTransaction(() => {
      db.prepare(`
        INSERT INTO projects (
          id, company_id, name, description, color, cover_url, manager_user_id, department_id,
          start_date, deadline, priority, status, budget, estimated_hours, visibility, require_approval,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId,
        companyId,
        name,
        description,
        color,
        coverUrl,
        managerUserId,
        departmentId,
        startDate,
        deadline,
        priority,
        status,
        budget,
        estimatedHours,
        visibility,
        requireApproval,
        auth.user.id,
        now,
        now
      );

      const memberIds = new Set(Array.isArray(body.member_user_ids) ? body.member_user_ids.map(String) : []);
      if (managerUserId) memberIds.add(String(managerUserId));

      const insertMember = db.prepare(`
        INSERT OR IGNORE INTO project_members (id, company_id, project_id, user_id, member_role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const uid of memberIds) {
        const validMember = db.prepare('SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ?')
          .get(companyId, uid);
        if (validMember) {
          insertMember.run(newId('pm'), companyId, projectId, uid, uid === managerUserId ? 'manager' : 'member', now);
        }
      }

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'project.created',
        entityType: 'project',
        entityId: projectId,
        newValues: { name, priority, status, visibility, manager_user_id: managerUserId, deadline }
      });
    });

    const created = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.id = ?
    `).get(projectId);

    return sendJson(res, 201, { project: enrichProject(db, created, tz) });
  }

  // GET /api/projects/:id
  const projMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === 'GET' && projMatch) {
    const projectId = projMatch[1];
    const project = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, u.email AS manager_email, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.id = ? AND p.company_id = ?
    `).get(projectId, companyId);

    if (!project) {
      return sendJson(res, 404, { error: 'Project not found.' });
    }
    if (!canAccessProject(db, auth, project)) {
      return sendJson(res, 403, { error: 'You do not have permission to access this project.' });
    }

    const enriched = enrichProject(db, project, tz);

    const tasks = db.prepare(`
      SELECT t.*, u.full_name AS assignee_name, u.avatar_url AS assignee_avatar,
             d.name AS department_name,
             (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments_count,
             (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachments_count,
             (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtasks_total,
             (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id AND st.status = 'completed') AS subtasks_completed
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.company_id = ? AND t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(companyId, projectId).map((t) => ({
      ...t,
      deadline_info: evaluateDeadline(t.deadline, t.status, tz)
    }));

    const files = db.prepare(`
      SELECT a.*, u.full_name AS uploaded_by_name, t.title AS task_title
      FROM task_attachments a
      JOIN users u ON u.id = a.uploaded_by
      JOIN tasks t ON t.id = a.task_id
      WHERE a.company_id = ? AND a.project_id = ?
      ORDER BY a.created_at DESC
    `).all(companyId, projectId);

    const activity = db.prepare(`
      SELECT a.*, u.full_name AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.company_id = ?
        AND (
          (a.entity_type = 'project' AND a.entity_id = ?)
          OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE company_id = ? AND project_id = ?))
        )
      ORDER BY a.created_at DESC
      LIMIT 60
    `).all(companyId, projectId, companyId, projectId);

    // Upcoming deadlines in this project
    const upcomingDeadlines = tasks
      .filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.deadline)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
      .slice(0, 10);

    return sendJson(res, 200, {
      project: enriched,
      tasks,
      files,
      activity,
      upcoming_deadlines: upcomingDeadlines
    });
  }

  // PUT /api/projects/:id
  if (req.method === 'PUT' && projMatch) {
    const projectId = projMatch[1];
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(projectId, companyId);
    if (!project) {
      return sendJson(res, 404, { error: 'Project not found.' });
    }

    const canEdit =
      auth.membership.role === 'owner' ||
      project.manager_user_id === auth.user.id ||
      hasPermission(auth, 'can_create_projects');

    if (!canEdit) {
      return sendJson(res, 403, { error: 'You do not have permission to edit this project.' });
    }

    const newStatus = body.status && ['planning', 'active', 'on_hold', 'completed', 'archived'].includes(body.status)
      ? body.status
      : project.status;

    // Enforce completion rule: cannot mark project completed if non-cancelled tasks remain unfinished unless force_override is true
    if (newStatus === 'completed' && project.status !== 'completed') {
      const unfinishedRow = db.prepare(`
        SELECT COUNT(*) AS c FROM tasks
        WHERE company_id = ? AND project_id = ? AND status NOT IN ('completed', 'cancelled')
      `).get(companyId, projectId);
      const unfinishedCount = Number(unfinishedRow.c);

      if (unfinishedCount > 0 && !body.force_override) {
        return sendJson(res, 409, {
          error: `Cannot mark project as completed because ${unfinishedCount} required task(s) remain unfinished. Pass force_override: true to explicitly override.`,
          requires_override: true,
          unfinished_tasks_count: unfinishedCount
        });
      }
    }

    const now = nowIso();
    const newName = body.name !== undefined ? String(body.name).trim() : project.name;
    const newDesc = body.description !== undefined ? String(body.description).trim() : project.description;
    const newColor = body.color !== undefined ? String(body.color).trim() : project.color;
    const newCover = body.cover_url !== undefined ? String(body.cover_url).trim() : project.cover_url;
    const newManagerId = body.manager_user_id !== undefined ? (body.manager_user_id || null) : project.manager_user_id;
    const newDeptId = body.department_id !== undefined ? (body.department_id || null) : project.department_id;
    const newStart = body.start_date !== undefined ? body.start_date : project.start_date;
    const newDeadline = body.deadline !== undefined ? body.deadline : project.deadline;
    const newPriority = body.priority && ['low', 'medium', 'high', 'urgent'].includes(body.priority) ? body.priority : project.priority;
    const newBudget = body.budget !== undefined ? Number(body.budget) : project.budget;
    const newEstHours = body.estimated_hours !== undefined ? Number(body.estimated_hours) : project.estimated_hours;
    const newVisibility = body.visibility && ['public', 'team', 'confidential'].includes(body.visibility) ? body.visibility : project.visibility;
    const newReqApproval = body.require_approval !== undefined ? (body.require_approval ? 1 : 0) : project.require_approval;

    if (!newName) {
      return sendJson(res, 400, { error: 'Project name cannot be empty.' });
    }

    withTransaction(() => {
      db.prepare(`
        UPDATE projects
        SET name = ?, description = ?, color = ?, cover_url = ?, manager_user_id = ?, department_id = ?,
            start_date = ?, deadline = ?, priority = ?, status = ?, budget = ?, estimated_hours = ?,
            visibility = ?, require_approval = ?, updated_at = ?
        WHERE id = ? AND company_id = ?
      `).run(
        newName,
        newDesc,
        newColor,
        newCover,
        newManagerId,
        newDeptId,
        newStart,
        newDeadline,
        newPriority,
        newStatus,
        newBudget,
        newEstHours,
        newVisibility,
        newReqApproval,
        now,
        projectId,
        companyId
      );

      if (Array.isArray(body.member_user_ids)) {
        db.prepare('DELETE FROM project_members WHERE company_id = ? AND project_id = ?').run(companyId, projectId);
        const memberSet = new Set(body.member_user_ids.map(String));
        if (newManagerId) memberSet.add(String(newManagerId));
        const insertMember = db.prepare(`
          INSERT OR IGNORE INTO project_members (id, company_id, project_id, user_id, member_role, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const uid of memberSet) {
          insertMember.run(newId('pm'), companyId, projectId, uid, uid === newManagerId ? 'manager' : 'member', now);
        }
      }

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'project.updated',
        entityType: 'project',
        entityId: projectId,
        previousValues: { name: project.name, status: project.status, priority: project.priority, deadline: project.deadline },
        newValues: { name: newName, status: newStatus, priority: newPriority, deadline: newDeadline, force_override: Boolean(body.force_override) }
      });
    });

    const updated = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.id = ?
    `).get(projectId);

    return sendJson(res, 200, { project: enrichProject(db, updated, tz) });
  }

  // DELETE /api/projects/:id
  if (req.method === 'DELETE' && projMatch) {
    if (auth.membership.role !== 'owner') {
      return sendJson(res, 403, { error: 'Only the company owner is authorized to delete projects.' });
    }
    const projectId = projMatch[1];
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(projectId, companyId);
    if (!project) {
      return sendJson(res, 404, { error: 'Project not found.' });
    }

    db.prepare('DELETE FROM projects WHERE id = ? AND company_id = ?').run(projectId, companyId);

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'project.deleted',
      entityType: 'project',
      entityId: projectId,
      previousValues: { name: project.name, status: project.status }
    });

    return sendJson(res, 200, { ok: true });
  }

  return false;
}

module.exports = {
  handleProjectRoutes,
  enrichProject
};
