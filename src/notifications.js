const { getDb, newId, nowIso } = require('./db');

function createNotification({
  companyId,
  userId,
  type,
  titleAr,
  titleEn,
  messageAr,
  messageEn,
  entityType = '',
  entityId = '',
  linkUrl = '',
  dedupeKey = null
}) {
  if (!companyId || !userId || !type) return null;
  const db = getDb();

  // Check that target user is an active member of this company
  const member = db.prepare(
    'SELECT status FROM company_memberships WHERE company_id = ? AND user_id = ?'
  ).get(companyId, userId);
  if (!member || member.status !== 'active') {
    return null;
  }

  if (dedupeKey) {
    const existing = db.prepare(
      'SELECT id FROM notifications WHERE company_id = ? AND user_id = ? AND dedupe_key = ?'
    ).get(companyId, userId, dedupeKey);
    if (existing) {
      return null;
    }
  }

  const id = newId('ntf');
  const createdAt = nowIso();
  try {
    db.prepare(`
      INSERT INTO notifications (
        id, company_id, user_id, type, title_ar, title_en,
        message_ar, message_en, entity_type, entity_id, link_url,
        dedupe_key, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      companyId,
      userId,
      type,
      titleAr || titleEn || 'إشعار',
      titleEn || titleAr || 'Notification',
      messageAr || messageEn || '',
      messageEn || messageAr || '',
      entityType || '',
      entityId || '',
      linkUrl || '',
      dedupeKey || null,
      createdAt
    );
    return id;
  } catch (err) {
    // Handle unique dedupe index collision gracefully
    if (String(err.message).includes('UNIQUE')) {
      return null;
    }
    throw err;
  }
}

/**
 * Compute date string YYYY-MM-DD in company's configured timezone
 */
function getCompanyDateString(dateObj, timezone = 'Asia/Riyadh') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(dateObj);
  } catch (_) {
    return dateObj.toISOString().slice(0, 10);
  }
}

/**
 * Calculate deadline status relative to company timezone:
 * Returns { isOverdue, daysDiff, code, labelAr, labelEn }
 * Note: Tasks are ONLY overdue when their deadline has passed AND status is NOT completed or cancelled.
 * Exceeding estimated_hours NEVER marks a task overdue.
 */
function evaluateDeadline(deadlineStr, status, timezone = 'Asia/Riyadh', nowDate = new Date()) {
  if (!deadlineStr) {
    return {
      isOverdue: false,
      daysDiff: null,
      code: 'no_deadline',
      labelAr: 'بدون موعد نهائي',
      labelEn: 'No deadline'
    };
  }

  const isTerminal = status === 'completed' || status === 'cancelled';
  const todayStr = getCompanyDateString(nowDate, timezone);
  const targetDateStr = String(deadlineStr).slice(0, 10);

  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const targetMs = Date.parse(`${targetDateStr}T00:00:00Z`);
  if (Number.isNaN(targetMs)) {
    return {
      isOverdue: false,
      daysDiff: null,
      code: 'invalid',
      labelAr: deadlineStr,
      labelEn: deadlineStr
    };
  }

  const daysDiff = Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));

  if (isTerminal) {
    return {
      isOverdue: false,
      daysDiff,
      code: status,
      labelAr: status === 'completed' ? 'مكتملة' : 'ملغاة',
      labelEn: status === 'completed' ? 'Completed' : 'Cancelled'
    };
  }

  if (daysDiff < 0) {
    const overdueDays = Math.abs(daysDiff);
    return {
      isOverdue: true,
      daysDiff,
      code: 'overdue',
      labelAr: overdueDays === 1 ? 'متأخرة بيوم واحد' : `متأخرة بـ ${overdueDays} أيام`,
      labelEn: overdueDays === 1 ? 'Overdue by 1 day' : `Overdue by ${overdueDays} days`
    };
  }

  if (daysDiff === 0) {
    return {
      isOverdue: false,
      daysDiff: 0,
      code: 'due_today',
      labelAr: 'تستحق اليوم',
      labelEn: 'Due today'
    };
  }

  if (daysDiff === 1) {
    return {
      isOverdue: false,
      daysDiff: 1,
      code: 'due_tomorrow',
      labelAr: 'تستحق غداً',
      labelEn: 'Due tomorrow'
    };
  }

  return {
    isOverdue: false,
    daysDiff,
    code: daysDiff <= 3 ? 'due_soon' : 'upcoming',
    labelAr: `تستحق خلال ${daysDiff} أيام`,
    labelEn: `Due in ${daysDiff} days`
  };
}

/**
 * Automatic background processor for reminders & overdue tasks/projects.
 * Uses dedupe_key so repeated runs do NOT create duplicate notifications for the same condition.
 */
function processCompanyReminders(companyId = null, referenceDate = new Date()) {
  const db = getDb();
  const companies = companyId
    ? db.prepare('SELECT id, name, owner_user_id FROM companies WHERE id = ?').all(companyId)
    : db.prepare('SELECT id, name, owner_user_id FROM companies').all();

  let generatedCount = 0;

  for (const company of companies) {
    const settings = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(company.id) || {
      timezone: 'Asia/Riyadh',
      remind_before_hours: 24,
      remind_on_due_date: 1,
      notify_manager_on_overdue: 1
    };

    const tz = settings.timezone || 'Asia/Riyadh';
    const remindDaysWindow = Math.max(1, Math.ceil((Number(settings.remind_before_hours) || 24) / 24));

    const openTasks = db.prepare(`
      SELECT t.*, p.manager_user_id AS project_manager_id, p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.company_id = ?
        AND t.status NOT IN ('completed', 'cancelled')
        AND t.deadline IS NOT NULL AND t.deadline != ''
    `).all(company.id);

    for (const task of openTasks) {
      const dl = evaluateDeadline(task.deadline, task.status, tz, referenceDate);

      // 1. Overdue task notifications
      if (dl.isOverdue) {
        if (task.assignee_user_id) {
          const id = createNotification({
            companyId: company.id,
            userId: task.assignee_user_id,
            type: 'task_overdue',
            titleAr: 'مهمة متأخرة عن الموعد النهائي',
            titleEn: 'Task is Overdue',
            messageAr: `المهمة "${task.title}" تجاوزت الموعد النهائي (${task.deadline}).`,
            messageEn: `Task "${task.title}" has passed its deadline (${task.deadline}).`,
            entityType: 'task',
            entityId: task.id,
            linkUrl: `#/tasks?taskId=${task.id}`,
            dedupeKey: `overdue:${task.id}:${task.deadline}`
          });
          if (id) generatedCount++;
        }

        if (settings.notify_manager_on_overdue) {
          const managerTarget = task.project_manager_id || task.created_by || company.owner_user_id;
          if (managerTarget && managerTarget !== task.assignee_user_id) {
            const id = createNotification({
              companyId: company.id,
              userId: managerTarget,
              type: 'manager_task_overdue',
              titleAr: 'تنبيه مدير: مهمة متأخرة',
              titleEn: 'Manager Alert: Task Overdue',
              messageAr: `المهمة "${task.title}" أصبحت متأخرة (${dl.labelAr}).`,
              messageEn: `Task "${task.title}" is now overdue (${dl.labelEn}).`,
              entityType: 'task',
              entityId: task.id,
              linkUrl: `#/tasks?taskId=${task.id}`,
              dedupeKey: `mgr_overdue:${task.id}:${task.deadline}`
            });
            if (id) generatedCount++;
          }
        }
      }

      // 2. Due today reminder
      if (dl.daysDiff === 0 && settings.remind_on_due_date && task.assignee_user_id) {
        const id = createNotification({
          companyId: company.id,
          userId: task.assignee_user_id,
          type: 'task_due_today',
          titleAr: 'تذكير: مهمة تستحق اليوم',
          titleEn: 'Reminder: Task Due Today',
          messageAr: `المهمة "${task.title}" تستحق التسليم اليوم (${task.deadline}).`,
          messageEn: `Task "${task.title}" is due today (${task.deadline}).`,
          entityType: 'task',
          entityId: task.id,
          linkUrl: `#/tasks?taskId=${task.id}`,
          dedupeKey: `due_today:${task.id}:${task.deadline}`
        });
        if (id) generatedCount++;
      }

      // 3. Approaching deadline reminder (e.g. tomorrow / within reminder window)
      if (dl.daysDiff > 0 && dl.daysDiff <= remindDaysWindow && task.assignee_user_id) {
        const id = createNotification({
          companyId: company.id,
          userId: task.assignee_user_id,
          type: 'task_deadline_approaching',
          titleAr: 'اقتراب الموعد النهائي لمهمة',
          titleEn: 'Task Deadline Approaching',
          messageAr: `المهمة "${task.title}" ${dl.labelAr} (${task.deadline}).`,
          messageEn: `Task "${task.title}" is ${dl.labelEn.toLowerCase()} (${task.deadline}).`,
          entityType: 'task',
          entityId: task.id,
          linkUrl: `#/tasks?taskId=${task.id}`,
          dedupeKey: `approaching:${task.id}:${task.deadline}`
        });
        if (id) generatedCount++;
      }
    }

    // 4. Projects approaching deadline
    const activeProjects = db.prepare(`
      SELECT * FROM projects
      WHERE company_id = ?
        AND status IN ('planning', 'active', 'on_hold')
        AND deadline IS NOT NULL AND deadline != ''
    `).all(company.id);

    for (const proj of activeProjects) {
      const dl = evaluateDeadline(proj.deadline, proj.status, tz, referenceDate);
      if (dl.daysDiff !== null && dl.daysDiff >= 0 && dl.daysDiff <= 3) {
        const targetUser = proj.manager_user_id || company.owner_user_id;
        if (targetUser) {
          const id = createNotification({
            companyId: company.id,
            userId: targetUser,
            type: 'project_deadline_approaching',
            titleAr: 'اقتراب موعد تسليم مشروع',
            titleEn: 'Project Deadline Approaching',
            messageAr: `المشروع "${proj.name}" يقترب من موعد التسليم (${proj.deadline}).`,
            messageEn: `Project "${proj.name}" is approaching its deadline (${proj.deadline}).`,
            entityType: 'project',
            entityId: proj.id,
            linkUrl: `#/projects/${proj.id}`,
            dedupeKey: `proj_approaching:${proj.id}:${proj.deadline}`
          });
          if (id) generatedCount++;
        }
      }
    }
  }

  return { generatedCount };
}

module.exports = {
  createNotification,
  getCompanyDateString,
  evaluateDeadline,
  processCompanyReminders
};
