const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { getDb, withTransaction, newId, nowIso } = require('../db');
const {
  hasPermission,
  canAccessProject,
  canViewTask,
  canModifyTask
} = require('../auth');
const { logAudit, getAuditLogs, safeParseJson } = require('../audit');
const {
  createNotification,
  getCompanyDateString,
  evaluateDeadline
} = require('../notifications');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const DEFAULT_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled'];

function getAllowedStatuses(settings) {
  const custom = settings && settings.custom_task_statuses_json
    ? safeParseJson(settings.custom_task_statuses_json, [])
    : [];
  const codes = custom.map((c) => (typeof c === 'string' ? c : c.code)).filter(Boolean);
  return new Set([...DEFAULT_STATUSES, ...codes]);
}

function recalculateTaskActualHours(db, taskId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) AS total_mins
    FROM task_time_entries
    WHERE task_id = ? AND is_running = 0
  `).get(taskId);
  const hours = Number(((Number(row.total_mins) || 0) / 60).toFixed(2));
  db.prepare('UPDATE tasks SET actual_hours = ? WHERE id = ?').run(hours, taskId);
  return hours;
}

/**
 * Check if adding dependency (taskId depends on dependsOnTaskId) creates a cycle.
 * Returns true if a cycle would be created.
 */
function hasDependencyCycle(db, companyId, taskId, dependsOnTaskId) {
  if (taskId === dependsOnTaskId) return true;
  const visited = new Set();
  const queue = [dependsOnTaskId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const prereqs = db.prepare(`
      SELECT depends_on_task_id FROM task_dependencies
      WHERE company_id = ? AND task_id = ?
    `).all(companyId, current);
    for (const row of prereqs) {
      if (!visited.has(row.depends_on_task_id)) {
        queue.push(row.depends_on_task_id);
      }
    }
  }
  return false;
}

function enrichTaskSummary(db, task, tz = 'Asia/Riyadh') {
  const deadlineInfo = evaluateDeadline(task.deadline, task.status, tz);
  const collaborators = db.prepare(`
    SELECT ta.user_id, u.full_name, u.avatar_url
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.company_id = ? AND ta.task_id = ?
  `).all(task.company_id, task.id);

  const labels = db.prepare(`
    SELECT l.id, l.name, l.color
    FROM task_labels tl
    JOIN labels l ON l.id = tl.label_id
    WHERE tl.company_id = ? AND tl.task_id = ?
  `).all(task.company_id, task.id);

  const dependencies = db.prepare(`
    SELECT d.depends_on_task_id AS id, t.title, t.status, t.priority
    FROM task_dependencies d
    JOIN tasks t ON t.id = d.depends_on_task_id
    WHERE d.company_id = ? AND d.task_id = ?
  `).all(task.company_id, task.id);

  const isDependencyBlocked = dependencies.some((d) => d.status !== 'completed' && d.status !== 'cancelled');

  const checklistStats = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed
    FROM task_checklist_items
    WHERE company_id = ? AND task_id = ?
  `).get(task.company_id, task.id);

  const subtaskStats = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
    FROM tasks
    WHERE company_id = ? AND parent_task_id = ? AND status != 'cancelled'
  `).get(task.company_id, task.id);

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
  const attachments = db.prepare(`
    SELECT id, original_name, mime_type, extension, size_bytes, created_at
    FROM task_attachments
    WHERE company_id = ? AND task_id = ?
    ORDER BY created_at DESC
  `).all(task.company_id, task.id).map((a) => ({
    ...a,
    is_image: imageExts.has(String(a.extension || '').toLowerCase()) || String(a.mime_type || '').startsWith('image/')
  }));

  return {
    ...task,
    deadline_info: deadlineInfo,
    is_overdue: deadlineInfo.isOverdue,
    collaborators,
    labels,
    dependencies,
    is_dependency_blocked: isDependencyBlocked,
    checklist_total: Number(checklistStats.total || 0),
    checklist_completed: Number(checklistStats.completed || 0),
    subtasks_total: Number(subtaskStats.total || 0),
    subtasks_completed: Number(subtaskStats.completed || 0),
    attachments,
    attachments_count: attachments.length
  };
}

function handleTaskRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;
  const tz = (auth.settings && auth.settings.timezone) || 'Asia/Riyadh';
  const allowedStatuses = getAllowedStatuses(auth.settings);

  // GET /api/tasks
  if (req.method === 'GET' && pathname === '/api/tasks') {
    const projectId = query.get('project_id') || null;
    const departmentId = query.get('department_id') || null;
    const assigneeId = query.get('assignee_user_id') || null;
    const statusFilter = query.get('status') || null;
    const priorityFilter = query.get('priority') || null;
    const viewMode = query.get('view') || 'all';
    const search = (query.get('q') || '').trim();
    const includeSubtasks = query.get('include_subtasks') !== 'false';
    const sortBy = query.get('sort_by') || 'created_at';
    const sortDir = (query.get('sort_dir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const page = Math.max(1, Number(query.get('page') || 1));
    const limit = Math.min(500, Math.max(1, Number(query.get('limit') || 200)));

    const clauses = ['t.company_id = ?'];
    const params = [companyId];

    if (projectId) {
      clauses.push('t.project_id = ?');
      params.push(projectId);
    }
    if (departmentId) {
      clauses.push('t.department_id = ?');
      params.push(departmentId);
    }
    if (assigneeId) {
      clauses.push('(t.assignee_user_id = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))');
      params.push(assigneeId, assigneeId);
    }
    if (statusFilter) {
      clauses.push('t.status = ?');
      params.push(statusFilter);
    }
    if (priorityFilter) {
      clauses.push('t.priority = ?');
      params.push(priorityFilter);
    }
    if (!includeSubtasks) {
      clauses.push('t.parent_task_id IS NULL');
    }
    if (search) {
      clauses.push('(t.title LIKE ? OR t.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const validSortColumns = {
      created_at: 't.created_at',
      updated_at: 't.updated_at',
      deadline: 'COALESCE(t.deadline, "9999-12-31")',
      priority: "CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END",
      status: 't.status',
      title: 't.title',
      progress: 't.progress'
    };
    const orderExpr = validSortColumns[sortBy] || 't.created_at';

    const rawTasks = db.prepare(`
      SELECT t.*,
             p.name AS project_name, p.color AS project_color, p.visibility AS project_visibility, p.require_approval AS project_require_approval,
             u.full_name AS assignee_name, u.avatar_url AS assignee_avatar, u.email AS assignee_email,
             creator.full_name AS created_by_name,
             d.name AS department_name,
             pt.title AS parent_task_title,
             (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments_count,
             (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachments_count
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN users creator ON creator.id = t.created_by
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN tasks pt ON pt.id = t.parent_task_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${orderExpr} ${sortDir}
    `).all(...params);

    const visibleTasks = rawTasks
      .filter((t) => canViewTask(db, auth, t))
      .map((t) => enrichTaskSummary(db, t, tz));

    const todayStr = getCompanyDateString(new Date(), tz);
    const weekAgoMs = Date.now() - 7 * 24 * 3600 * 1000;

    const isMine = (t) =>
      t.assignee_user_id === auth.user.id ||
      t.collaborators.some((c) => c.user_id === auth.user.id);

    const myTasksAll = visibleTasks.filter(isMine);
    const myTasksSummary = {
      today_date: todayStr,
      timezone: tz,
      assigned_total: myTasksAll.filter((t) => t.status !== 'cancelled').length,
      open_count: myTasksAll.filter((t) => !['completed', 'cancelled'].includes(t.status)).length,
      in_progress_count: myTasksAll.filter((t) => t.status === 'in_progress').length,
      due_today_count: myTasksAll.filter((t) => t.deadline_info.code === 'due_today').length,
      overdue_count: myTasksAll.filter((t) => t.is_overdue).length,
      awaiting_review_count: myTasksAll.filter((t) => t.status === 'in_review').length,
      completed_this_week_count: myTasksAll.filter((t) => {
        if (t.status !== 'completed') return false;
        const ts = Date.parse(t.completed_at || t.updated_at);
        return !Number.isNaN(ts) && ts >= weekAgoMs;
      }).length
    };

    let filtered = visibleTasks;
    if (viewMode === 'my_tasks') {
      filtered = myTasksAll;
    } else if (viewMode === 'my_open') {
      filtered = myTasksAll.filter((t) => !['completed', 'cancelled'].includes(t.status));
    } else if (viewMode === 'in_progress') {
      filtered = myTasksAll.filter((t) => t.status === 'in_progress');
    } else if (viewMode === 'due_today') {
      filtered = myTasksAll.filter((t) => t.deadline_info.code === 'due_today');
    } else if (viewMode === 'overdue') {
      filtered = visibleTasks.filter((t) => t.is_overdue);
    } else if (viewMode === 'my_overdue') {
      filtered = myTasksAll.filter((t) => t.is_overdue);
    } else if (viewMode === 'awaiting_review') {
      filtered = visibleTasks.filter((t) => t.status === 'in_review');
    } else if (viewMode === 'my_awaiting_review') {
      filtered = myTasksAll.filter((t) => t.status === 'in_review');
    } else if (viewMode === 'completed') {
      filtered = myTasksAll.filter((t) => t.status === 'completed');
    }

    const total = filtered.length;
    const startIdx = (page - 1) * limit;
    const paginated = filtered.slice(startIdx, startIdx + limit);

    return sendJson(res, 200, {
      tasks: paginated,
      total,
      page,
      limit,
      my_tasks_summary: myTasksSummary
    });
  }

  // POST /api/tasks
  if (req.method === 'POST' && pathname === '/api/tasks') {
    const canCreateTeamTask =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_create_tasks');

    const allowPersonal = Boolean(auth.settings && auth.settings.allow_employee_personal_tasks);

    // Check if employee is creating a subtask for their own task or a personal task
    let isAllowedSubtask = false;
    if (body.parent_task_id) {
      const parentTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?')
        .get(String(body.parent_task_id), companyId);
      if (!parentTask) {
        return sendJson(res, 400, { error: 'Parent task does not exist in your company.' });
      }
      if (canModifyTask(db, auth, parentTask)) {
        isAllowedSubtask = true;
      }
    }

    if (!canCreateTeamTask && !allowPersonal && !isAllowedSubtask) {
      return sendJson(res, 403, { error: 'You do not have permission to create tasks.' });
    }

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    if (!title) {
      return sendJson(res, 400, { error: 'Task title is required.' });
    }

    const projectId = body.project_id || null;
    let project = null;
    if (projectId) {
      project = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(projectId, companyId);
      if (!project) {
        return sendJson(res, 400, { error: 'Selected project does not belong to your company.' });
      }
      if (!canAccessProject(db, auth, project)) {
        return sendJson(res, 403, { error: 'You do not have access to this project.' });
      }
    }

    const departmentId = body.department_id || (project ? project.department_id : auth.membership.department_id) || null;
    if (departmentId) {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?').get(departmentId, companyId);
      if (!dept) {
        return sendJson(res, 400, { error: 'Selected department does not exist in your company.' });
      }
    }

    let assigneeUserId = body.assignee_user_id !== undefined ? (body.assignee_user_id || null) : null;
    // Employees without can_assign_tasks can only assign personal tasks to themselves
    if (!canCreateTeamTask && !hasPermission(auth, 'can_assign_tasks')) {
      assigneeUserId = auth.user.id;
    }

    if (assigneeUserId) {
      const assigneeMember = db.prepare(
        "SELECT user_id FROM company_memberships WHERE company_id = ? AND user_id = ? AND status = 'active'"
      ).get(companyId, assigneeUserId);
      if (!assigneeMember) {
        return sendJson(res, 400, { error: 'Assigned employee is not an active member of your company.' });
      }
    }

    const priority = VALID_PRIORITIES.includes(body.priority)
      ? body.priority
      : ((auth.settings && auth.settings.default_task_priority) || 'medium');
    const status = allowedStatuses.has(body.status)
      ? body.status
      : ((auth.settings && auth.settings.default_task_status) || 'todo');
    const startDate = body.start_date || nowIso().slice(0, 10);
    const deadline = body.deadline || null;
    const estimatedHours = Math.max(0, Number(body.estimated_hours || 0));
    const parentTaskId = body.parent_task_id || null;
    const progress = status === 'completed' ? 100 : Math.min(100, Math.max(0, Number(body.progress || 0)));

    const taskId = newId('tsk');
    const now = nowIso();

    withTransaction(() => {
      db.prepare(`
        INSERT INTO tasks (
          id, company_id, project_id, department_id, parent_task_id,
          title, description, assignee_user_id, created_by,
          priority, status, progress, start_date, deadline,
          estimated_hours, actual_hours, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        taskId,
        companyId,
        projectId,
        departmentId,
        parentTaskId,
        title,
        description,
        assigneeUserId,
        auth.user.id,
        priority,
        status,
        progress,
        startDate,
        deadline,
        estimatedHours,
        status === 'completed' ? now : null,
        now,
        now
      );

      // Additional collaborators
      if (Array.isArray(body.collaborator_user_ids)) {
        const insertCollab = db.prepare(`
          INSERT OR IGNORE INTO task_assignees (id, company_id, task_id, user_id, role, created_at)
          VALUES (?, ?, ?, ?, 'collaborator', ?)
        `);
        for (const uid of body.collaborator_user_ids) {
          const valid = db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND status = 'active'")
            .get(companyId, String(uid));
          if (valid && String(uid) !== assigneeUserId) {
            insertCollab.run(newId('ta'), companyId, taskId, String(uid), now);
          }
        }
      }

      // Optional initial checklist items
      if (Array.isArray(body.checklist_items) && body.checklist_items.length > 0) {
        const checklistId = newId('chk');
        db.prepare('INSERT INTO task_checklists (id, company_id, task_id, title, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(checklistId, companyId, taskId, 'Checklist', now);
        const insertItem = db.prepare(`
          INSERT INTO task_checklist_items (
            id, company_id, task_id, checklist_id, title, is_completed, is_required, sort_order, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        body.checklist_items.forEach((item, idx) => {
          const itemTitle = typeof item === 'string' ? item.trim() : String(item.title || '').trim();
          if (itemTitle) {
            insertItem.run(newId('chi'), companyId, taskId, checklistId, itemTitle, item.is_completed ? 1 : 0, item.is_required !== false ? 1 : 0, idx, now);
          }
        });
      }

      // Optional initial dependencies
      if (Array.isArray(body.depends_on_task_ids)) {
        const insertDep = db.prepare(`
          INSERT OR IGNORE INTO task_dependencies (id, company_id, task_id, depends_on_task_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const depId of body.depends_on_task_ids) {
          const target = db.prepare('SELECT id FROM tasks WHERE id = ? AND company_id = ?').get(String(depId), companyId);
          if (target && !hasDependencyCycle(db, companyId, taskId, target.id)) {
            insertDep.run(newId('dep'), companyId, taskId, target.id, now);
          }
        }
      }

      // Optional labels
      if (Array.isArray(body.label_ids)) {
        const insertLbl = db.prepare(`
          INSERT OR IGNORE INTO task_labels (id, company_id, task_id, label_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const lid of body.label_ids) {
          const validLbl = db.prepare('SELECT id FROM labels WHERE id = ? AND company_id = ?').get(String(lid), companyId);
          if (validLbl) {
            insertLbl.run(newId('tl'), companyId, taskId, validLbl.id, now);
          }
        }
      }

      // Optional initial attachments (e.g. reference image/logo and/or reference file from manager)
      if (Array.isArray(body.initial_attachments) && body.initial_attachments.length > 0) {
        const companyUploadDir = path.join(config.uploadDir, companyId);
        if (!fs.existsSync(companyUploadDir)) {
          fs.mkdirSync(companyUploadDir, { recursive: true });
        }
        const maxMb = Number((auth.settings && auth.settings.max_upload_size_mb) || config.maxUploadSizeMb || 10);
        const maxBytes = maxMb * 1024 * 1024;

        for (const att of body.initial_attachments) {
          if (!att || !att.filename || !att.content_base64) continue;
          const origName = path.basename(String(att.filename).trim());
          const ext = path.extname(origName).toLowerCase();
          if (!config.allowedExtensions.has(ext)) continue;

          const cleanB64 = String(att.content_base64).replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(cleanB64, 'base64');
          if (buf.length <= 0 || buf.length > maxBytes) continue;

          const attId = newId('att');
          const safeBase = origName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storedName = `${attId}_${crypto.randomBytes(6).toString('hex')}_${safeBase}`;
          const storagePath = path.join(companyUploadDir, storedName);
          fs.writeFileSync(storagePath, buf);

          db.prepare(`
            INSERT INTO task_attachments (
              id, company_id, task_id, project_id, uploaded_by,
              original_name, stored_name, storage_path, mime_type, extension, size_bytes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            attId,
            companyId,
            taskId,
            projectId || null,
            auth.user.id,
            origName,
            storedName,
            storagePath,
            String(att.mime_type || 'application/octet-stream').toLowerCase(),
            ext,
            buf.length,
            now
          );
        }
      }

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'task.created',
        entityType: 'task',
        entityId: taskId,
        newValues: { title, project_id: projectId, assignee_user_id: assigneeUserId, priority, status, deadline }
      });

      if (assigneeUserId) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.assigned',
          entityType: 'task',
          entityId: taskId,
          previousValues: { assignee_user_id: null },
          newValues: { assignee_user_id: assigneeUserId }
        });

        createNotification({
          companyId,
          userId: assigneeUserId,
          type: 'task_assigned',
          titleAr: 'تم إسناد مهمة جديدة إليك',
          titleEn: 'New Task Assigned to You',
          messageAr: `تم إسناد المهمة "${title}" إليك${deadline ? ` (الموعد النهائي: ${deadline})` : ''}.`,
          messageEn: `You have been assigned to task "${title}"${deadline ? ` (Deadline: ${deadline})` : ''}.`,
          entityType: 'task',
          entityId: taskId,
          linkUrl: `#/tasks?taskId=${taskId}`
        });
      }

      if (priority === 'urgent') {
        const managerTarget = (project && project.manager_user_id) || auth.company.owner_user_id;
        if (managerTarget && managerTarget !== auth.user.id) {
          createNotification({
            companyId,
            userId: managerTarget,
            type: 'urgent_task_created',
            titleAr: 'تنبيه: تم إنشاء مهمة عاجلة',
            titleEn: 'Alert: Urgent Task Created',
            messageAr: `تم إنشاء مهمة عاجلة بعنوان "${title}".`,
            messageEn: `An urgent task "${title}" has been created.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      }
    });

    const createdTask = db.prepare(`
      SELECT t.*, p.name AS project_name, u.full_name AS assignee_name, d.name AS department_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ?
    `).get(taskId);

    return sendJson(res, 201, { task: enrichTaskSummary(db, createdTask, tz) });
  }

  // POST /api/tasks/bulk
  if (req.method === 'POST' && pathname === '/api/tasks/bulk') {
    const canBulkManage =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_assign_tasks');

    if (!canBulkManage) {
      return sendJson(res, 403, { error: 'Only managers and owners can perform bulk task actions.' });
    }

    const taskIds = Array.isArray(body.task_ids) ? body.task_ids.map(String) : [];
    const action = String(body.action || '');
    if (!taskIds.length || !action) {
      return sendJson(res, 400, { error: 'task_ids array and action are required.' });
    }

    if (action === 'delete') {
      if (auth.membership.role !== 'owner' && !hasPermission(auth, 'can_delete_tasks')) {
        return sendJson(res, 403, { error: 'You do not have permission to delete tasks.' });
      }
      if (!body.confirmed) {
        return sendJson(res, 400, { error: 'Confirmation (confirmed: true) is required for bulk task deletion.' });
      }
    }

    let affectedCount = 0;
    const now = nowIso();

    withTransaction(() => {
      for (const tid of taskIds) {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(tid, companyId);
        if (!task || !canModifyTask(db, auth, task)) continue;

        if (action === 'priority' && VALID_PRIORITIES.includes(body.priority)) {
          db.prepare('UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?').run(body.priority, now, tid);
          logAudit({
            companyId,
            actorUserId: auth.user.id,
            action: 'task.priority_changed',
            entityType: 'task',
            entityId: tid,
            previousValues: { priority: task.priority },
            newValues: { priority: body.priority }
          });
          affectedCount++;
        } else if (action === 'status' && allowedStatuses.has(body.status)) {
          const completedAt = body.status === 'completed' ? now : (task.status === 'completed' ? null : task.completed_at);
          const progress = body.status === 'completed' ? 100 : task.progress;
          db.prepare('UPDATE tasks SET status = ?, progress = ?, completed_at = ?, updated_at = ? WHERE id = ?')
            .run(body.status, progress, completedAt, now, tid);
          logAudit({
            companyId,
            actorUserId: auth.user.id,
            action: 'task.status_changed',
            entityType: 'task',
            entityId: tid,
            previousValues: { status: task.status },
            newValues: { status: body.status }
          });
          affectedCount++;
        } else if (action === 'reassign') {
          const newAssignee = body.assignee_user_id || null;
          if (newAssignee) {
            const validEmp = db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND status = 'active'")
              .get(companyId, newAssignee);
            if (!validEmp) continue;
          }
          db.prepare('UPDATE tasks SET assignee_user_id = ?, updated_at = ? WHERE id = ?').run(newAssignee, now, tid);
          logAudit({
            companyId,
            actorUserId: auth.user.id,
            action: 'task.reassigned',
            entityType: 'task',
            entityId: tid,
            previousValues: { assignee_user_id: task.assignee_user_id },
            newValues: { assignee_user_id: newAssignee }
          });
          if (newAssignee) {
            createNotification({
              companyId,
              userId: newAssignee,
              type: 'task_reassigned',
              titleAr: 'تم تحويل مهمة إليك',
              titleEn: 'Task Reassigned to You',
              messageAr: `تم إسناد المهمة "${task.title}" إليك.`,
              messageEn: `Task "${task.title}" has been reassigned to you.`,
              entityType: 'task',
              entityId: tid,
              linkUrl: `#/tasks?taskId=${tid}`
            });
          }
          affectedCount++;
        } else if (action === 'delete') {
          db.prepare('DELETE FROM tasks WHERE id = ? AND company_id = ?').run(tid, companyId);
          logAudit({
            companyId,
            actorUserId: auth.user.id,
            action: 'task.deleted',
            entityType: 'task',
            entityId: tid,
            previousValues: { title: task.title, status: task.status }
          });
          affectedCount++;
        }
      }
    });

    return sendJson(res, 200, { ok: true, affected_count: affectedCount });
  }

  // GET /api/tasks/:id
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && taskMatch && taskMatch[1] !== 'bulk') {
    const taskId = taskMatch[1];
    const task = db.prepare(`
      SELECT t.*,
             p.name AS project_name, p.color AS project_color, p.require_approval AS project_require_approval, p.manager_user_id AS project_manager_id,
             u.full_name AS assignee_name, u.email AS assignee_email, u.avatar_url AS assignee_avatar,
             creator.full_name AS created_by_name,
             d.name AS department_name,
             pt.title AS parent_task_title
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN users creator ON creator.id = t.created_by
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN tasks pt ON pt.id = t.parent_task_id
      WHERE t.id = ? AND t.company_id = ?
    `).get(taskId, companyId);

    if (!task) {
      return sendJson(res, 404, { error: 'Task not found.' });
    }
    if (!canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'You do not have permission to view this task.' });
    }

    const enriched = enrichTaskSummary(db, task, tz);

    const subtasks = db.prepare(`
      SELECT st.*, u.full_name AS assignee_name
      FROM tasks st
      LEFT JOIN users u ON u.id = st.assignee_user_id
      WHERE st.company_id = ? AND st.parent_task_id = ?
      ORDER BY st.created_at ASC
    `).all(companyId, taskId).map((st) => ({
      ...st,
      deadline_info: evaluateDeadline(st.deadline, st.status, tz)
    }));

    const checklistItems = db.prepare(`
      SELECT ci.*, u.full_name AS completed_by_name
      FROM task_checklist_items ci
      LEFT JOIN users u ON u.id = ci.completed_by
      WHERE ci.company_id = ? AND ci.task_id = ?
      ORDER BY ci.sort_order ASC, ci.created_at ASC
    `).all(companyId, taskId);

    const dependents = db.prepare(`
      SELECT d.task_id AS id, t.title, t.status, t.priority
      FROM task_dependencies d
      JOIN tasks t ON t.id = d.task_id
      WHERE d.company_id = ? AND d.depends_on_task_id = ?
    `).all(companyId, taskId);

    const comments = db.prepare(`
      SELECT c.*, u.full_name AS author_name, u.avatar_url AS author_avatar, m.role AS author_role
      FROM task_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN company_memberships m ON m.user_id = c.user_id AND m.company_id = c.company_id
      WHERE c.company_id = ? AND c.task_id = ?
      ORDER BY c.created_at ASC
    `).all(companyId, taskId).map((c) => ({
      ...c,
      mentions: safeParseJson(c.mentions_json, [])
    }));

    const attachments = db.prepare(`
      SELECT a.id, a.company_id, a.task_id, a.project_id, a.uploaded_by, u.full_name AS uploaded_by_name,
             a.original_name, a.mime_type, a.extension, a.size_bytes, a.created_at
      FROM task_attachments a
      JOIN users u ON u.id = a.uploaded_by
      WHERE a.company_id = ? AND a.task_id = ?
      ORDER BY a.created_at DESC
    `).all(companyId, taskId);

    const reviews = db.prepare(`
      SELECT r.*, sub.full_name AS submitted_by_name, rev.full_name AS reviewer_name
      FROM task_reviews r
      LEFT JOIN users sub ON sub.id = r.submitted_by
      LEFT JOIN users rev ON rev.id = r.reviewer_user_id
      WHERE r.company_id = ? AND r.task_id = ?
      ORDER BY r.created_at DESC
    `).all(companyId, taskId);

    const timeEntries = db.prepare(`
      SELECT te.*, u.full_name AS user_name
      FROM task_time_entries te
      JOIN users u ON u.id = te.user_id
      WHERE te.company_id = ? AND te.task_id = ?
      ORDER BY te.start_time DESC
    `).all(companyId, taskId);

    const activity = getAuditLogs({
      companyId,
      entityType: 'task',
      entityId: taskId,
      limit: 80
    });

    const approvalRequired = task.project_id
      ? Boolean(task.project_require_approval)
      : Boolean(auth.settings && auth.settings.require_task_approval);

    return sendJson(res, 200, {
      task: {
        ...enriched,
        require_approval: approvalRequired,
        can_modify: canModifyTask(db, auth, task),
        can_approve: auth.membership.role === 'owner' || auth.membership.role === 'manager' || hasPermission(auth, 'can_approve_work')
      },
      subtasks,
      checklist_items: checklistItems,
      dependents,
      comments,
      attachments,
      reviews,
      time_entries: timeEntries,
      activity
    });
  }

  // PUT /api/tasks/:id
  if (req.method === 'PUT' && taskMatch && taskMatch[1] !== 'bulk') {
    const taskId = taskMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task) {
      return sendJson(res, 404, { error: 'Task not found.' });
    }
    if (!canModifyTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'You are not authorized to modify a task assigned to another employee.' });
    }

    const project = task.project_id
      ? db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(task.project_id, companyId)
      : null;

    const approvalRequired = project
      ? Boolean(project.require_approval)
      : Boolean(auth.settings && auth.settings.require_task_approval);

    const canApprove =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_approve_work');

    const newStatus = body.status && allowedStatuses.has(body.status) ? body.status : task.status;

    // Enforce approval workflow when an employee attempts to mark task completed directly
    if (newStatus === 'completed' && task.status !== 'completed' && approvalRequired && !canApprove) {
      return sendJson(res, 403, {
        error: 'Task approval workflow is enabled. Please submit this task for review (in_review) so a manager can approve it.',
        requires_review: true
      });
    }

    // Check incomplete subtasks or required checklist items before completion
    if ((newStatus === 'completed' || newStatus === 'in_review') && task.status !== newStatus) {
      const warnSubtasks = auth.settings ? Boolean(auth.settings.warn_incomplete_subtasks) : true;
      if (warnSubtasks && !body.force_complete_subtasks) {
        const incompleteSubtasks = Number(
          db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE company_id = ? AND parent_task_id = ? AND status NOT IN ('completed', 'cancelled')")
            .get(companyId, taskId).c
        );
        const incompleteChecklist = Number(
          db.prepare('SELECT COUNT(*) AS c FROM task_checklist_items WHERE company_id = ? AND task_id = ? AND is_required = 1 AND is_completed = 0')
            .get(companyId, taskId).c
        );
        if (incompleteSubtasks > 0 || incompleteChecklist > 0) {
          return sendJson(res, 409, {
            error: `This task has ${incompleteSubtasks} incomplete subtask(s) and ${incompleteChecklist} incomplete checklist item(s). Confirm to proceed.`,
            requires_confirmation: true,
            incomplete_subtasks_count: incompleteSubtasks,
            incomplete_checklist_count: incompleteChecklist
          });
        }
      }
    }

    // Check prerequisite dependencies before moving to in_progress or completed
    if ((newStatus === 'in_progress' || newStatus === 'completed') && task.status !== newStatus && !body.force_dependency_override) {
      const blockingDeps = db.prepare(`
        SELECT t.id, t.title, t.status
        FROM task_dependencies d
        JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.company_id = ? AND d.task_id = ? AND t.status NOT IN ('completed', 'cancelled')
      `).all(companyId, taskId);

      if (blockingDeps.length > 0) {
        return sendJson(res, 409, {
          error: `This task is blocked by prerequisite task "${blockingDeps[0].title}" (${blockingDeps[0].status}).`,
          blocked_by_dependencies: blockingDeps
        });
      }
    }

    // Reassignment check
    let newAssigneeId = task.assignee_user_id;
    if (body.assignee_user_id !== undefined && body.assignee_user_id !== task.assignee_user_id) {
      const canReassign =
        auth.membership.role === 'owner' ||
        auth.membership.role === 'manager' ||
        hasPermission(auth, 'can_assign_tasks');
      if (!canReassign) {
        return sendJson(res, 403, { error: 'You do not have permission to reassign tasks.' });
      }
      newAssigneeId = body.assignee_user_id || null;
      if (newAssigneeId) {
        const validMember = db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND status = 'active'")
          .get(companyId, newAssigneeId);
        if (!validMember) {
          return sendJson(res, 400, { error: 'New assignee is not an active member of this company.' });
        }
      }
    }

    // Priority & Deadline change authorization for employees
    let newPriority = task.priority;
    if (body.priority && VALID_PRIORITIES.includes(body.priority) && body.priority !== task.priority) {
      newPriority = body.priority;
    }

    let newDeadline = task.deadline;
    if (body.deadline !== undefined && body.deadline !== task.deadline) {
      const canSetDeadline =
        auth.membership.role === 'owner' ||
        auth.membership.role === 'manager' ||
        hasPermission(auth, 'can_assign_tasks') ||
        (!task.project_id && task.created_by === auth.user.id);
      if (!canSetDeadline) {
        return sendJson(res, 403, { error: 'Employees cannot directly change assigned project task deadlines. Please request a deadline extension instead.' });
      }
      newDeadline = body.deadline || null;
    }

    const newTitle = body.title !== undefined ? String(body.title).trim() : task.title;
    const newDesc = body.description !== undefined ? String(body.description).trim() : task.description;
    const newProjectId = body.project_id !== undefined ? (body.project_id || null) : task.project_id;
    const newDeptId = body.department_id !== undefined ? (body.department_id || null) : task.department_id;
    const newStartDate = body.start_date !== undefined ? body.start_date : task.start_date;
    const newEstHours = body.estimated_hours !== undefined ? Math.max(0, Number(body.estimated_hours)) : task.estimated_hours;
    const newBlockerReason = body.blocker_reason !== undefined ? String(body.blocker_reason).trim() : task.blocker_reason;
    const newClarification = body.clarification_request !== undefined ? String(body.clarification_request).trim() : task.clarification_request;

    // Extension request handling
    let newExtDate = task.extension_requested_date;
    let newExtReason = task.extension_reason;
    let newExtStatus = task.extension_status;

    if (body.extension_requested_date) {
      newExtDate = String(body.extension_requested_date);
      newExtReason = String(body.extension_reason || '').trim();
      newExtStatus = 'pending';
    }
    if (body.extension_decision && (auth.membership.role === 'owner' || auth.membership.role === 'manager')) {
      if (body.extension_decision === 'approved' && newExtDate) {
        newDeadline = newExtDate;
        newExtStatus = 'approved';
      } else if (body.extension_decision === 'rejected') {
        newExtStatus = 'rejected';
      }
    }

    let newProgress = body.progress !== undefined ? Math.min(100, Math.max(0, Number(body.progress))) : task.progress;
    if (newStatus === 'completed') newProgress = 100;
    else if (newStatus === 'in_review' && newProgress < 90) newProgress = 95;
    else if (newStatus === 'in_progress' && newProgress === 0) newProgress = 25;

    const now = nowIso();
    const completedAt = newStatus === 'completed'
      ? (task.completed_at || now)
      : null;

    withTransaction(() => {
      db.prepare(`
        UPDATE tasks
        SET project_id = ?, department_id = ?, title = ?, description = ?,
            assignee_user_id = ?, priority = ?, status = ?, progress = ?,
            start_date = ?, deadline = ?, estimated_hours = ?,
            blocker_reason = ?, extension_requested_date = ?, extension_reason = ?, extension_status = ?,
            clarification_request = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND company_id = ?
      `).run(
        newProjectId,
        newDeptId,
        newTitle,
        newDesc,
        newAssigneeId,
        newPriority,
        newStatus,
        newProgress,
        newStartDate,
        newDeadline,
        newEstHours,
        newBlockerReason,
        newExtDate,
        newExtReason,
        newExtStatus,
        newClarification,
        completedAt,
        now,
        taskId,
        companyId
      );

      if (Array.isArray(body.collaborator_user_ids)) {
        db.prepare('DELETE FROM task_assignees WHERE company_id = ? AND task_id = ?').run(companyId, taskId);
        const insertCollab = db.prepare(`
          INSERT OR IGNORE INTO task_assignees (id, company_id, task_id, user_id, role, created_at)
          VALUES (?, ?, ?, ?, 'collaborator', ?)
        `);
        for (const uid of body.collaborator_user_ids) {
          const valid = db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND status = 'active'")
            .get(companyId, String(uid));
          if (valid && String(uid) !== newAssigneeId) {
            insertCollab.run(newId('ta'), companyId, taskId, String(uid), now);
          }
        }
      }

      // Record granular audit logs & notifications
      if (newAssigneeId !== task.assignee_user_id) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.reassigned',
          entityType: 'task',
          entityId: taskId,
          previousValues: { assignee_user_id: task.assignee_user_id },
          newValues: { assignee_user_id: newAssigneeId },
          reason: body.reassignment_reason || ''
        });
        if (newAssigneeId) {
          createNotification({
            companyId,
            userId: newAssigneeId,
            type: 'task_reassigned',
            titleAr: 'تم تحويل مهمة إليك',
            titleEn: 'Task Reassigned to You',
            messageAr: `تم تحويل المهمة "${newTitle}" إليك.`,
            messageEn: `Task "${newTitle}" has been reassigned to you.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      }

      if (newStatus !== task.status) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: taskId,
          previousValues: { status: task.status },
          newValues: { status: newStatus }
        });

        const managerTarget = (project && project.manager_user_id) || task.created_by || auth.company.owner_user_id;

        if (newStatus === 'in_review') {
          db.prepare(`
            INSERT INTO task_reviews (id, company_id, task_id, submitted_by, action, feedback, created_at)
            VALUES (?, ?, ?, ?, 'submitted', ?, ?)
          `).run(newId('rev'), companyId, taskId, auth.user.id, body.review_note || 'Submitted for review', now);

          if (managerTarget && managerTarget !== auth.user.id) {
            createNotification({
              companyId,
              userId: managerTarget,
              type: 'work_submitted_for_review',
              titleAr: 'عمل مرسل للمراجعة والاعتماد',
              titleEn: 'Work Submitted for Review',
              messageAr: `قام ${auth.user.full_name} بإرسال المهمة "${newTitle}" للمراجعة.`,
              messageEn: `${auth.user.full_name} submitted task "${newTitle}" for review.`,
              entityType: 'task',
              entityId: taskId,
              linkUrl: `#/tasks?taskId=${taskId}`
            });
          }
        }

        if (newStatus === 'blocked') {
          if (managerTarget && managerTarget !== auth.user.id) {
            createNotification({
              companyId,
              userId: managerTarget,
              type: 'task_blocked',
              titleAr: 'تنبيه: مهمة متوقفة بسبب عائق',
              titleEn: 'Alert: Task Blocked',
              messageAr: `المهمة "${newTitle}" متوقفة حالياً${newBlockerReason ? `: ${newBlockerReason}` : ''}.`,
              messageEn: `Task "${newTitle}" was marked as blocked${newBlockerReason ? `: ${newBlockerReason}` : ''}.`,
              entityType: 'task',
              entityId: taskId,
              linkUrl: `#/tasks?taskId=${taskId}`
            });
          }
        }
      }

      if (newPriority !== task.priority) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.priority_changed',
          entityType: 'task',
          entityId: taskId,
          previousValues: { priority: task.priority },
          newValues: { priority: newPriority }
        });
      }

      if (newDeadline !== task.deadline) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.deadline_changed',
          entityType: 'task',
          entityId: taskId,
          previousValues: { deadline: task.deadline },
          newValues: { deadline: newDeadline }
        });

        if (newAssigneeId && newAssigneeId !== auth.user.id) {
          createNotification({
            companyId,
            userId: newAssigneeId,
            type: 'task_deadline_changed',
            titleAr: 'تم تعديل الموعد النهائي للمهمة',
            titleEn: 'Task Deadline Changed',
            messageAr: `تم تحديث الموعد النهائي للمهمة "${newTitle}" إلى ${newDeadline || 'بدون موعد'}.`,
            messageEn: `Deadline for task "${newTitle}" was updated to ${newDeadline || 'none'}.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      }

      if (body.extension_requested_date) {
        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.extension_requested',
          entityType: 'task',
          entityId: taskId,
          previousValues: { deadline: task.deadline },
          newValues: { requested_deadline: newExtDate, reason: newExtReason }
        });
        const managerTarget = (project && project.manager_user_id) || task.created_by || auth.company.owner_user_id;
        if (managerTarget && managerTarget !== auth.user.id) {
          createNotification({
            companyId,
            userId: managerTarget,
            type: 'deadline_extension_requested',
            titleAr: 'طلب تمديد موعد نهائي لمهمة',
            titleEn: 'Deadline Extension Requested',
            messageAr: `طلب ${auth.user.full_name} تمديد موعد المهمة "${newTitle}" إلى ${newExtDate}.`,
            messageEn: `${auth.user.full_name} requested a deadline extension for "${newTitle}" to ${newExtDate}.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      }
    });

    const updated = db.prepare(`
      SELECT t.*, p.name AS project_name, u.full_name AS assignee_name, d.name AS department_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ?
    `).get(taskId);

    return sendJson(res, 200, { task: enrichTaskSummary(db, updated, tz) });
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE' && taskMatch && taskMatch[1] !== 'bulk') {
    const taskId = taskMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task) {
      return sendJson(res, 404, { error: 'Task not found.' });
    }

    const canDelete =
      auth.membership.role === 'owner' ||
      hasPermission(auth, 'can_delete_tasks') ||
      (!task.project_id && task.created_by === auth.user.id);

    if (!canDelete) {
      return sendJson(res, 403, { error: 'You do not have permission to delete this task.' });
    }

    db.prepare('DELETE FROM tasks WHERE id = ? AND company_id = ?').run(taskId, companyId);
    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'task.deleted',
      entityType: 'task',
      entityId: taskId,
      previousValues: { title: task.title, status: task.status }
    });

    return sendJson(res, 200, { ok: true });
  }

  // POST /api/tasks/:id/review (Submit for review, Approve, Request Changes, Reopen)
  const reviewMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/review$/);
  if (req.method === 'POST' && reviewMatch) {
    const taskId = reviewMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task) {
      return sendJson(res, 404, { error: 'Task not found.' });
    }

    const action = String(body.action || '').trim(); // 'submit', 'approve', 'request_changes', 'reopen'
    const feedback = String(body.feedback || '').trim();
    const now = nowIso();

    const project = task.project_id
      ? db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(task.project_id, companyId)
      : null;

    if (action === 'submit') {
      if (!canModifyTask(db, auth, task)) {
        return sendJson(res, 403, { error: 'You cannot submit a task assigned to another employee.' });
      }

      withTransaction(() => {
        db.prepare(`
          UPDATE tasks SET status = 'in_review', progress = CASE WHEN progress < 95 THEN 95 ELSE progress END, updated_at = ?
          WHERE id = ? AND company_id = ?
        `).run(now, taskId, companyId);

        db.prepare(`
          INSERT INTO task_reviews (id, company_id, task_id, submitted_by, action, feedback, created_at)
          VALUES (?, ?, ?, ?, 'submitted', ?, ?)
        `).run(newId('rev'), companyId, taskId, auth.user.id, feedback, now);

        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.submitted_for_review',
          entityType: 'task',
          entityId: taskId,
          previousValues: { status: task.status },
          newValues: { status: 'in_review', feedback }
        });

        const managerTarget = (project && project.manager_user_id) || task.created_by || auth.company.owner_user_id;
        if (managerTarget && managerTarget !== auth.user.id) {
          createNotification({
            companyId,
            userId: managerTarget,
            type: 'work_submitted_for_review',
            titleAr: 'مهمة بانتظار المراجعة والاعتماد',
            titleEn: 'Task Submitted for Review',
            messageAr: `أرسل ${auth.user.full_name} المهمة "${task.title}" للمراجعة.`,
            messageEn: `${auth.user.full_name} submitted "${task.title}" for review.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      });

      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      return sendJson(res, 200, { task: enrichTaskSummary(db, updated, tz) });
    }

    // Reviewer actions: approve, request_changes, reopen
    const isReviewer =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_approve_work');

    if (!isReviewer) {
      return sendJson(res, 403, { error: 'You are not authorized to approve or review submitted tasks.' });
    }

    if (action === 'approve') {
      withTransaction(() => {
        db.prepare(`
          UPDATE tasks SET status = 'completed', progress = 100, completed_at = ?, updated_at = ?
          WHERE id = ? AND company_id = ?
        `).run(now, now, taskId, companyId);

        db.prepare(`
          INSERT INTO task_reviews (id, company_id, task_id, submitted_by, reviewer_user_id, action, feedback, created_at)
          VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)
        `).run(newId('rev'), companyId, taskId, task.assignee_user_id, auth.user.id, feedback, now);

        if (feedback) {
          db.prepare(`
            INSERT INTO task_comments (id, company_id, task_id, user_id, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newId('cmt'), companyId, taskId, auth.user.id, `[اعتماد المهمة / Approved]: ${feedback}`, now, now);
        }

        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: 'task.work_approved',
          entityType: 'task',
          entityId: taskId,
          previousValues: { status: task.status },
          newValues: { status: 'completed', feedback }
        });

        if (task.assignee_user_id && task.assignee_user_id !== auth.user.id) {
          createNotification({
            companyId,
            userId: task.assignee_user_id,
            type: 'work_approved',
            titleAr: 'تم اعتماد عملك بنجاح',
            titleEn: 'Your Submitted Work Was Approved',
            messageAr: `تم اعتماد المهمة "${task.title}" من قبل ${auth.user.full_name}.`,
            messageEn: `Your work on "${task.title}" was approved by ${auth.user.full_name}.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      });

      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      return sendJson(res, 200, { task: enrichTaskSummary(db, updated, tz) });
    }

    if (action === 'request_changes' || action === 'reopen') {
      const reviewAction = action === 'reopen' ? 'reopened' : 'changes_requested';
      withTransaction(() => {
        db.prepare(`
          UPDATE tasks SET status = 'in_progress', progress = CASE WHEN progress = 100 THEN 75 ELSE progress END, completed_at = NULL, updated_at = ?
          WHERE id = ? AND company_id = ?
        `).run(now, taskId, companyId);

        db.prepare(`
          INSERT INTO task_reviews (id, company_id, task_id, submitted_by, reviewer_user_id, action, feedback, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newId('rev'), companyId, taskId, task.assignee_user_id, auth.user.id, reviewAction, feedback, now);

        if (feedback) {
          db.prepare(`
            INSERT INTO task_comments (id, company_id, task_id, user_id, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newId('cmt'), companyId, taskId, auth.user.id, `[ملاحظات المراجعة / Review Feedback]: ${feedback}`, now, now);
        }

        logAudit({
          companyId,
          actorUserId: auth.user.id,
          action: action === 'reopen' ? 'task.reopened' : 'task.work_returned_for_revision',
          entityType: 'task',
          entityId: taskId,
          previousValues: { status: task.status },
          newValues: { status: 'in_progress', feedback }
        });

        if (task.assignee_user_id && task.assignee_user_id !== auth.user.id) {
          createNotification({
            companyId,
            userId: task.assignee_user_id,
            type: 'work_changes_requested',
            titleAr: 'مطلوب تعديلات على المهمة المرسلة',
            titleEn: 'Changes Requested on Submitted Task',
            messageAr: `طلب ${auth.user.full_name} تعديلات على المهمة "${task.title}"${feedback ? `: ${feedback}` : ''}.`,
            messageEn: `${auth.user.full_name} requested changes on "${task.title}"${feedback ? `: ${feedback}` : ''}.`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      });

      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      return sendJson(res, 200, { task: enrichTaskSummary(db, updated, tz) });
    }

    return sendJson(res, 400, { error: 'Invalid review action. Use submit, approve, request_changes, or reopen.' });
  }

  // Checklist Endpoints: POST /api/tasks/:id/checklist & PUT/DELETE /api/tasks/:id/checklist/:itemId
  const checklistPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/checklist$/);
  if (req.method === 'POST' && checklistPostMatch) {
    const taskId = checklistPostMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canModifyTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to modify checklist for this task.' });
    }
    const title = String(body.title || '').trim();
    if (!title) return sendJson(res, 400, { error: 'Checklist item title is required.' });
    const now = nowIso();
    let checklist = db.prepare('SELECT * FROM task_checklists WHERE company_id = ? AND task_id = ?').get(companyId, taskId);
    if (!checklist) {
      const cid = newId('chk');
      db.prepare('INSERT INTO task_checklists (id, company_id, task_id, title, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(cid, companyId, taskId, 'Checklist', now);
      checklist = { id: cid };
    }
    const itemId = newId('chi');
    const isRequired = body.is_required !== false ? 1 : 0;
    db.prepare(`
      INSERT INTO task_checklist_items (id, company_id, task_id, checklist_id, title, is_completed, is_required, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)
    `).run(itemId, companyId, taskId, checklist.id, title, isRequired, now);

    const item = db.prepare('SELECT * FROM task_checklist_items WHERE id = ?').get(itemId);
    return sendJson(res, 201, { item });
  }

  const checklistItemMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/checklist\/([^/]+)$/);
  if (checklistItemMatch) {
    const [, taskId, itemId] = checklistItemMatch;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canModifyTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to modify checklist for this task.' });
    }
    const item = db.prepare('SELECT * FROM task_checklist_items WHERE id = ? AND task_id = ? AND company_id = ?')
      .get(itemId, taskId, companyId);
    if (!item) return sendJson(res, 404, { error: 'Checklist item not found.' });

    if (req.method === 'PUT') {
      const isCompleted = body.is_completed !== undefined ? (body.is_completed ? 1 : 0) : item.is_completed;
      const title = body.title !== undefined ? String(body.title).trim() : item.title;
      const now = nowIso();
      db.prepare(`
        UPDATE task_checklist_items
        SET title = ?, is_completed = ?, completed_by = ?, completed_at = ?
        WHERE id = ?
      `).run(title, isCompleted, isCompleted ? auth.user.id : null, isCompleted ? now : null, itemId);
      const updated = db.prepare('SELECT * FROM task_checklist_items WHERE id = ?').get(itemId);
      return sendJson(res, 200, { item: updated });
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM task_checklist_items WHERE id = ?').run(itemId);
      return sendJson(res, 200, { ok: true });
    }
  }

  // Dependencies Endpoints: POST /api/tasks/:id/dependencies & DELETE /api/tasks/:id/dependencies/:depTaskId
  const depPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/dependencies$/);
  if (req.method === 'POST' && depPostMatch) {
    const taskId = depPostMatch[1];
    const dependsOnTaskId = String(body.depends_on_task_id || '').trim();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canModifyTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to modify dependencies for this task.' });
    }
    const prereqTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(dependsOnTaskId, companyId);
    if (!prereqTask) {
      return sendJson(res, 400, { error: 'Prerequisite task not found in your company.' });
    }
    if (hasDependencyCycle(db, companyId, taskId, dependsOnTaskId)) {
      return sendJson(res, 400, { error: 'Circular dependency detected: adding this dependency would create a loop.' });
    }

    db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (id, company_id, task_id, depends_on_task_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('dep'), companyId, taskId, dependsOnTaskId, nowIso());

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'task.dependency_added',
      entityType: 'task',
      entityId: taskId,
      newValues: { depends_on_task_id: dependsOnTaskId, depends_on_title: prereqTask.title }
    });

    return sendJson(res, 201, { ok: true });
  }

  const depDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/dependencies\/([^/]+)$/);
  if (req.method === 'DELETE' && depDeleteMatch) {
    const [, taskId, depTaskId] = depDeleteMatch;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canModifyTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to modify dependencies for this task.' });
    }
    db.prepare('DELETE FROM task_dependencies WHERE company_id = ? AND task_id = ? AND depends_on_task_id = ?')
      .run(companyId, taskId, depTaskId);
    return sendJson(res, 200, { ok: true });
  }

  // Comments Endpoints: POST /api/tasks/:id/comments, PUT/DELETE /api/tasks/:id/comments/:commentId
  const commentsPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/);
  if (req.method === 'POST' && commentsPostMatch) {
    const taskId = commentsPostMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'You do not have access to comment on this task.' });
    }

    const content = String(body.content || '').trim();
    if (!content) {
      return sendJson(res, 400, { error: 'Comment content cannot be empty.' });
    }
    const parentCommentId = body.parent_comment_id || null;

    // Resolve @mentions from explicit mention_user_ids OR @email / @name patterns in text
    const mentionedUserIds = new Set(Array.isArray(body.mention_user_ids) ? body.mention_user_ids.map(String) : []);
    const companyUsers = db.prepare(`
      SELECT u.id, u.email, u.full_name
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.company_id = ? AND m.status = 'active'
    `).all(companyId);

    for (const cu of companyUsers) {
      const emailPrefix = cu.email.split('@')[0];
      if (
        content.includes(`@${cu.email}`) ||
        content.includes(`@${emailPrefix}`) ||
        content.includes(`@${cu.full_name}`)
      ) {
        mentionedUserIds.add(cu.id);
      }
    }

    const commentId = newId('cmt');
    const now = nowIso();
    const mentionsArr = Array.from(mentionedUserIds);

    withTransaction(() => {
      db.prepare(`
        INSERT INTO task_comments (
          id, company_id, task_id, user_id, parent_comment_id, content, mentions_json, is_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(commentId, companyId, taskId, auth.user.id, parentCommentId, content, JSON.stringify(mentionsArr), now, now);

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'task.comment_added',
        entityType: 'task',
        entityId: taskId,
        newValues: { comment_id: commentId, content_preview: content.slice(0, 100), mentions: mentionsArr }
      });

      // Notify mentioned users
      for (const mentionedUid of mentionsArr) {
        if (mentionedUid !== auth.user.id) {
          createNotification({
            companyId,
            userId: mentionedUid,
            type: 'comment_mention',
            titleAr: 'تمت الإشارة إليك في تعليق',
            titleEn: 'You Were Mentioned in a Comment',
            messageAr: `أشار إليك ${auth.user.full_name} في تعليق على المهمة "${task.title}".`,
            messageEn: `${auth.user.full_name} mentioned you in a comment on "${task.title}".`,
            entityType: 'task',
            entityId: taskId,
            linkUrl: `#/tasks?taskId=${taskId}`
          });
        }
      }

      // Also notify assignee if not author and not already mentioned
      if (task.assignee_user_id && task.assignee_user_id !== auth.user.id && !mentionedUserIds.has(task.assignee_user_id)) {
        createNotification({
          companyId,
          userId: task.assignee_user_id,
          type: 'task_comment_added',
          titleAr: 'تعليق جديد على مهمتك',
          titleEn: 'New Comment on Your Task',
          messageAr: `أضاف ${auth.user.full_name} تعليقاً على المهمة "${task.title}".`,
          messageEn: `${auth.user.full_name} commented on task "${task.title}".`,
          entityType: 'task',
          entityId: taskId,
          linkUrl: `#/tasks?taskId=${taskId}`
        });
      }
    });

    const comment = db.prepare(`
      SELECT c.*, u.full_name AS author_name, u.avatar_url AS author_avatar, m.role AS author_role
      FROM task_comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN company_memberships m ON m.user_id = c.user_id AND m.company_id = c.company_id
      WHERE c.id = ?
    `).get(commentId);

    return sendJson(res, 201, { comment: { ...comment, mentions: mentionsArr } });
  }

  const commentItemMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/);
  if (commentItemMatch) {
    const [, taskId, commentId] = commentItemMatch;
    const comment = db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ? AND company_id = ?')
      .get(commentId, taskId, companyId);
    if (!comment) {
      return sendJson(res, 404, { error: 'Comment not found.' });
    }

    if (req.method === 'PUT') {
      // Users MUST NOT be able to edit another user's comments
      if (comment.user_id !== auth.user.id) {
        return sendJson(res, 403, { error: 'You cannot edit another user\'s comment.' });
      }
      const newContent = String(body.content || '').trim();
      if (!newContent) return sendJson(res, 400, { error: 'Comment content cannot be empty.' });
      const now = nowIso();
      db.prepare(`
        UPDATE task_comments SET content = ?, is_edited = 1, edited_at = ?, updated_at = ?
        WHERE id = ?
      `).run(newContent, now, now, commentId);

      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'task.comment_edited',
        entityType: 'task',
        entityId: taskId,
        previousValues: { content: comment.content },
        newValues: { content: newContent }
      });

      const updated = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(commentId);
      return sendJson(res, 200, { comment: updated });
    }

    if (req.method === 'DELETE') {
      if (comment.user_id !== auth.user.id && auth.membership.role !== 'owner') {
        return sendJson(res, 403, { error: 'You are not authorized to delete another user\'s comment.' });
      }
      db.prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
      logAudit({
        companyId,
        actorUserId: auth.user.id,
        action: 'task.comment_deleted',
        entityType: 'task',
        entityId: taskId,
        previousValues: { comment_id: commentId, content: comment.content }
      });
      return sendJson(res, 200, { ok: true });
    }
  }

  // File Attachments Upload: POST /api/tasks/:id/attachments
  const attachPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments$/);
  if (req.method === 'POST' && attachPostMatch) {
    const taskId = attachPostMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'You do not have permission to upload files to this task.' });
    }

    const originalName = path.basename(String(body.filename || body.original_name || '').trim());
    const mimeType = String(body.mime_type || 'application/octet-stream').trim().toLowerCase();
    const contentBase64 = body.content_base64 || body.data_base64 || '';

    if (!originalName || !contentBase64) {
      return sendJson(res, 400, { error: 'filename and content_base64 are required.' });
    }

    const ext = path.extname(originalName).toLowerCase();
    if (!config.allowedExtensions.has(ext)) {
      return sendJson(res, 400, {
        error: `Unsupported file type (${ext || 'unknown'}). Allowed formats: PDF, DOCX, XLSX, CSV, PNG, JPG, ZIP, TXT.`
      });
    }

    const cleanBase64 = String(contentBase64).replace(/^data:[^;]+;base64,/, '');
    const fileBuffer = Buffer.from(cleanBase64, 'base64');
    const sizeBytes = fileBuffer.length;

    const maxMb = Number((auth.settings && auth.settings.max_upload_size_mb) || config.maxUploadSizeMb || 10);
    const maxBytes = maxMb * 1024 * 1024;
    if (sizeBytes <= 0) {
      return sendJson(res, 400, { error: 'Uploaded file cannot be empty.' });
    }
    if (sizeBytes > maxBytes) {
      return sendJson(res, 413, {
        error: `File size (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the company limit of ${maxMb} MB.`
      });
    }

    const companyUploadDir = path.join(config.uploadDir, companyId);
    if (!fs.existsSync(companyUploadDir)) {
      fs.mkdirSync(companyUploadDir, { recursive: true });
    }

    const attachmentId = newId('att');
    const safeBase = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${attachmentId}_${crypto.randomBytes(6).toString('hex')}_${safeBase}`;
    const storagePath = path.join(companyUploadDir, storedName);

    fs.writeFileSync(storagePath, fileBuffer);

    const now = nowIso();
    db.prepare(`
      INSERT INTO task_attachments (
        id, company_id, task_id, project_id, uploaded_by,
        original_name, stored_name, storage_path, mime_type, extension, size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attachmentId,
      companyId,
      taskId,
      task.project_id || null,
      auth.user.id,
      originalName,
      storedName,
      storagePath,
      mimeType,
      ext,
      sizeBytes,
      now
    );

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'task.file_uploaded',
      entityType: 'task',
      entityId: taskId,
      newValues: { attachment_id: attachmentId, original_name: originalName, size_bytes: sizeBytes }
    });

    const attachment = db.prepare(`
      SELECT a.id, a.company_id, a.task_id, a.project_id, a.uploaded_by, u.full_name AS uploaded_by_name,
             a.original_name, a.mime_type, a.extension, a.size_bytes, a.created_at
      FROM task_attachments a
      JOIN users u ON u.id = a.uploaded_by
      WHERE a.id = ?
    `).get(attachmentId);

    return sendJson(res, 201, { attachment });
  }

  // Secure File Download / Preview: GET /api/attachments/:attachmentId/download
  const attachDownloadMatch = pathname.match(/^\/api\/attachments\/([^/]+)\/download$/);
  if (req.method === 'GET' && attachDownloadMatch) {
    const attachmentId = attachDownloadMatch[1];
    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(attachmentId);
    if (!attachment) {
      return sendJson(res, 404, { error: 'Attachment not found.' });
    }

    // Strict Multi-Tenant & Task Permission Verification
    if (attachment.company_id !== companyId) {
      return sendJson(res, 403, { error: 'Cross-company access to private attachments is strictly forbidden.' });
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(attachment.task_id, companyId);
    if (!task || !canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'You do not have permission to access this attachment.' });
    }

    if (!fs.existsSync(attachment.storage_path)) {
      return sendJson(res, 404, { error: 'Attachment file is missing from storage.' });
    }

    const isInline = query.get('inline') === '1' || query.get('preview') === '1';
    const disposition = isInline ? 'inline' : 'attachment';
    const fileBytes = fs.readFileSync(attachment.storage_path);

    res.writeHead(200, {
      'Content-Type': attachment.mime_type || 'application/octet-stream',
      'Content-Length': fileBytes.length,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(attachment.original_name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    });
    res.end(fileBytes);
    return true;
  }

  // DELETE /api/attachments/:attachmentId
  const attachDeleteMatch = pathname.match(/^\/api\/attachments\/([^/]+)$/);
  if (req.method === 'DELETE' && attachDeleteMatch) {
    const attachmentId = attachDeleteMatch[1];
    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND company_id = ?')
      .get(attachmentId, companyId);
    if (!attachment) {
      return sendJson(res, 404, { error: 'Attachment not found.' });
    }

    if (attachment.uploaded_by !== auth.user.id && auth.membership.role !== 'owner' && auth.membership.role !== 'manager') {
      return sendJson(res, 403, { error: 'You are not authorized to remove this attachment.' });
    }

    if (fs.existsSync(attachment.storage_path)) {
      try {
        fs.unlinkSync(attachment.storage_path);
      } catch (_) {}
    }
    db.prepare('DELETE FROM task_attachments WHERE id = ?').run(attachmentId);

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'task.file_removed',
      entityType: 'task',
      entityId: attachment.task_id,
      previousValues: { original_name: attachment.original_name }
    });

    return sendJson(res, 200, { ok: true });
  }

  // Time Tracking Endpoints (Section 19)
  // POST /api/tasks/:id/time/start
  const timeStartMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/time\/start$/);
  if (req.method === 'POST' && timeStartMatch) {
    if (auth.settings && !auth.settings.enable_time_tracking) {
      return sendJson(res, 400, { error: 'Time tracking is currently disabled for your company.' });
    }
    const taskId = timeStartMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to track time on this task.' });
    }

    const preventOverlap = auth.settings ? Boolean(auth.settings.prevent_overlapping_timers) : true;
    if (preventOverlap) {
      const activeTimer = db.prepare(`
        SELECT te.*, t.title AS task_title
        FROM task_time_entries te
        JOIN tasks t ON t.id = te.task_id
        WHERE te.company_id = ? AND te.user_id = ? AND te.is_running = 1
      `).get(companyId, auth.user.id);

      if (activeTimer) {
        return sendJson(res, 409, {
          error: `You already have an active timer running on task "${activeTimer.task_title}". Please stop it before starting a new timer.`,
          active_timer: activeTimer
        });
      }
    }

    const entryId = newId('tme');
    const now = nowIso();
    const description = String(body.description || '').trim();
    db.prepare(`
      INSERT INTO task_time_entries (
        id, company_id, task_id, user_id, start_time, duration_minutes, description, is_running, is_manual, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, ?, ?)
    `).run(entryId, companyId, taskId, auth.user.id, now, description, now, now);

    const entry = db.prepare('SELECT * FROM task_time_entries WHERE id = ?').get(entryId);
    return sendJson(res, 201, { time_entry: entry });
  }

  // POST /api/tasks/:id/time/stop
  const timeStopMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/time\/stop$/);
  if (req.method === 'POST' && timeStopMatch) {
    const taskId = timeStopMatch[1];
    const activeTimer = db.prepare(`
      SELECT * FROM task_time_entries
      WHERE company_id = ? AND task_id = ? AND user_id = ? AND is_running = 1
      ORDER BY start_time DESC LIMIT 1
    `).get(companyId, taskId, auth.user.id);

    if (!activeTimer) {
      return sendJson(res, 404, { error: 'No running timer found for this task.' });
    }

    const now = nowIso();
    const elapsedMs = Math.max(60000, Date.now() - new Date(activeTimer.start_time).getTime());
    const durationMinutes = body.duration_minutes !== undefined
      ? Math.max(1, Number(body.duration_minutes))
      : Math.max(1, Math.round(elapsedMs / 60000));
    const description = body.description !== undefined ? String(body.description).trim() : activeTimer.description;

    db.prepare(`
      UPDATE task_time_entries
      SET end_time = ?, duration_minutes = ?, description = ?, is_running = 0, updated_at = ?
      WHERE id = ?
    `).run(now, durationMinutes, description, now, activeTimer.id);

    const actualHours = recalculateTaskActualHours(db, taskId);
    const updatedEntry = db.prepare('SELECT * FROM task_time_entries WHERE id = ?').get(activeTimer.id);
    return sendJson(res, 200, { time_entry: updatedEntry, task_actual_hours: actualHours });
  }

  // POST /api/tasks/:id/time/manual
  const timeManualMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/time\/manual$/);
  if (req.method === 'POST' && timeManualMatch) {
    if (auth.settings && !auth.settings.enable_time_tracking) {
      return sendJson(res, 400, { error: 'Time tracking is disabled for your company.' });
    }
    if (auth.settings && !auth.settings.allow_manual_time_entries && auth.membership.role === 'employee') {
      return sendJson(res, 403, { error: 'Manual time entries are disabled by company policy.' });
    }

    const taskId = timeManualMatch[1];
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(taskId, companyId);
    if (!task || !canViewTask(db, auth, task)) {
      return sendJson(res, 403, { error: 'Not authorized to log time on this task.' });
    }

    const durationMinutes = Number(body.duration_minutes || 0);
    const description = String(body.description || '').trim();
    if (durationMinutes <= 0) {
      return sendJson(res, 400, { error: 'duration_minutes must be greater than 0.' });
    }

    const now = nowIso();
    const startTime = body.start_time || new Date(Date.now() - durationMinutes * 60000).toISOString();
    const endTime = body.end_time || now;
    const entryId = newId('tme');

    db.prepare(`
      INSERT INTO task_time_entries (
        id, company_id, task_id, user_id, start_time, end_time, duration_minutes, description, is_running, is_manual, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `).run(entryId, companyId, taskId, auth.user.id, startTime, endTime, durationMinutes, description, now, now);

    const actualHours = recalculateTaskActualHours(db, taskId);
    const entry = db.prepare('SELECT * FROM task_time_entries WHERE id = ?').get(entryId);
    return sendJson(res, 201, { time_entry: entry, task_actual_hours: actualHours });
  }

  // PUT /api/time-entries/:entryId
  const timeEntryMatch = pathname.match(/^\/api\/time-entries\/([^/]+)$/);
  if (req.method === 'PUT' && timeEntryMatch) {
    const entryId = timeEntryMatch[1];
    const entry = db.prepare('SELECT * FROM task_time_entries WHERE id = ? AND company_id = ?').get(entryId, companyId);
    if (!entry) return sendJson(res, 404, { error: 'Time entry not found.' });

    const isMgrOrOwner = auth.membership.role === 'owner' || auth.membership.role === 'manager';
    const allowPastEdit = Boolean(auth.settings && auth.settings.allow_edit_past_time_entries);

    if (!isMgrOrOwner && (entry.user_id !== auth.user.id || !allowPastEdit)) {
      return sendJson(res, 403, { error: 'Editing past time entries is restricted by company policy.' });
    }

    const durationMinutes = body.duration_minutes !== undefined ? Math.max(1, Number(body.duration_minutes)) : entry.duration_minutes;
    const description = body.description !== undefined ? String(body.description).trim() : entry.description;
    db.prepare('UPDATE task_time_entries SET duration_minutes = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(durationMinutes, description, nowIso(), entryId);

    const actualHours = recalculateTaskActualHours(db, entry.task_id);
    const updated = db.prepare('SELECT * FROM task_time_entries WHERE id = ?').get(entryId);
    return sendJson(res, 200, { time_entry: updated, task_actual_hours: actualHours });
  }

  return false;
}

module.exports = {
  handleTaskRoutes,
  enrichTaskSummary,
  hasDependencyCycle
};
