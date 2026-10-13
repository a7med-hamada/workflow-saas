const { getDb, newId, nowIso } = require('../db');
const { hasPermission, canAccessProject, canViewTask } = require('../auth');
const { logAudit, getAuditLogs, safeParseJson } = require('../audit');
const { createNotification, getCompanyDateString, evaluateDeadline } = require('../notifications');
const { enrichProject } = require('./projectRoutes');
const { enrichTaskSummary } = require('./taskRoutes');

function resolveDateRange(period, fromDateParam, toDateParam, tz = 'Asia/Riyadh') {
  const now = new Date();
  const todayStr = getCompanyDateString(now, tz);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const dayMs = 24 * 3600 * 1000;

  if (period === 'custom' && (fromDateParam || toDateParam)) {
    return {
      fromDate: fromDateParam ? String(fromDateParam).slice(0, 10) : '1970-01-01',
      toDate: toDateParam ? String(toDateParam).slice(0, 10) : '9999-12-31'
    };
  }

  if (period === 'this_week') {
    const fromMs = todayMs - 6 * dayMs;
    return {
      fromDate: new Date(fromMs).toISOString().slice(0, 10),
      toDate: '9999-12-31'
    };
  }

  if (period === 'last_week') {
    const toMs = todayMs - 7 * dayMs;
    const fromMs = todayMs - 13 * dayMs;
    return {
      fromDate: new Date(fromMs).toISOString().slice(0, 10),
      toDate: new Date(toMs).toISOString().slice(0, 10)
    };
  }

  if (period === 'this_month') {
    const ym = todayStr.slice(0, 7);
    return {
      fromDate: `${ym}-01`,
      toDate: `${ym}-31`
    };
  }

  if (period === 'last_month') {
    const d = new Date(todayMs);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const ym = d.toISOString().slice(0, 7);
    return {
      fromDate: `${ym}-01`,
      toDate: `${ym}-31`
    };
  }

  return {
    fromDate: fromDateParam ? String(fromDateParam).slice(0, 10) : null,
    toDate: toDateParam ? String(toDateParam).slice(0, 10) : null
  };
}

function isTaskWithinDateRange(task, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  const createdDate = String(task.created_at || '').slice(0, 10);
  if (fromDate && createdDate < fromDate) return false;
  if (toDate && createdDate > toDate) return false;
  return true;
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function handleReportRoutes(req, res, { pathname, query, body, auth, sendJson }) {
  if (!auth) return false;
  const db = getDb();
  const companyId = auth.company.id;
  const tz = (auth.settings && auth.settings.timezone) || 'Asia/Riyadh';

  // GET /api/dashboard (Manager & Owner Dashboard + Employee overview)
  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const allProjectsRaw = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.company_id = ?
      ORDER BY p.created_at DESC
    `).all(companyId);

    const accessibleProjects = allProjectsRaw
      .filter((p) => canAccessProject(db, auth, p))
      .map((p) => enrichProject(db, p, tz));

    const activeProjects = accessibleProjects.filter((p) => ['planning', 'active', 'on_hold'].includes(p.status));

    const allTasksRaw = db.prepare(`
      SELECT t.*, p.name AS project_name, u.full_name AS assignee_name, u.avatar_url AS assignee_avatar, d.name AS department_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.company_id = ?
      ORDER BY t.updated_at DESC
    `).all(companyId);

    const visibleTasks = allTasksRaw
      .filter((t) => canViewTask(db, auth, t))
      .map((t) => enrichTaskSummary(db, t, tz));

    const applicableTasks = visibleTasks.filter((t) => t.status !== 'cancelled');
    const openTasks = applicableTasks.filter((t) => t.status !== 'completed');
    const overdueTasks = openTasks.filter((t) => t.is_overdue);
    const awaitingReviewTasks = openTasks.filter((t) => t.status === 'in_review');
    const blockedTasks = openTasks.filter((t) => t.status === 'blocked');
    const urgentOpenTasks = openTasks.filter((t) => t.priority === 'urgent');
    const extensionRequests = openTasks.filter((t) => t.extension_status === 'pending');

    const weekAgoMs = Date.now() - 7 * 24 * 3600 * 1000;
    const completedThisWeek = applicableTasks.filter((t) => {
      if (t.status !== 'completed') return false;
      const ts = Date.parse(t.completed_at || t.updated_at);
      return !Number.isNaN(ts) && ts >= weekAgoMs;
    });

    const activeEmployeesCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM company_memberships WHERE company_id = ? AND status = 'active'")
        .get(companyId).c
    );

    // Upcoming deadlines in next 7 days
    const upcomingDeadlines = openTasks
      .filter((t) => t.deadline_info.daysDiff !== null && t.deadline_info.daysDiff >= 0 && t.deadline_info.daysDiff <= 7)
      .sort((a, b) => a.deadline_info.daysDiff - b.deadline_info.daysDiff);

    // Team workload distribution
    const members = db.prepare(`
      SELECT m.user_id, m.role, m.job_title, m.department_id, d.name AS department_name,
             u.full_name, u.avatar_url
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.company_id = ? AND m.status = 'active'
      ORDER BY u.full_name ASC
    `).all(companyId);

    const teamWorkload = members.map((m) => {
      const mTasks = applicableTasks.filter((t) => t.assignee_user_id === m.user_id);
      const mOpen = mTasks.filter((t) => t.status !== 'completed');
      const mUrgent = mOpen.filter((t) => t.priority === 'urgent');
      const mOverdue = mOpen.filter((t) => t.is_overdue);
      const mCompleted = mTasks.filter((t) => t.status === 'completed');

      let workloadStatus = 'balanced';
      if (mOpen.length >= 6 || mUrgent.length >= 3 || mOverdue.length >= 2) {
        workloadStatus = 'overloaded';
      } else if (mOpen.length >= 4 || mUrgent.length >= 2 || mOverdue.length >= 1) {
        workloadStatus = 'high_load';
      }

      return {
        ...m,
        open_tasks_count: mOpen.length,
        urgent_tasks_count: mUrgent.length,
        overdue_tasks_count: mOverdue.length,
        completed_tasks_count: mCompleted.length,
        workload_status: workloadStatus
      };
    });

    const recentActivity = getAuditLogs({ companyId, limit: 25 });

    return sendJson(res, 200, {
      kpis: {
        total_active_projects: activeProjects.length,
        total_open_tasks: openTasks.length,
        tasks_completed_this_week: completedThisWeek.length,
        overdue_tasks: overdueTasks.length,
        tasks_awaiting_review: awaitingReviewTasks.length,
        active_employees: activeEmployeesCount
      },
      attention_required: {
        overdue_tasks: overdueTasks.slice(0, 15),
        urgent_tasks: urgentOpenTasks.slice(0, 15),
        blocked_tasks: blockedTasks.slice(0, 15),
        awaiting_review_tasks: awaitingReviewTasks.slice(0, 15),
        extension_requests: extensionRequests.slice(0, 10)
      },
      project_progress: activeProjects,
      team_workload: teamWorkload,
      workload_note: 'ملاحظة: عدد المهام المكتملة لا يُعد مقياساً وحيداً للأداء؛ يجب مراعاة حجم المهام وتعقيدها والعوائق وتوازن العبء الوظيفي.',
      recent_activity: recentActivity,
      upcoming_deadlines: upcomingDeadlines.slice(0, 20)
    });
  }

  // Daily and Weekly Work Reports (Section 16)
  // GET /api/daily-reports
  if (req.method === 'GET' && pathname === '/api/daily-reports') {
    const canViewTeam =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_view_team_reports');

    const userFilter = query.get('user_id') || (!canViewTeam ? auth.user.id : null);
    const deptFilter = query.get('department_id') || null;
    const projFilter = query.get('project_id') || null;
    const dateFilter = query.get('report_date') || null;
    const period = query.get('period') || 'all';
    const { fromDate, toDate } = resolveDateRange(period, query.get('from_date'), query.get('to_date'), tz);

    if (userFilter && userFilter !== auth.user.id && !canViewTeam) {
      return sendJson(res, 403, { error: 'You are not authorized to view other employees\' daily work reports.' });
    }

    const clauses = ['r.company_id = ?'];
    const params = [companyId];

    if (userFilter) {
      clauses.push('r.user_id = ?');
      params.push(userFilter);
    }
    if (deptFilter) {
      clauses.push('r.department_id = ?');
      params.push(deptFilter);
    }
    if (projFilter) {
      clauses.push('r.project_id = ?');
      params.push(projFilter);
    }
    if (dateFilter) {
      clauses.push('r.report_date = ?');
      params.push(dateFilter);
    }
    if (fromDate) {
      clauses.push('r.report_date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push('r.report_date <= ?');
      params.push(toDate);
    }

    const reports = db.prepare(`
      SELECT r.*, u.full_name AS employee_name, u.avatar_url AS employee_avatar,
             d.name AS department_name, p.name AS project_name
      FROM daily_work_reports r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.report_date DESC, r.created_at DESC
      LIMIT 200
    `).all(...params).map((r) => ({
      ...r,
      links: safeParseJson(r.links_json, [])
    }));

    // Build real weekly team summary strictly from recorded DB data (last 7 days)
    const weekAgoStr = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const recentReports = reports.filter((r) => r.report_date >= weekAgoStr);

    const weeklySummary = {
      period_start: weekAgoStr,
      period_end: getCompanyDateString(new Date(), tz),
      reports_submitted_count: recentReports.length,
      completed_highlights: recentReports.map((r) => ({
        employee_name: r.employee_name,
        report_date: r.report_date,
        completed_work: r.completed_work
      })).filter((x) => x.completed_work),
      active_priorities: recentReports.map((r) => ({
        employee_name: r.employee_name,
        report_date: r.report_date,
        current_work: r.current_work
      })).filter((x) => x.current_work),
      reported_blockers: recentReports
        .filter((r) => r.blockers && r.blockers.trim() !== '')
        .map((r) => ({
          employee_name: r.employee_name,
          report_date: r.report_date,
          blockers: r.blockers
        }))
    };

    return sendJson(res, 200, { reports, weekly_summary: weeklySummary });
  }

  // POST /api/daily-reports
  if (req.method === 'POST' && pathname === '/api/daily-reports') {
    const completedWork = String(body.completed_work || '').trim();
    const currentWork = String(body.current_work || '').trim();
    const blockers = String(body.blockers || '').trim();
    const nextPlan = String(body.next_plan || '').trim();
    const reportDate = body.report_date ? String(body.report_date).slice(0, 10) : getCompanyDateString(new Date(), tz);
    const projectId = body.project_id || null;
    const links = Array.isArray(body.links) ? body.links : [];

    if (!completedWork || !currentWork) {
      return sendJson(res, 400, { error: 'completed_work and current_work fields are required.' });
    }

    const id = newId('dwr');
    const now = nowIso();
    db.prepare(`
      INSERT INTO daily_work_reports (
        id, company_id, user_id, department_id, project_id, report_date,
        completed_work, current_work, blockers, next_plan, links_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      companyId,
      auth.user.id,
      auth.membership.department_id || null,
      projectId,
      reportDate,
      completedWork,
      currentWork,
      blockers,
      nextPlan,
      JSON.stringify(links),
      now,
      now
    );

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'daily_report.submitted',
      entityType: 'daily_report',
      entityId: id,
      newValues: { report_date: reportDate, has_blockers: Boolean(blockers) }
    });

    if (blockers) {
      const managerTarget = auth.membership.manager_user_id || auth.company.owner_user_id;
      if (managerTarget && managerTarget !== auth.user.id) {
        createNotification({
          companyId,
          userId: managerTarget,
          type: 'employee_reported_blocker',
          titleAr: 'أبلغ موظف عن عائق في التقرير اليومي',
          titleEn: 'Employee Reported a Blocker in Daily Report',
          messageAr: `أبلغ ${auth.user.full_name} عن عائق في تقرير اليوم: ${blockers}`,
          messageEn: `${auth.user.full_name} reported a blocker in their daily report: ${blockers}`,
          entityType: 'daily_report',
          entityId: id,
          linkUrl: '#/daily-reports'
        });
      }
    }

    const report = db.prepare(`
      SELECT r.*, u.full_name AS employee_name, d.name AS department_name, p.name AS project_name
      FROM daily_work_reports r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?
    `).get(id);

    return sendJson(res, 201, { report });
  }

  // Productivity & Performance Analytics (Section 20)
  // GET /api/reports/analytics
  if (req.method === 'GET' && pathname === '/api/reports/analytics') {
    const canViewTeam =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_view_team_reports');

    const requestedEmployeeId = query.get('employee_id') || null;
    if (!canViewTeam && requestedEmployeeId && requestedEmployeeId !== auth.user.id) {
      return sendJson(res, 403, { error: 'Employees are only permitted to view their own performance summary.' });
    }

    const period = query.get('period') || 'all';
    const deptFilter = query.get('department_id') || null;
    const projFilter = query.get('project_id') || null;
    const { fromDate, toDate } = resolveDateRange(period, query.get('from_date'), query.get('to_date'), tz);

    const allTasksRaw = db.prepare(`
      SELECT t.*, p.name AS project_name, d.name AS department_name, u.full_name AS assignee_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      WHERE t.company_id = ?
    `).all(companyId);

    const scopedTasks = allTasksRaw.filter((t) => {
      if (!canViewTask(db, auth, t)) return false;
      if (!canViewTeam && t.assignee_user_id !== auth.user.id) return false;
      if (requestedEmployeeId && t.assignee_user_id !== requestedEmployeeId) return false;
      if (deptFilter && t.department_id !== deptFilter) return false;
      if (projFilter && t.project_id !== projFilter) return false;
      return isTaskWithinDateRange(t, fromDate, toDate);
    }).map((t) => ({
      ...t,
      deadline_info: evaluateDeadline(t.deadline, t.status, tz)
    }));

    // Exclude cancelled tasks from applicable task totals
    const applicableTasks = scopedTasks.filter((t) => t.status !== 'cancelled');
    const cancelledTasks = scopedTasks.filter((t) => t.status === 'cancelled');
    const completedTasks = applicableTasks.filter((t) => t.status === 'completed');
    const openTasks = applicableTasks.filter((t) => t.status !== 'completed');
    const overdueTasks = openTasks.filter((t) => t.deadline_info.isOverdue);
    const awaitingReviewTasks = openTasks.filter((t) => t.status === 'in_review');
    const inProgressTasks = openTasks.filter((t) => t.status === 'in_progress');
    const blockedTasks = openTasks.filter((t) => t.status === 'blocked');

    const completionRate = applicableTasks.length > 0
      ? Number(((completedTasks.length / applicableTasks.length) * 100).toFixed(1))
      : 0;

    // 1. Company Report
    const companyReport = {
      total_tasks_created: scopedTasks.length,
      applicable_tasks: applicableTasks.length,
      cancelled_tasks: cancelledTasks.length,
      completed_tasks: completedTasks.length,
      open_tasks: openTasks.length,
      overdue_tasks: overdueTasks.length,
      awaiting_review_tasks: awaitingReviewTasks.length,
      in_progress_tasks: inProgressTasks.length,
      blocked_tasks: blockedTasks.length,
      completion_rate: completionRate,
      formula_explanation: 'Completion Rate = Completed Tasks / Total Applicable (Non-Cancelled) Tasks × 100'
    };

    // 2. Employee Reports
    const empClause = !canViewTeam
      ? 'AND m.user_id = ?'
      : (requestedEmployeeId ? 'AND m.user_id = ?' : '');
    const empParams = !canViewTeam
      ? [companyId, auth.user.id]
      : (requestedEmployeeId ? [companyId, requestedEmployeeId] : [companyId]);

    const employees = db.prepare(`
      SELECT m.user_id, m.role, m.job_title, m.department_id, d.name AS department_name,
             u.full_name, u.email
      FROM company_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN departments d ON d.id = m.department_id
      WHERE m.company_id = ? ${empClause}
      ORDER BY u.full_name ASC
    `).all(...empParams);

    const employeeReports = employees
      .filter((e) => !deptFilter || e.department_id === deptFilter)
      .map((emp) => {
        const empTasks = applicableTasks.filter((t) => t.assignee_user_id === emp.user_id);
        const empCompleted = empTasks.filter((t) => t.status === 'completed');
        const empOpen = empTasks.filter((t) => t.status !== 'completed');
        const empOverdue = empOpen.filter((t) => t.deadline_info.isOverdue);
        const empInReview = empOpen.filter((t) => t.status === 'in_review');
        const empInProgress = empOpen.filter((t) => t.status === 'in_progress');
        const empBlocked = empOpen.filter((t) => t.status === 'blocked');

        // Completed on time: completed_at <= deadline (or no deadline)
        const completedOnTime = empCompleted.filter((t) => {
          if (!t.deadline) return true;
          const compDate = String(t.completed_at || t.updated_at).slice(0, 10);
          return compDate <= String(t.deadline).slice(0, 10);
        });

        // Average completion time in hours where meaningful
        let totalHours = 0;
        let timedCount = 0;
        for (const ct of empCompleted) {
          if (ct.created_at && ct.completed_at) {
            const diffH = Math.max(0.1, (Date.parse(ct.completed_at) - Date.parse(ct.created_at)) / 3600000);
            totalHours += diffH;
            timedCount++;
          }
        }
        const avgCompletionHours = timedCount > 0 ? Number((totalHours / timedCount).toFixed(1)) : null;

        const empRate = empTasks.length > 0
          ? Number(((empCompleted.length / empTasks.length) * 100).toFixed(1))
          : 0;

        return {
          user_id: emp.user_id,
          full_name: emp.full_name,
          email: emp.email,
          role: emp.role,
          job_title: emp.job_title,
          department_name: emp.department_name || '',
          tasks_assigned: empTasks.length,
          tasks_completed: empCompleted.length,
          tasks_completed_on_time: completedOnTime.length,
          tasks_in_progress: empInProgress.length,
          tasks_awaiting_review: empInReview.length,
          tasks_overdue: empOverdue.length,
          tasks_blocked: empBlocked.length,
          completion_rate: empRate,
          avg_completion_hours: avgCompletionHours
        };
      });

    // 3. Project Reports
    const projectsRaw = db.prepare(`
      SELECT p.*, u.full_name AS manager_name, d.name AS department_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.company_id = ?
      ORDER BY p.name ASC
    `).all(companyId).filter((p) => canAccessProject(db, auth, p) && (!deptFilter || p.department_id === deptFilter) && (!projFilter || p.id === projFilter));

    const projectReports = projectsRaw.map((proj) => {
      const pTasks = applicableTasks.filter((t) => t.project_id === proj.id);
      const pCompleted = pTasks.filter((t) => t.status === 'completed');
      const pOpen = pTasks.filter((t) => t.status !== 'completed');
      const pOverdue = pOpen.filter((t) => t.deadline_info.isOverdue);
      const pRate = pTasks.length > 0 ? Number(((pCompleted.length / pTasks.length) * 100).toFixed(1)) : 0;

      const byPriority = {
        low: pTasks.filter((t) => t.priority === 'low').length,
        medium: pTasks.filter((t) => t.priority === 'medium').length,
        high: pTasks.filter((t) => t.priority === 'high').length,
        urgent: pTasks.filter((t) => t.priority === 'urgent').length
      };
      const byStatus = {
        backlog: pTasks.filter((t) => t.status === 'backlog').length,
        todo: pTasks.filter((t) => t.status === 'todo').length,
        in_progress: pTasks.filter((t) => t.status === 'in_progress').length,
        in_review: pTasks.filter((t) => t.status === 'in_review').length,
        completed: pCompleted.length,
        blocked: pTasks.filter((t) => t.status === 'blocked').length
      };

      return {
        project_id: proj.id,
        project_name: proj.name,
        department_name: proj.department_name || '',
        manager_name: proj.manager_name || '',
        status: proj.status,
        deadline: proj.deadline,
        total_tasks: pTasks.length,
        completed_tasks: pCompleted.length,
        open_tasks: pOpen.length,
        overdue_tasks: pOverdue.length,
        completion_percentage: pRate,
        tasks_by_priority: byPriority,
        tasks_by_status: byStatus
      };
    });

    // 4. Department Reports
    const departmentsRaw = db.prepare(`
      SELECT d.*, u.full_name AS manager_name
      FROM departments d
      LEFT JOIN users u ON u.id = d.manager_user_id
      WHERE d.company_id = ?
      ORDER BY d.name ASC
    `).all(companyId).filter((d) => !deptFilter || d.id === deptFilter);

    const departmentReports = departmentsRaw.map((dept) => {
      const dProjects = projectsRaw.filter((p) => p.department_id === dept.id);
      const dTasks = applicableTasks.filter((t) => t.department_id === dept.id);
      const dCompleted = dTasks.filter((t) => t.status === 'completed');
      const dOpen = dTasks.filter((t) => t.status !== 'completed');
      const dOverdue = dOpen.filter((t) => t.deadline_info.isOverdue);
      const dRate = dTasks.length > 0 ? Number(((dCompleted.length / dTasks.length) * 100).toFixed(1)) : 0;

      return {
        department_id: dept.id,
        department_name: dept.name,
        manager_name: dept.manager_name || '',
        projects_count: dProjects.length,
        total_tasks: dTasks.length,
        completed_tasks: dCompleted.length,
        open_tasks: dOpen.length,
        overdue_tasks: dOverdue.length,
        completion_rate: dRate
      };
    });

    return sendJson(res, 200, {
      filters: {
        period,
        from_date: fromDate,
        to_date: toDate,
        department_id: deptFilter,
        project_id: projFilter,
        employee_id: requestedEmployeeId
      },
      formula_explanation: 'Completion Rate = Completed Tasks / Total Applicable (Non-Cancelled) Tasks × 100',
      methodology_note: 'Raw task counts are not a definitive measure of employee productivity. Consider task complexity, workload, blockers, and project context.',
      company_report: companyReport,
      employee_reports: employeeReports,
      project_reports: projectReports,
      department_reports: departmentReports
    });
  }

  // Export Reports (CSV and Excel) - GET /api/reports/export
  if (req.method === 'GET' && pathname === '/api/reports/export') {
    const canExport =
      auth.membership.role === 'owner' ||
      auth.membership.role === 'manager' ||
      hasPermission(auth, 'can_view_team_reports');

    if (!canExport) {
      return sendJson(res, 403, { error: 'You do not have permission to export team reports.' });
    }

    const format = (query.get('format') || 'csv').toLowerCase(); // 'csv' or 'excel'
    const reportType = query.get('report_type') || 'tasks'; // 'tasks', 'employees', 'projects', 'departments'
    const period = query.get('period') || 'all';
    const deptFilter = query.get('department_id') || null;
    const projFilter = query.get('project_id') || null;
    const empFilter = query.get('employee_id') || null;
    const statusFilter = query.get('status') || null;
    const { fromDate, toDate } = resolveDateRange(period, query.get('from_date'), query.get('to_date'), tz);

    const allTasks = db.prepare(`
      SELECT t.*, p.name AS project_name, d.name AS department_name, u.full_name AS assignee_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN users u ON u.id = t.assignee_user_id
      WHERE t.company_id = ?
      ORDER BY t.created_at DESC
    `).all(companyId).filter((t) => {
      if (!canViewTask(db, auth, t)) return false;
      if (deptFilter && t.department_id !== deptFilter) return false;
      if (projFilter && t.project_id !== projFilter) return false;
      if (empFilter && t.assignee_user_id !== empFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      return isTaskWithinDateRange(t, fromDate, toDate);
    });

    let headers = [];
    let rows = [];

    if (reportType === 'employees') {
      headers = ['Employee Name', 'Email', 'Role', 'Department', 'Tasks Assigned', 'Completed', 'In Progress', 'Awaiting Review', 'Overdue', 'Completion Rate (%)'];
      const employees = db.prepare(`
        SELECT m.user_id, m.role, m.department_id, d.name AS department_name, u.full_name, u.email
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN departments d ON d.id = m.department_id
        WHERE m.company_id = ?
        ORDER BY u.full_name ASC
      `).all(companyId).filter((e) => (!deptFilter || e.department_id === deptFilter) && (!empFilter || e.user_id === empFilter));

      for (const emp of employees) {
        const empTasks = allTasks.filter((t) => t.assignee_user_id === emp.user_id && t.status !== 'cancelled');
        const comp = empTasks.filter((t) => t.status === 'completed').length;
        const inProg = empTasks.filter((t) => t.status === 'in_progress').length;
        const inRev = empTasks.filter((t) => t.status === 'in_review').length;
        const overdue = empTasks.filter((t) => evaluateDeadline(t.deadline, t.status, tz).isOverdue).length;
        const rate = empTasks.length > 0 ? Math.round((comp / empTasks.length) * 100) : 0;
        rows.push([emp.full_name, emp.email, emp.role, emp.department_name || '', empTasks.length, comp, inProg, inRev, overdue, rate]);
      }
    } else if (reportType === 'projects') {
      headers = ['Project Name', 'Department', 'Status', 'Priority', 'Deadline', 'Total Tasks', 'Completed Tasks', 'Open Tasks', 'Overdue Tasks', 'Progress (%)'];
      const projects = db.prepare(`
        SELECT p.*, d.name AS department_name
        FROM projects p
        LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.company_id = ?
      `).all(companyId).filter((p) => canAccessProject(db, auth, p) && (!deptFilter || p.department_id === deptFilter) && (!projFilter || p.id === projFilter));

      for (const p of projects) {
        const pTasks = allTasks.filter((t) => t.project_id === p.id && t.status !== 'cancelled');
        const comp = pTasks.filter((t) => t.status === 'completed').length;
        const open = pTasks.length - comp;
        const overdue = pTasks.filter((t) => evaluateDeadline(t.deadline, t.status, tz).isOverdue).length;
        const rate = pTasks.length > 0 ? Math.round((comp / pTasks.length) * 100) : 0;
        rows.push([p.name, p.department_name || '', p.status, p.priority, p.deadline || '', pTasks.length, comp, open, overdue, rate]);
      }
    } else {
      headers = ['Task ID', 'Title', 'Project', 'Department', 'Assignee', 'Priority', 'Status', 'Progress (%)', 'Start Date', 'Deadline', 'Overdue', 'Created At'];
      for (const t of allTasks) {
        const dl = evaluateDeadline(t.deadline, t.status, tz);
        rows.push([
          t.id,
          t.title,
          t.project_name || '',
          t.department_name || '',
          t.assignee_name || '',
          t.priority,
          t.status,
          t.progress,
          t.start_date || '',
          t.deadline || '',
          dl.isOverdue ? 'Yes' : 'No',
          t.created_at
        ]);
      }
    }

    logAudit({
      companyId,
      actorUserId: auth.user.id,
      action: 'report.exported',
      entityType: 'report',
      entityId: reportType,
      newValues: { format, report_type: reportType, row_count: rows.length, period }
    });

    if (format === 'excel' || format === 'xlsx' || format === 'xls') {
      // Generate Excel-compatible SpreadsheetML / HTML table with UTF-8 BOM
      const tableRowsHtml = [
        `<tr>${headers.map((h) => `<th style="background:#1e3a8a;color:#ffffff;font-weight:bold;padding:6px;border:1px solid #cbd5e1;">${String(h)}</th>`).join('')}</tr>`,
        ...rows.map((r) => `<tr>${r.map((c) => `<td style="padding:5px;border:1px solid #cbd5e1;">${String(c ?? '')}</td>`).join('')}</tr>`)
      ].join('\n');

      const excelContent = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table>${tableRowsHtml}</table></body></html>`;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="workflow_${reportType}_report.xls"`
      });
      res.end(excelContent);
      return true;
    }

    // Default CSV with UTF-8 BOM for Arabic compatibility
    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(','))
    ];
    const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="workflow_${reportType}_report.csv"`
    });
    res.end(csvContent);
    return true;
  }

  return false;
}

module.exports = {
  handleReportRoutes
};
