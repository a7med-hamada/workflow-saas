window.WF_Views = window.WF_Views || {};

// ============================================================================
// 1. OWNER & MANAGER DASHBOARD + FIRST-TIME SETUP WIZARD
// ============================================================================
WF_Views.renderDashboard = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل لوحة التحكم...', 'Loading dashboard...')}</div>`;

  try {
    const [dash, setup] = await Promise.all([
      WF.api('/api/dashboard'),
      WF.api('/api/company/setup-status')
    ]);

    const k = dash.kpis;
    const isOwner = WF.auth.membership.role === 'owner';
    const ch = setup.checklist;
    const completedSteps = [
      ch.company_profile.completed,
      ch.timezone.completed,
      ch.departments.completed,
      ch.employees.completed,
      ch.projects.completed,
      ch.tasks.completed
    ].filter(Boolean).length;

    const setupChecklistHtml = isOwner ? `
      <div class="card" style="border-inline-start: 4px solid var(--primary); background: var(--bg-surface);">
        <div class="card-header">
          <div>
            <div class="card-title">🚀 ${WF_I18N.bi('قائمة إعداد الشركة لأول مرة (Setup Checklist)', 'First-Time Company Setup Checklist')} (${completedSteps}/6)</div>
            <div class="page-subtitle">${WF_I18N.bi('أكمل خطوات تهيئة مساحة عمل شركتك أو تخطَّ الخطوات الاختيارية وعد إليها لاحقاً.', 'Complete your workspace setup steps or skip optional steps and return later.')}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="WF_Views.openSetupWizardModal()">${WF_I18N.bi('فتح معالج الإعداد', 'Open Setup Wizard')}</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
          <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
            <span>1. ${WF_I18N.bi('ملف الشركة والمنطقة الزمنية', 'Company Profile & Timezone')}</span>
            <span class="badge ${ch.company_profile.completed ? 'badge-success' : 'badge-warning'}">${ch.company_profile.completed ? WF_I18N.bi('مكتمل', 'Completed') : WF_I18N.bi('غير مهيأ', 'Configure')}</span>
          </div>
          <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
            <span>2. ${WF_I18N.bi('الأقسام', 'Departments')}</span>
            ${ch.departments.completed
              ? `<span class="badge badge-success">${WF_I18N.bi('مكتمل', 'Configured')} (${ch.departments.count})</span>`
              : `<button class="btn btn-secondary btn-sm" onclick="WF_Views.openCreateDepartmentModal()">+ ${WF_I18N.bi('إنشاء قسم', 'Create')}</button>`}
          </div>
          <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
            <span>3. ${WF_I18N.bi('الموظفون', 'Employees')}</span>
            ${ch.employees.completed
              ? `<span class="badge badge-success">${WF_I18N.bi('مضاف', 'Added')} (${ch.employees.count})</span>`
              : `<button class="btn btn-secondary btn-sm" onclick="location.hash='#/employees'">+ ${WF_I18N.bi('إضافة موظف', 'Add')}</button>`}
          </div>
          <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
            <span>4. ${WF_I18N.bi('المشاريع', 'Projects')}</span>
            ${ch.projects.completed
              ? `<span class="badge badge-success">${WF_I18N.bi('مضاف', 'Created')} (${ch.projects.count})</span>`
              : `<button class="btn btn-secondary btn-sm" onclick="WF_Views.openCreateProjectModal()">+ ${WF_I18N.bi('إنشاء مشروع', 'Create')}</button>`}
          </div>
          <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center;">
            <span>5. ${WF_I18N.bi('المهام', 'Tasks')}</span>
            ${ch.tasks.completed
              ? `<span class="badge badge-success">${WF_I18N.bi('مضافة', 'Assigned')} (${ch.tasks.count})</span>`
              : `<button class="btn btn-secondary btn-sm" onclick="WF_Views.openCreateTaskModal()">+ ${WF_I18N.bi('إسناد مهمة', 'Assign')}</button>`}
          </div>
        </div>
      </div>
    ` : '';

    const att = dash.attention_required;
    const attentionItems = [
      ...att.overdue_tasks.map((t) => ({ ...t, reasonBadge: `<span class="badge badge-danger">${WF_I18N.bi('متأخرة', 'Overdue')}</span>` })),
      ...att.awaiting_review_tasks.map((t) => ({ ...t, reasonBadge: `<span class="badge badge-purple">${WF_I18N.bi('بانتظار الاعتماد', 'Awaiting Review')}</span>` })),
      ...att.blocked_tasks.map((t) => ({ ...t, reasonBadge: `<span class="badge badge-danger">${WF_I18N.bi('متوقفة بعائق', 'Blocked')}</span>` })),
      ...att.urgent_tasks.map((t) => ({ ...t, reasonBadge: `<span class="badge badge-warning">${WF_I18N.bi('عاجلة', 'Urgent')}</span>` })),
      ...att.extension_requests.map((t) => ({ ...t, reasonBadge: `<span class="badge badge-info">${WF_I18N.bi('طلب تمديد موعد', 'Extension Request')}</span>` }))
    ];
    // Deduplicate attention tasks by id
    const seenTaskIds = new Set();
    const uniqueAttention = attentionItems.filter((item) => {
      if (seenTaskIds.has(item.id)) return false;
      seenTaskIds.add(item.id);
      return true;
    }).slice(0, 10);

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.bi('لوحة القيادة والمتابعة التنفيذية', 'Executive Management Dashboard')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('نظرة فورية على سير المشاريع، المهام المتأخرة أو المتوقفة، وما يحتاج إلى قرارك الآن.', 'Real-time overview of active projects, delayed/blocked work, and items requiring your attention.')}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${WF.hasPerm('can_create_projects') ? `<button class="btn btn-secondary" onclick="WF_Views.openCreateProjectModal()">+ ${WF_I18N.t('create_project')}</button>` : ''}
          ${WF.hasPerm('can_create_tasks') ? `<button class="btn btn-primary" onclick="WF_Views.openCreateTaskModal()">+ ${WF_I18N.t('create_task')}</button>` : ''}
        </div>
      </div>

      ${setupChecklistHtml}

      <!-- Clickable KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card" onclick="location.hash='#/projects'">
          <span class="kpi-label">${WF_I18N.bi('المشاريع النشطة', 'Active Projects')}</span>
          <span class="kpi-value" style="color:var(--primary);">${k.total_active_projects}</span>
          <span class="kpi-meta">${WF_I18N.bi('اضغط لعرض المشاريع ←', 'Click to view projects →')}</span>
        </div>
        <div class="kpi-card" onclick="location.hash='#/tasks'">
          <span class="kpi-label">${WF_I18N.bi('المهام المفتوحة', 'Total Open Tasks')}</span>
          <span class="kpi-value">${k.total_open_tasks}</span>
          <span class="kpi-meta">${WF_I18N.bi('قيد التنفيذ والانتظار', 'Across active workflows')}</span>
        </div>
        <div class="kpi-card" onclick="location.hash='#/tasks?status=completed'">
          <span class="kpi-label">${WF_I18N.bi('مكتملة هذا الأسبوع', 'Completed This Week')}</span>
          <span class="kpi-value" style="color:var(--success);">${k.tasks_completed_this_week}</span>
          <span class="kpi-meta">${WF_I18N.bi('خلال آخر 7 أيام', 'Last 7 days')}</span>
        </div>
        <div class="kpi-card" onclick="location.hash='#/tasks?view=overdue'">
          <span class="kpi-label">${WF_I18N.bi('مهام متأخرة', 'Overdue Tasks')}</span>
          <span class="kpi-value" style="color:var(--danger);">${k.overdue_tasks}</span>
          <span class="kpi-meta">${WF_I18N.bi('تجاوزت الموعد النهائي', 'Past deadline')}</span>
        </div>
        <div class="kpi-card" onclick="location.hash='#/tasks?status=in_review'">
          <span class="kpi-label">${WF_I18N.bi('مهام بانتظار المراجعة', 'Awaiting Review')}</span>
          <span class="kpi-value" style="color:var(--purple);">${k.tasks_awaiting_review}</span>
          <span class="kpi-meta">${WF_I18N.bi('تحتاج إلى اعتماد المدير', 'Pending manager approval')}</span>
        </div>
        <div class="kpi-card" onclick="location.hash='#/employees'">
          <span class="kpi-label">${WF_I18N.bi('الموظفون النشطون', 'Active Employees')}</span>
          <span class="kpi-value">${k.active_employees}</span>
          <span class="kpi-meta">${WF_I18N.bi('أعضاء مساحة العمل', 'Active workspace members')}</span>
        </div>
      </div>

      <div class="grid-2">
        <!-- A. Tasks Requiring Attention -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">⚠️ ${WF_I18N.bi('مهام تتطلب انتباهك الفوري', 'Tasks Requiring Immediate Attention')}</span>
            <a href="#/tasks" class="btn btn-ghost btn-sm">${WF_I18N.bi('عرض الكل', 'View All')}</a>
          </div>
          ${uniqueAttention.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">✅</div>
              <div class="empty-state-title">${WF_I18N.bi('لا توجد مهام متأخرة أو معلقة حالياً', 'No overdue, blocked, or pending-review tasks')}</div>
              <p>${WF_I18N.bi('جميع المهام تسير وفق الجدول الزمني المحدد.', 'All tasks are progressing smoothly.')}</p>
            </div>
          ` : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${WF_I18N.bi('المهمة', 'Task')}</th>
                    <th>${WF_I18N.bi('المسؤول', 'Assignee')}</th>
                    <th>${WF_I18N.bi('السبب / الحالة', 'Attention Reason')}</th>
                    <th>${WF_I18N.bi('الموعد', 'Deadline')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${uniqueAttention.map((t) => `
                    <tr style="cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                      <td>
                        <div style="font-weight:700;">${WF.escapeHtml(t.title)}</div>
                        <div style="font-size:11.5px;color:var(--text-muted);">${WF.escapeHtml(t.project_name || '—')}</div>
                      </td>
                      <td>${WF.escapeHtml(t.assignee_name || '—')}</td>
                      <td>${t.reasonBadge}</td>
                      <td>${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- B. Project Progress -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">📊 ${WF_I18N.bi('تقدم المشاريع النشطة', 'Active Projects Progress')}</span>
            <a href="#/projects" class="btn btn-ghost btn-sm">${WF_I18N.bi('كل المشاريع', 'All Projects')}</a>
          </div>
          ${dash.project_progress.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">📁</div>
              <div class="empty-state-title">${WF_I18N.bi('لا توجد مشاريع نشطة بعد', 'No active projects yet')}</div>
              ${WF.hasPerm('can_create_projects') ? `<button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="WF_Views.openCreateProjectModal()">+ ${WF_I18N.t('create_project')}</button>` : ''}
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:14px;">
              ${dash.project_progress.map((p) => `
                <div style="padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);cursor:pointer;" onclick="location.hash='#/projects/${p.id}'">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-weight:700;display:flex;align-items:center;gap:8px;">
                      <span style="width:10px;height:10px;border-radius:50%;background:${WF.escapeHtml(p.color || '#2563eb')};display:inline-block;"></span>
                      ${WF.escapeHtml(p.name)}
                    </div>
                    ${WF_I18N.healthBadge(p.health)}
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
                    <span>${WF_I18N.bi('المدير:', 'Manager:')} ${WF.escapeHtml(p.manager_name || '—')}</span>
                    <span>${p.completed_tasks}/${p.total_tasks} ${WF_I18N.bi('مهام مكتملة', 'tasks completed')} (${p.progress_percentage}%)</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${p.health === 'delayed' ? 'danger' : (p.progress_percentage === 100 ? 'success' : '')}" style="width:${p.progress_percentage}%"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>

      <div class="grid-2">
        <!-- C. Team Workload -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">👥 ${WF_I18N.bi('توزيع عبء العمل على الفريق', 'Team Workload Distribution')}</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${WF.escapeHtml(dash.workload_note)}</p>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${WF_I18N.bi('الموظف', 'Employee')}</th>
                  <th>${WF_I18N.bi('مفتوحة', 'Open')}</th>
                  <th>${WF_I18N.bi('عاجلة', 'Urgent')}</th>
                  <th>${WF_I18N.bi('متأخرة', 'Overdue')}</th>
                  <th>${WF_I18N.bi('حالة العبء', 'Workload Balance')}</th>
                </tr>
              </thead>
              <tbody>
                ${dash.team_workload.map((w) => {
                  const badge = w.workload_status === 'overloaded'
                    ? `<span class="badge badge-danger">${WF_I18N.bi('ضغط مرتفع جداً', 'Overloaded')}</span>`
                    : (w.workload_status === 'high_load'
                      ? `<span class="badge badge-warning">${WF_I18N.bi('عبء مرتفع', 'High Load')}</span>`
                      : `<span class="badge badge-success">${WF_I18N.bi('متوازن', 'Balanced')}</span>`);
                  return `
                    <tr>
                      <td>
                        <div style="font-weight:600;">${WF.escapeHtml(w.full_name)}</div>
                        <div style="font-size:11.5px;color:var(--text-muted);">${WF.escapeHtml(w.job_title || w.department_name || '')}</div>
                      </td>
                      <td><strong>${w.open_tasks_count}</strong></td>
                      <td>${w.urgent_tasks_count > 0 ? `<span class="badge badge-danger">${w.urgent_tasks_count}</span>` : '0'}</td>
                      <td>${w.overdue_tasks_count > 0 ? `<span class="badge badge-danger">${w.overdue_tasks_count}</span>` : '0'}</td>
                      <td>${badge}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- D & E. Upcoming Deadlines (Next 7 Days) & Recent Activity -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">📅 ${WF_I18N.bi('المواعيد النهائية خلال 7 أيام', 'Upcoming Deadlines (Next 7 Days)')}</span>
            <a href="#/calendar" class="btn btn-secondary btn-sm">${WF_I18N.bi('فتح التقويم الكامل', 'Full Calendar')}</a>
          </div>
          ${dash.upcoming_deadlines.length === 0 ? `
            <div class="empty-state" style="padding:18px;">
              <div>${WF_I18N.bi('لا توجد مواعيد تسليم خلال الأيام السبعة القادمة.', 'No deadlines scheduled in the next 7 days.')}</div>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${dash.upcoming_deadlines.slice(0, 6).map((t) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-muted);border-radius:var(--radius-sm);cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                  <div>
                    <div style="font-weight:600;">${WF.escapeHtml(t.title)}</div>
                    <div style="font-size:11.5px;color:var(--text-muted);">${WF.escapeHtml(t.assignee_name || '—')} • ${WF.escapeHtml(t.project_name || '')}</div>
                  </div>
                  ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
                </div>
              `).join('')}
            </div>
          `}

          <div class="card-header" style="margin-top:12px;">
            <span class="card-title">🕒 ${WF_I18N.bi('أحدث النشاطات', 'Recent Activity')}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">
            ${dash.recent_activity.slice(0, 10).map((a) => `
              <div style="font-size:12.5px;padding:7px 10px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;gap:8px;">
                <div>
                  <strong>${WF.escapeHtml(a.actor_name || 'System')}</strong>:
                  <span style="color:var(--text-secondary);">${WF.escapeHtml(a.action)}</span>
                </div>
                <span style="color:var(--text-muted);font-size:11.5px;white-space:nowrap;">${WF.formatDateTime(a.created_at)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.openSetupWizardModal = async function () {
  const status = await WF.api('/api/company/setup-status');
  const c = WF.auth.company;
  const s = WF.auth.settings || {};

  WF.openModal({
    title: `🚀 ${WF_I18N.bi('معالج الإعداد الأولي للشركة (Setup Wizard)', 'First-Time Company Setup Wizard')}`,
    size: 'lg',
    bodyHtml: `
      <p style="color:var(--text-secondary);margin-bottom:16px;">
        ${WF_I18N.bi('يمكنك إكمال بيانات الشركة والمنطقة الزمنية من هنا، أو إنشاء أول قسم وموظف ومشروع ومهمة مباشرة.', 'Configure your company profile and timezone, or jump straight to creating your first department, employee, project, and task.')}
      </p>
      <form id="setup-wizard-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('اسم الشركة', 'Company Name')}</label>
            <input type="text" class="form-control" name="company_name" value="${WF.escapeHtml(c.name || '')}" required />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('مجال العمل / الصناعة', 'Industry')}</label>
            <input type="text" class="form-control" name="industry" value="${WF.escapeHtml(c.industry || '')}" placeholder="${WF_I18N.bi('مثال: تطوير البرمجيات، وكالة تسويق...', 'e.g. Software, Marketing Agency...')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('حجم الشركة', 'Company Size')}</label>
            <select class="form-control" name="size">
              <option value="1-10" ${c.size === '1-10' ? 'selected' : ''}>1 - 10</option>
              <option value="11-50" ${c.size === '11-50' ? 'selected' : ''}>11 - 50</option>
              <option value="51-200" ${c.size === '51-200' ? 'selected' : ''}>51 - 200</option>
              <option value="200+" ${c.size === '200+' ? 'selected' : ''}>200+</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المنطقة الزمنية للشركة (Timezone)', 'Company Timezone')}</label>
            <select class="form-control" name="timezone">
              ${['Asia/Riyadh', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Amman', 'Europe/London', 'UTC'].map((tz) => `
                <option value="${tz}" ${s.timezone === tz ? 'selected' : ''}>${tz}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('نبذة عن الشركة', 'Company Description')}</label>
          <textarea class="form-control" name="description" rows="2">${WF.escapeHtml(c.description || '')}</textarea>
        </div>
      </form>
      <hr style="border:none;border-top:1px solid var(--border-color);margin:16px 0;" />
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
        <button type="button" class="btn btn-secondary" onclick="WF.closeModal();WF_Views.openCreateDepartmentModal()">3. + ${WF_I18N.bi('إنشاء القسم الأول', 'Create First Department')}</button>
        <button type="button" class="btn btn-secondary" onclick="WF.closeModal();location.hash='#/employees'">4. + ${WF_I18N.bi('إضافة أو دعوة موظف', 'Add / Invite Employee')}</button>
        <button type="button" class="btn btn-secondary" onclick="WF.closeModal();WF_Views.openCreateProjectModal()">5. + ${WF_I18N.bi('إنشاء المشروع الأول', 'Create First Project')}</button>
        <button type="button" class="btn btn-secondary" onclick="WF.closeModal();WF_Views.openCreateTaskModal()">6. + ${WF_I18N.bi('إسناد المهمة الأولى', 'Assign First Task')}</button>
      </div>
    `,
    footerHtml: `
      <button type="button" class="btn btn-ghost" onclick="WF.closeModal()">${WF_I18N.bi('تخطي الآن والعودة لاحقاً', 'Skip for Now')}</button>
      <button type="button" class="btn btn-primary" onclick="WF_Views.saveSetupWizard()">${WF_I18N.bi('حفظ الإعدادات', 'Save Setup')}</button>
    `
  });
};

WF_Views.saveSetupWizard = async function () {
  const form = document.getElementById('setup-wizard-form');
  if (!form) return;
  const fd = new FormData(form);
  try {
    await WF.api('/api/company/setup-wizard', {
      method: 'PUT',
      body: {
        company_name: fd.get('company_name'),
        industry: fd.get('industry'),
        size: fd.get('size'),
        timezone: fd.get('timezone'),
        description: fd.get('description'),
        setup_wizard_completed: 1
      }
    });
    WF.toast(WF_I18N.bi('تم حفظ إعدادات الشركة بنجاح', 'Company setup saved'), 'success');
    WF.closeModal();
    await WF_App.refreshAuth();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 2. EMPLOYEE WORKSPACE — MY TASKS
// ============================================================================
WF_Views.myTasksState = {
  tab: 'my_open',
  priority: '',
  project_id: '',
  sort_by: 'deadline'
};

WF_Views.renderMyTasks = async function (container) {
  const st = this.myTasksState;
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل مهامك...', 'Loading your tasks...')}</div>`;

  try {
    await WF.refreshReferenceData();
    const params = new URLSearchParams({
      view: st.tab,
      sort_by: st.sort_by,
      sort_dir: 'asc'
    });
    if (st.priority) params.set('priority', st.priority);
    if (st.project_id) params.set('project_id', st.project_id);

    const res = await WF.api(`/api/tasks?${params.toString()}`);
    const sum = res.my_tasks_summary;
    const tasks = res.tasks || [];

    const tabs = [
      ['my_tasks', WF_I18N.bi('جميع مهامي', 'All My Tasks'), sum.assigned_total],
      ['my_open', WF_I18N.bi('مهامي المفتوحة', 'My Open Tasks'), sum.open_count],
      ['in_progress', WF_I18N.bi('قيد التنفيذ', 'In Progress'), sum.in_progress_count],
      ['due_today', WF_I18N.bi('تستحق اليوم', 'Due Today'), sum.due_today_count],
      ['my_overdue', WF_I18N.bi('متأخرة', 'Overdue'), sum.overdue_count],
      ['my_awaiting_review', WF_I18N.bi('بانتظار المراجعة', 'Awaiting Review'), sum.awaiting_review_count],
      ['completed', WF_I18N.bi('المكتملة', 'Completed'), sum.completed_this_week_count]
    ];

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">👋 ${WF_I18N.bi('مرحباً بك،', 'Welcome,')} ${WF.escapeHtml(WF.auth.user.full_name)}</h1>
          <p class="page-subtitle">📅 ${WF_I18N.bi('تاريخ اليوم:', 'Today:')} <strong>${sum.today_date}</strong> (${sum.timezone})</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" onclick="WF_Views.openCreateTaskModal()">+ ${WF_I18N.bi('إضافة مهمة جديدة', 'Create Task')}</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card" onclick="WF_Views.setMyTasksTab('my_tasks')">
          <span class="kpi-label">${WF_I18N.bi('المهام المسندة إليك', 'Assigned to You')}</span>
          <span class="kpi-value">${sum.assigned_total}</span>
        </div>
        <div class="kpi-card" onclick="WF_Views.setMyTasksTab('due_today')">
          <span class="kpi-label">${WF_I18N.bi('تستحق اليوم', 'Due Today')}</span>
          <span class="kpi-value" style="color:var(--warning);">${sum.due_today_count}</span>
        </div>
        <div class="kpi-card" onclick="WF_Views.setMyTasksTab('my_overdue')">
          <span class="kpi-label">${WF_I18N.bi('مهام متأخرة', 'Overdue Tasks')}</span>
          <span class="kpi-value" style="color:var(--danger);">${sum.overdue_count}</span>
        </div>
        <div class="kpi-card" onclick="WF_Views.setMyTasksTab('my_awaiting_review')">
          <span class="kpi-label">${WF_I18N.bi('بانتظار المراجعة', 'Awaiting Review')}</span>
          <span class="kpi-value" style="color:var(--purple);">${sum.awaiting_review_count}</span>
        </div>
        <div class="kpi-card" onclick="WF_Views.setMyTasksTab('completed')">
          <span class="kpi-label">${WF_I18N.bi('مكتملة هذا الأسبوع', 'Completed This Week')}</span>
          <span class="kpi-value" style="color:var(--success);">${sum.completed_this_week_count}</span>
        </div>
      </div>

      <div class="tabs">
        ${tabs.map(([code, label, count]) => `
          <button class="tab-btn ${st.tab === code ? 'active' : ''}" onclick="WF_Views.setMyTasksTab('${code}')">
            ${label} <span class="badge badge-neutral">${count}</span>
          </button>
        `).join('')}
      </div>

      <div class="filter-bar">
        <select class="form-control" onchange="WF_Views.myTasksState.priority=this.value;WF_Views.renderMyTasks(document.getElementById('page-content'))">
          <option value="">${WF_I18N.bi('كل الأولويات', 'All Priorities')}</option>
          <option value="urgent" ${st.priority === 'urgent' ? 'selected' : ''}>${WF_I18N.t('priority_urgent')}</option>
          <option value="high" ${st.priority === 'high' ? 'selected' : ''}>${WF_I18N.t('priority_high')}</option>
          <option value="medium" ${st.priority === 'medium' ? 'selected' : ''}>${WF_I18N.t('priority_medium')}</option>
          <option value="low" ${st.priority === 'low' ? 'selected' : ''}>${WF_I18N.t('priority_low')}</option>
        </select>

        <select class="form-control" onchange="WF_Views.myTasksState.project_id=this.value;WF_Views.renderMyTasks(document.getElementById('page-content'))">
          <option value="">${WF_I18N.bi('كل المشاريع', 'All Projects')}</option>
          ${WF.projects.map((p) => `<option value="${p.id}" ${st.project_id === p.id ? 'selected' : ''}>${WF.escapeHtml(p.name)}</option>`).join('')}
        </select>

        <select class="form-control" onchange="WF_Views.myTasksState.sort_by=this.value;WF_Views.renderMyTasks(document.getElementById('page-content'))">
          <option value="deadline" ${st.sort_by === 'deadline' ? 'selected' : ''}>${WF_I18N.bi('ترتيب حسب الموعد النهائي', 'Sort by Deadline')}</option>
          <option value="priority" ${st.sort_by === 'priority' ? 'selected' : ''}>${WF_I18N.bi('ترتيب حسب الأولوية', 'Sort by Priority')}</option>
          <option value="updated_at" ${st.sort_by === 'updated_at' ? 'selected' : ''}>${WF_I18N.bi('الأحدث تحديثاً', 'Recently Updated')}</option>
        </select>
      </div>

      ${tasks.length === 0 ? `
        <div class="card empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">${WF_I18N.bi('لا توجد مهام في هذا التبويب حالياً', 'No tasks in this view')}</div>
          <p>${WF_I18N.bi('عند إسناد مهام إليك ستظهر هنا مع الخطوة التالية المطلوبة بوضوح.', 'Tasks assigned to you will appear here with clear next actions.')}</p>
        </div>
      ` : `
        <div class="grid-2">
          ${tasks.map((t) => WF_Views.renderEmployeeTaskCard(t)).join('')}
        </div>
      `}
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.setMyTasksTab = function (tab) {
  this.myTasksState.tab = tab;
  this.renderMyTasks(document.getElementById('page-content'));
};

WF_Views.isImageAttachment = function (a) {
  if (!a) return false;
  if (a.is_image) return true;
  const mime = String(a.mime_type || '').toLowerCase();
  const name = String(a.original_name || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|svg|gif)$/i.test(name);
};

WF_Views.getAttachmentInlineUrl = function (attachmentId) {
  const tok = encodeURIComponent(WF.token || '');
  return `/api/attachments/${attachmentId}/download?inline=1&token=${tok}`;
};

WF_Views.previewImageModal = function (attachmentId, filename) {
  const imgUrl = WF_Views.getAttachmentInlineUrl(attachmentId);
  WF.openModal({
    title: `🖼️ ${WF_I18N.bi('معاينة الصورة المرجعية:', 'Reference Image Preview:')} ${WF.escapeHtml(filename)}`,
    size: 'lg',
    bodyHtml: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:10px;">
        <div style="max-width:100%;max-height:68vh;overflow:auto;border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;background:var(--bg-muted);display:flex;justify-content:center;align-items:center;">
          <img src="${imgUrl}" alt="${WF.escapeHtml(filename)}" style="max-width:100%;max-height:62vh;object-fit:contain;border-radius:8px;" />
        </div>
      </div>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('close')}</button>
      <button class="btn btn-primary" onclick="WF_Views.downloadAttachment('${attachmentId}', '${WF.escapeHtml(filename)}')">⬇️ ${WF_I18N.bi('تحميل الصورة الأصلية', 'Download Original Image')}</button>
    `
  });
};

WF_Views.renderTaskAttachmentsBlock = function (attachments, compact = false) {
  if (!attachments || attachments.length === 0) return '';
  const images = attachments.filter((a) => WF_Views.isImageAttachment(a));
  const files = attachments.filter((a) => !WF_Views.isImageAttachment(a));

  return `
    <div class="task-media-box" onclick="event.stopPropagation()">
      ${images.map((img) => {
        const inlineUrl = WF_Views.getAttachmentInlineUrl(img.id);
        const safeName = WF.escapeHtml(img.original_name);
        return `
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div class="task-image-preview-wrap" style="${compact ? 'height:96px;' : 'height:135px;'}" onclick="WF_Views.previewImageModal('${img.id}', '${safeName}')" title="${WF_I18N.bi('اضغط لتكبير الصورة', 'Click to enlarge')}">
              <img src="${inlineUrl}" alt="${safeName}" loading="lazy" />
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <span class="task-file-name" title="${safeName}">🖼️ ${safeName}</span>
              <div style="display:flex;gap:4px;flex-shrink:0;">
                <button type="button" class="btn btn-secondary btn-sm" style="padding:3px 8px;font-size:11.5px;" onclick="WF_Views.previewImageModal('${img.id}', '${safeName}')">🔍 ${WF_I18N.bi('معاينة', 'Preview')}</button>
                <button type="button" class="btn btn-primary btn-sm" style="padding:3px 9px;font-size:11.5px;" onclick="WF_Views.downloadAttachment('${img.id}', '${safeName}')">⬇️ ${WF_I18N.bi('تحميل الصورة', 'Download')}</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
      ${files.map((f) => {
        const safeName = WF.escapeHtml(f.original_name);
        return `
          <div class="task-file-item">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;">
              <span>📎</span>
              <span class="task-file-name" title="${safeName}">${safeName}</span>
              <span style="color:var(--text-muted);font-size:11px;flex-shrink:0;">(${WF.formatBytes(f.size_bytes)})</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" style="padding:3px 9px;font-size:11.5px;flex-shrink:0;" onclick="WF_Views.downloadAttachment('${f.id}', '${safeName}')">⬇️ ${WF_I18N.bi('تحميل الملف', 'Download')}</button>
          </div>
        `;
      }).join('')}
    </div>
  `;
};

WF_Views.renderEmployeeTaskCard = function (t) {
  let nextActionBtn = '';
  if (t.status === 'todo' || t.status === 'backlog') {
    nextActionBtn = `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();WF_Views.quickUpdateTaskStatus('${t.id}', 'in_progress')">▶️ ${WF_I18N.t('start_task')}</button>`;
  } else if (t.status === 'in_progress') {
    nextActionBtn = `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();WF_Views.quickSubmitForReview('${t.id}')">📤 ${WF_I18N.t('submit_for_review')}</button>`;
  } else if (t.status === 'in_review') {
    nextActionBtn = `<span class="badge badge-purple">⏳ ${WF_I18N.bi('بانتظار مراجعة المدير', 'Pending Manager Review')}</span>`;
  }

  const attachmentsHtml = WF_Views.renderTaskAttachmentsBlock(t.attachments || [], false);

  return `
    <div class="card priority-${t.priority}" style="margin-bottom:0;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:10px;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
          <div style="min-width:0;">
            <span class="kanban-project-tag" style="display:inline-block;margin-bottom:6px;max-width:240px;">📁 ${WF.escapeHtml(t.project_name || WF_I18N.bi('مهمة عامة', 'General Task'))}</span>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);line-height:1.4;">${WF.escapeHtml(t.title)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;">
            ${WF_I18N.priorityBadge(t.priority)}
            ${WF_I18N.statusBadge(t.status)}
          </div>
        </div>

        ${t.description ? `<p class="kanban-card-desc" style="margin-bottom:10px;">${WF.escapeHtml(t.description)}</p>` : ''}

        ${attachmentsHtml}

        <div style="margin:12px 0 4px;">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;">
            <span>${WF_I18N.bi('نسبة الإنجاز', 'Progress')}</span>
            <span>${t.progress}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${t.status === 'completed' ? 'success' : ''}" style="width:${t.progress}%"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding-top:12px;border-top:1px solid var(--border-color);">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
          ${t.collaborators && t.collaborators.length > 0 ? `<span class="badge badge-neutral">+${t.collaborators.length} ${WF_I18N.bi('مشاركون', 'collab')}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${nextActionBtn}
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();WF_Views.openTaskDetailModal('${t.id}')">${WF_I18N.bi('التفاصيل والملفات', 'Details & Files')}</button>
        </div>
      </div>
    </div>
  `;
};

WF_Views.quickUpdateTaskStatus = async function (taskId, newStatus) {
  try {
    await WF.api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: { status: newStatus }
    });
    WF.toast(WF_I18N.bi('تم تحديث حالة المهمة بنجاح', 'Task status updated'), 'success');
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
    WF_App.route();
  }
};

WF_Views.quickSubmitForReview = async function (taskId) {
  try {
    await WF.api(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      body: { action: 'submit', feedback: WF_I18N.bi('تم إنجاز العمل وإرساله للمراجعة.', 'Completed work and submitted for review.') }
    });
    WF.toast(WF_I18N.bi('تم إرسال المهمة للمراجعة وإشعار المدير', 'Task submitted for review'), 'success');
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 3. ALL TASKS — KANBAN BOARD & TABLE VIEW (WITH BULK ACTIONS)
// ============================================================================
WF_Views.tasksViewState = {
  mode: localStorage.getItem('wf_tasks_mode') || 'kanban', // 'kanban' or 'table'
  project_id: '',
  assignee_user_id: '',
  department_id: '',
  priority: '',
  status: '',
  q: '',
  sort_by: 'created_at',
  sort_dir: 'desc',
  selectedIds: new Set(),
  showBlockedColumn: true,
  columnsVisible: {
    project: true,
    assignee: true,
    status: true,
    priority: true,
    start_date: true,
    deadline: true,
    progress: true,
    updated_at: true
  }
};

WF_Views.renderAllTasks = async function (container, queryParams) {
  const st = this.tasksViewState;
  if (queryParams) {
    if (queryParams.get('status')) st.status = queryParams.get('status');
    if (queryParams.get('view') === 'overdue') st.overdueOnly = true;
    else st.overdueOnly = false;
  }

  await WF.refreshReferenceData();

  const params = new URLSearchParams({
    sort_by: st.sort_by,
    sort_dir: st.sort_dir
  });
  if (st.project_id) params.set('project_id', st.project_id);
  if (st.assignee_user_id) params.set('assignee_user_id', st.assignee_user_id);
  if (st.department_id) params.set('department_id', st.department_id);
  if (st.priority) params.set('priority', st.priority);
  if (st.status) params.set('status', st.status);
  if (st.q) params.set('q', st.q);
  if (st.overdueOnly) params.set('view', 'overdue');

  const res = await WF.api(`/api/tasks?${params.toString()}`);
  const tasks = res.tasks || [];

  const canBulk = WF.auth.membership.role === 'owner' || WF.auth.membership.role === 'manager' || WF.hasPerm('can_assign_tasks');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${WF_I18N.bi('إدارة المهام ولوحة كانبان', 'Task Management — Kanban & Table Views')}</h1>
        <p class="page-subtitle">${WF_I18N.bi('تتبع حالات المهام، الأولويات، المواعيد النهائية، والعمليات الجماعية.', 'Manage tasks across Kanban columns or structured tables with bulk operations.')}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:var(--radius-sm);overflow:hidden;">
          <button class="btn ${st.mode === 'kanban' ? 'btn-primary' : 'btn-secondary'} btn-sm" style="border-radius:0;" onclick="WF_Views.setTasksMode('kanban')">📋 ${WF_I18N.bi('لوحة كانبان (Kanban)', 'Kanban Board')}</button>
          <button class="btn ${st.mode === 'table' ? 'btn-primary' : 'btn-secondary'} btn-sm" style="border-radius:0;" onclick="WF_Views.setTasksMode('table')">📑 ${WF_I18N.bi('جدول المهام (Table)', 'Table View')}</button>
        </div>
        <button class="btn btn-primary" onclick="WF_Views.openCreateTaskModal()">+ ${WF_I18N.t('create_task')}</button>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" class="form-control" placeholder="${WF_I18N.bi('بحث بعنوان المهمة...', 'Search task title...')}" value="${WF.escapeHtml(st.q)}" onchange="WF_Views.tasksViewState.q=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))" />
      <select class="form-control" onchange="WF_Views.tasksViewState.project_id=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))">
        <option value="">${WF_I18N.bi('كل المشاريع', 'All Projects')}</option>
        ${WF.projects.map((p) => `<option value="${p.id}" ${st.project_id === p.id ? 'selected' : ''}>${WF.escapeHtml(p.name)}</option>`).join('')}
      </select>
      <select class="form-control" onchange="WF_Views.tasksViewState.assignee_user_id=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))">
        <option value="">${WF_I18N.bi('كل الموظفين', 'All Assignees')}</option>
        ${WF.directory.map((u) => `<option value="${u.id}" ${st.assignee_user_id === u.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)}</option>`).join('')}
      </select>
      <select class="form-control" onchange="WF_Views.tasksViewState.department_id=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))">
        <option value="">${WF_I18N.bi('كل الأقسام', 'All Departments')}</option>
        ${WF.departments.map((d) => `<option value="${d.id}" ${st.department_id === d.id ? 'selected' : ''}>${WF.escapeHtml(d.name)}</option>`).join('')}
      </select>
      <select class="form-control" onchange="WF_Views.tasksViewState.priority=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))">
        <option value="">${WF_I18N.bi('كل الأولويات', 'All Priorities')}</option>
        <option value="urgent" ${st.priority === 'urgent' ? 'selected' : ''}>${WF_I18N.t('priority_urgent')}</option>
        <option value="high" ${st.priority === 'high' ? 'selected' : ''}>${WF_I18N.t('priority_high')}</option>
        <option value="medium" ${st.priority === 'medium' ? 'selected' : ''}>${WF_I18N.t('priority_medium')}</option>
        <option value="low" ${st.priority === 'low' ? 'selected' : ''}>${WF_I18N.t('priority_low')}</option>
      </select>
      <select class="form-control" onchange="WF_Views.tasksViewState.status=this.value;WF_Views.renderAllTasks(document.getElementById('page-content'))">
        <option value="">${WF_I18N.bi('كل الحالات', 'All Statuses')}</option>
        ${['backlog', 'todo', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled'].map((s) => `
          <option value="${s}" ${st.status === s ? 'selected' : ''}>${WF_I18N.t('status_' + s)}</option>
        `).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" onclick="WF_Views.resetTaskFilters()">${WF_I18N.bi('إعادة ضبط', 'Reset')}</button>
    </div>

    <div id="tasks-view-body">
      ${st.mode === 'kanban' ? this.renderKanbanHtml(tasks) : this.renderTaskTableHtml(tasks, canBulk)}
    </div>
  `;

  if (st.mode === 'kanban') {
    this.bindKanbanDragAndDrop();
  }

  if (queryParams && queryParams.get('taskId')) {
    const tid = queryParams.get('taskId');
    this.openTaskDetailModal(tid);
  }
};

WF_Views.setTasksMode = function (mode) {
  this.tasksViewState.mode = mode;
  localStorage.setItem('wf_tasks_mode', mode);
  this.renderAllTasks(document.getElementById('page-content'));
};

WF_Views.resetTaskFilters = function () {
  const st = this.tasksViewState;
  st.project_id = '';
  st.assignee_user_id = '';
  st.department_id = '';
  st.priority = '';
  st.status = '';
  st.q = '';
  st.overdueOnly = false;
  this.renderAllTasks(document.getElementById('page-content'));
};

WF_Views.renderKanbanHtml = function (tasks) {
  const columns = [
    ['backlog', WF_I18N.t('status_backlog'), 'badge-neutral'],
    ['todo', WF_I18N.t('status_todo'), 'badge-info'],
    ['in_progress', WF_I18N.t('status_in_progress'), 'badge-primary'],
    ['in_review', WF_I18N.t('status_in_review'), 'badge-purple'],
    ['completed', WF_I18N.t('status_completed'), 'badge-success'],
    ['blocked', WF_I18N.t('status_blocked'), 'badge-danger']
  ];

  return `
    <div class="kanban-board">
      ${columns.map(([colStatus, colTitle, colBadgeClass]) => {
        const colTasks = tasks.filter((t) => t.status === colStatus);
        return `
          <div class="kanban-column" data-status="${colStatus}">
            <div class="kanban-column-header">
              <span>${colTitle}</span>
              <span class="badge ${colBadgeClass}">${colTasks.length}</span>
            </div>
            <div class="kanban-column-body" data-drop-status="${colStatus}">
              ${colTasks.length === 0 ? `<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12.5px;border:1px dashed var(--border-color);border-radius:var(--radius-sm);">${WF_I18N.bi('لا توجد مهام في هذه المرحلة', 'No tasks in this stage')}</div>` : ''}
              ${colTasks.map((t) => `
                <div class="kanban-card priority-${t.priority}" draggable="true" data-task-id="${t.id}" data-current-status="${t.status}" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                  <div class="kanban-card-top">
                    <span class="kanban-project-tag" title="${WF.escapeHtml(t.project_name || '')}">📁 ${WF.escapeHtml(t.project_name || WF_I18N.bi('عام', 'General'))}</span>
                    ${WF_I18N.priorityBadge(t.priority)}
                  </div>

                  <div class="kanban-card-title">${WF.escapeHtml(t.title)}</div>

                  ${t.description ? `<div class="kanban-card-desc">${WF.escapeHtml(t.description)}</div>` : ''}

                  ${WF_Views.renderTaskAttachmentsBlock(t.attachments || [], true)}

                  ${t.is_dependency_blocked ? `<div style="font-size:11.5px;font-weight:700;color:var(--danger);background:var(--danger-soft);padding:4px 8px;border-radius:6px;">🔒 ${WF_I18N.bi('مرتبطة بمهمة سابقة غير مكتملة', 'Waiting on dependency')}</div>` : ''}

                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--text-secondary);margin-bottom:4px;">
                      <span>${(t.subtasks_total > 0 || t.checklist_total > 0) ? `☑️ ${t.subtasks_completed + t.checklist_completed}/${t.subtasks_total + t.checklist_total} ${WF_I18N.bi('خطوات', 'steps')}` : WF_I18N.bi('الإنجاز', 'Progress')}</span>
                      <span style="font-weight:700;">${t.progress}%</span>
                    </div>
                    <div class="progress-track" style="height:6px;">
                      <div class="progress-fill ${t.status === 'completed' ? 'success' : ''}" style="width:${t.progress}%"></div>
                    </div>
                  </div>

                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;" onclick="event.stopPropagation()">
                    ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
                    <select class="form-control" style="width:auto;padding:3px 8px;font-size:11.5px;font-weight:700;height:28px;" onchange="WF_Views.quickUpdateTaskStatus('${t.id}', this.value)">
                      ${['backlog', 'todo', 'in_progress', 'in_review', 'completed', 'blocked'].map((stCode) => `
                        <option value="${stCode}" ${t.status === stCode ? 'selected' : ''}>${WF_I18N.t('status_' + stCode)}</option>
                      `).join('')}
                    </select>
                  </div>

                  <div class="kanban-card-footer">
                    <div style="display:flex;align-items:center;gap:7px;min-width:0;">
                      ${WF.renderAvatar(t.assignee_name, t.assignee_avatar, 'avatar-sm')}
                      <span style="font-size:12px;font-weight:700;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${WF.escapeHtml(t.assignee_name || WF_I18N.bi('غير مسندة', 'Unassigned'))}</span>
                    </div>
                    <div style="display:flex;gap:8px;font-size:11.5px;font-weight:700;flex-shrink:0;">
                      ${t.comments_count ? `<span>💬 ${t.comments_count}</span>` : ''}
                      ${t.attachments_count ? `<span>📎 ${t.attachments_count}</span>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
};

WF_Views.bindKanbanDragAndDrop = function () {
  let draggedTaskId = null;
  let sourceStatus = null;

  document.querySelectorAll('.kanban-card[draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedTaskId = card.getAttribute('data-task-id');
      sourceStatus = card.getAttribute('data-current-status');
      e.dataTransfer.setData('text/plain', draggedTaskId);
    });
  });

  document.querySelectorAll('.kanban-column').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const targetStatus = col.getAttribute('data-status');
      const taskId = draggedTaskId || e.dataTransfer.getData('text/plain');
      if (!taskId || !targetStatus || targetStatus === sourceStatus) return;

      try {
        await WF.api(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: { status: targetStatus }
        });
        WF.toast(WF_I18N.bi('تم نقل المهمة وتحديث حالتها', 'Task moved and updated'), 'success');
        WF_Views.renderAllTasks(document.getElementById('page-content'));
      } catch (err) {
        // Restore card to previous position on error
        WF.toast(err.message, 'error');
        WF_Views.renderAllTasks(document.getElementById('page-content'));
      }
    });
  });
};

WF_Views.renderTaskTableHtml = function (tasks, canBulk) {
  const st = this.tasksViewState;
  return `
    ${canBulk ? `
      <div class="card" style="padding:12px 16px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-weight:600;font-size:13px;">
          ⚡ ${WF_I18N.bi('إجراءات جماعية للمهام المحددة:', 'Bulk Actions for Selected Tasks:')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <select id="bulk-status-select" class="form-control" style="width:auto;padding:5px 10px;">
            <option value="">${WF_I18N.bi('تغيير الحالة إلى...', 'Change Status...')}</option>
            ${['todo', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled'].map((s) => `<option value="${s}">${WF_I18N.t('status_' + s)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="WF_Views.executeBulkTaskAction('status')">${WF_I18N.bi('تطبيق الحالة', 'Apply Status')}</button>

          <select id="bulk-priority-select" class="form-control" style="width:auto;padding:5px 10px;">
            <option value="">${WF_I18N.bi('تغيير الأولوية إلى...', 'Change Priority...')}</option>
            ${['low', 'medium', 'high', 'urgent'].map((p) => `<option value="${p}">${WF_I18N.t('priority_' + p)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="WF_Views.executeBulkTaskAction('priority')">${WF_I18N.bi('تطبيق الأولوية', 'Apply Priority')}</button>

          <select id="bulk-assignee-select" class="form-control" style="width:auto;padding:5px 10px;">
            <option value="">${WF_I18N.bi('إعادة إسناد إلى...', 'Reassign to...')}</option>
            ${WF.directory.map((u) => `<option value="${u.id}">${WF.escapeHtml(u.full_name)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="WF_Views.executeBulkTaskAction('reassign')">${WF_I18N.bi('إعادة إسناد', 'Reassign')}</button>

          ${WF.hasPerm('can_delete_tasks') ? `
            <button class="btn btn-danger btn-sm" onclick="WF_Views.executeBulkTaskAction('delete')">🗑️ ${WF_I18N.bi('حذف المحدد', 'Delete Selected')}</button>
          ` : ''}
        </div>
      </div>
    ` : ''}

    <div class="card" style="padding:0;overflow:hidden;">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              ${canBulk ? `<th style="width:36px;"><input type="checkbox" onchange="WF_Views.toggleSelectAllTasks(this.checked)" /></th>` : ''}
              <th>${WF_I18N.bi('المهمة', 'Task')}</th>
              <th>${WF_I18N.bi('المشروع', 'Project')}</th>
              <th>${WF_I18N.bi('المسؤول', 'Assignee')}</th>
              <th>${WF_I18N.bi('الحالة', 'Status')}</th>
              <th>${WF_I18N.bi('الأولوية', 'Priority')}</th>
              <th>${WF_I18N.bi('تاريخ البدء', 'Start Date')}</th>
              <th>${WF_I18N.bi('الموعد النهائي', 'Deadline')}</th>
              <th>${WF_I18N.bi('الإنجاز', 'Progress')}</th>
              <th>${WF_I18N.bi('آخر تحديث', 'Last Updated')}</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.length === 0 ? `
              <tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted);">${WF_I18N.bi('لا توجد مهام مطابقة للفلاتر الحالية.', 'No tasks match the current filters.')}</td></tr>
            ` : tasks.map((t) => `
              <tr onclick="WF_Views.openTaskDetailModal('${t.id}')" style="cursor:pointer;">
                ${canBulk ? `<td onclick="event.stopPropagation()"><input type="checkbox" class="task-bulk-cb" value="${t.id}" /></td>` : ''}
                <td>
                  <div style="font-weight:700;">${WF.escapeHtml(t.title)}</div>
                  ${t.subtasks_total > 0 ? `<div style="font-size:11px;color:var(--text-muted);">${WF_I18N.bi('مهام فرعية:', 'Subtasks:')} ${t.subtasks_completed}/${t.subtasks_total}</div>` : ''}
                </td>
                <td>${WF.escapeHtml(t.project_name || '—')}</td>
                <td>${WF.escapeHtml(t.assignee_name || '—')}</td>
                <td>${WF_I18N.statusBadge(t.status)}</td>
                <td>${WF_I18N.priorityBadge(t.priority)}</td>
                <td>${WF.escapeHtml(t.start_date || '—')}</td>
                <td>${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}</td>
                <td style="min-width:100px;">
                  <div style="font-size:11.5px;margin-bottom:2px;">${t.progress}%</div>
                  <div class="progress-track"><div class="progress-fill" style="width:${t.progress}%"></div></div>
                </td>
                <td style="font-size:12px;color:var(--text-muted);">${WF.formatDateTime(t.updated_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

WF_Views.toggleSelectAllTasks = function (checked) {
  document.querySelectorAll('.task-bulk-cb').forEach((cb) => {
    cb.checked = checked;
  });
};

WF_Views.executeBulkTaskAction = async function (action) {
  const selected = Array.from(document.querySelectorAll('.task-bulk-cb:checked')).map((cb) => cb.value);
  if (selected.length === 0) {
    return WF.toast(WF_I18N.bi('يرجى تحديد مهمة واحدة على الأقل', 'Please select at least one task'), 'warning');
  }

  const payload = { task_ids: selected, action };
  if (action === 'status') {
    payload.status = document.getElementById('bulk-status-select').value;
    if (!payload.status) return WF.toast(WF_I18N.bi('اختر الحالة المطلوبة', 'Select a status'), 'warning');
  } else if (action === 'priority') {
    payload.priority = document.getElementById('bulk-priority-select').value;
    if (!payload.priority) return WF.toast(WF_I18N.bi('اختر الأولوية المطلوبة', 'Select a priority'), 'warning');
  } else if (action === 'reassign') {
    payload.assignee_user_id = document.getElementById('bulk-assignee-select').value;
    if (!payload.assignee_user_id) return WF.toast(WF_I18N.bi('اختر الموظف المسؤول', 'Select an assignee'), 'warning');
  } else if (action === 'delete') {
    if (!confirm(WF_I18N.bi(`هل أنت متأكد من حذف ${selected.length} مهام بشكل نهائي؟`, `Are you sure you want to permanently delete ${selected.length} tasks?`))) {
      return;
    }
    payload.confirmed = true;
  }

  try {
    const res = await WF.api('/api/tasks/bulk', { method: 'POST', body: payload });
    WF.toast(WF_I18N.bi(`تم تحديث ${res.affected_count} مهام بنجاح`, `Updated ${res.affected_count} tasks`), 'success');
    this.renderAllTasks(document.getElementById('page-content'));
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 4. PROJECTS LIST & 6-TAB PROJECT WORKSPACE
// ============================================================================
WF_Views.renderProjects = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل المشاريع...', 'Loading projects...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const res = await WF.api('/api/projects');
    const projects = res.projects || [];

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.t('nav_projects')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('تنظيم أهداف الشركة الكبرى، تتبع نسب الإنجاز التلقائية، وإدارة فرق العمل.', 'Manage company initiatives, track automated task completion progress, and coordinate project teams.')}</p>
        </div>
        ${WF.hasPerm('can_create_projects') ? `
          <button class="btn btn-primary" onclick="WF_Views.openCreateProjectModal()">+ ${WF_I18N.t('create_project')}</button>
        ` : ''}
      </div>

      ${projects.length === 0 ? `
        <div class="card empty-state">
          <div class="empty-state-icon">📁</div>
          <div class="empty-state-title">${WF_I18N.bi('لا توجد مشاريع حتى الآن', 'No projects created yet')}</div>
          <p>${WF_I18N.bi('ابدأ بإنشاء أول مشروع لشركتك وتوزيع المهام على الفريق.', 'Create your first project to organize tasks and track team progress.')}</p>
          ${WF.hasPerm('can_create_projects') ? `<button class="btn btn-primary" style="margin-top:12px;" onclick="WF_Views.openCreateProjectModal()">+ ${WF_I18N.t('create_project')}</button>` : ''}
        </div>
      ` : `
        <div class="grid-3">
          ${projects.map((p) => `
            <div class="card" style="margin-bottom:0;cursor:pointer;border-top:4px solid ${WF.escapeHtml(p.color || '#2563eb')};" onclick="location.hash='#/projects/${p.id}'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                <div style="font-size:16px;font-weight:700;">${WF.escapeHtml(p.name)}</div>
                ${WF_I18N.projectStatusBadge(p.status)}
              </div>
              <p style="font-size:12.5px;color:var(--text-secondary);min-height:36px;margin-bottom:12px;">${WF.escapeHtml(p.description || '')}</p>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
                ${WF_I18N.priorityBadge(p.priority)}
                ${WF_I18N.healthBadge(p.health)}
                <span class="badge badge-neutral">${WF_I18N.t('vis_' + p.visibility)}</span>
              </div>
              <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span>${WF_I18N.bi('نسبة الإنجاز التلقائية', 'Automated Progress')}</span>
                  <strong>${p.progress_percentage}% (${p.completed_tasks}/${p.total_tasks})</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill ${p.progress_percentage === 100 ? 'success' : ''}" style="width:${p.progress_percentage}%"></div>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border-color);">
                <span>👤 ${WF.escapeHtml(p.manager_name || '—')}</span>
                <span>📅 ${WF.escapeHtml(p.deadline || '—')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.projectDetailTab = 'overview';

WF_Views.renderProjectDetail = async function (container, projectId) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل مساحة عمل المشروع...', 'Loading project workspace...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const data = await WF.api(`/api/projects/${projectId}`);
    const p = data.project;
    const tasks = data.tasks || [];
    const files = data.files || [];
    const activity = data.activity || [];
    const activeTab = this.projectDetailTab || 'overview';

    const canEdit = WF.auth.membership.role === 'owner' || p.manager_user_id === WF.auth.user.id || WF.hasPerm('can_create_projects');

    const tabs = [
      ['overview', `1. ${WF_I18N.bi('نظرة عامة (Overview)', 'Overview')}`],
      ['tasks', `2. ${WF_I18N.bi('المهام (Tasks)', 'Tasks')} (${tasks.length})`],
      ['board', `3. ${WF_I18N.bi('لوحة كانبان (Board)', 'Board')}`],
      ['files', `4. ${WF_I18N.bi('الملفات (Files)', 'Files')} (${files.length})`],
      ['activity', `5. ${WF_I18N.bi('النشاط (Activity)', 'Activity')}`],
      ['reports', `6. ${WF_I18N.bi('التقارير (Reports)', 'Reports')}`]
    ];

    let tabContentHtml = '';
    if (activeTab === 'overview') {
      tabContentHtml = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">${WF_I18N.bi('نسبة الإنجاز التلقائية', 'Progress Percentage')}</span>
            <span class="kpi-value" style="color:var(--primary);">${p.progress_percentage}%</span>
            <span class="kpi-meta">${WF_I18N.bi('المكتملة / إجمالي المهام غير الملغاة', 'Completed / Total Non-Cancelled Tasks')}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">${WF_I18N.bi('إجمالي المهام', 'Total Tasks')}</span>
            <span class="kpi-value">${p.total_tasks}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">${WF_I18N.bi('المهام المكتملة', 'Completed Tasks')}</span>
            <span class="kpi-value" style="color:var(--success);">${p.completed_tasks}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">${WF_I18N.bi('قيد التنفيذ', 'In Progress')}</span>
            <span class="kpi-value">${p.in_progress_tasks}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">${WF_I18N.bi('المهام المتأخرة', 'Overdue Tasks')}</span>
            <span class="kpi-value" style="color:var(--danger);">${p.overdue_tasks}</span>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">${WF_I18N.bi('تفاصيل المشروع والفريق', 'Project Details & Team')}</span></div>
            <p style="margin-bottom:14px;color:var(--text-secondary);">${WF.escapeHtml(p.description || '—')}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:14px;">
              <div><strong>${WF_I18N.bi('مدير المشروع:', 'Project Manager:')}</strong> ${WF.escapeHtml(p.manager_name || '—')}</div>
              <div><strong>${WF_I18N.bi('القسم:', 'Department:')}</strong> ${WF.escapeHtml(p.department_name || '—')}</div>
              <div><strong>${WF_I18N.bi('تاريخ البدء:', 'Start Date:')}</strong> ${WF.escapeHtml(p.start_date || '—')}</div>
              <div><strong>${WF_I18N.bi('الموعد النهائي:', 'Target Completion:')}</strong> ${WF.escapeHtml(p.deadline || '—')}</div>
              <div><strong>${WF_I18N.bi('الخصوصية:', 'Visibility:')}</strong> ${WF_I18N.t('vis_' + p.visibility)}</div>
              <div><strong>${WF_I18N.bi('اعتماد المهام:', 'Task Approval:')}</strong> ${p.require_approval ? WF_I18N.bi('مطلوب اعتماد المدير', 'Required') : WF_I18N.bi('إكمال مباشر', 'Direct')}</div>
            </div>
            <div>
              <strong>${WF_I18N.bi('أعضاء الفريق المشاركون:', 'Team Members:')}</strong>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
                ${(p.members || []).map((m) => `<span class="badge badge-primary">👤 ${WF.escapeHtml(m.full_name)}</span>`).join('') || '—'}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">${WF_I18N.bi('المواعيد النهائية القادمة بالمشروع', 'Upcoming Deadlines in Project')}</span></div>
            ${(data.upcoming_deadlines || []).length === 0 ? `
              <div class="empty-state">${WF_I18N.bi('لا توجد مهام مفتوحة بمواعيد نهائية قادمة.', 'No upcoming open task deadlines.')}</div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${data.upcoming_deadlines.map((t) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-muted);border-radius:var(--radius-sm);cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                    <div>
                      <div style="font-weight:600;">${WF.escapeHtml(t.title)}</div>
                      <div style="font-size:11.5px;color:var(--text-muted);">${WF.escapeHtml(t.assignee_name || '—')}</div>
                    </div>
                    ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    } else if (activeTab === 'tasks') {
      tabContentHtml = this.renderTaskTableHtml(tasks, false);
    } else if (activeTab === 'board') {
      tabContentHtml = this.renderKanbanHtml(tasks);
    } else if (activeTab === 'files') {
      tabContentHtml = `
        <div class="card">
          <div class="card-header"><span class="card-title">📎 ${WF_I18N.bi('ملفات ومرفقات المشروع', 'Project Files & Attachments')}</span></div>
          ${files.length === 0 ? `
            <div class="empty-state">${WF_I18N.bi('لم يتم رفع أي مرفقات في مهام هذا المشروع بعد.', 'No files uploaded to tasks in this project yet.')}</div>
          ` : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${WF_I18N.bi('اسم الملف', 'File Name')}</th>
                    <th>${WF_I18N.bi('المهمة', 'Task')}</th>
                    <th>${WF_I18N.bi('رفع بواسطة', 'Uploaded By')}</th>
                    <th>${WF_I18N.bi('الحجم', 'Size')}</th>
                    <th>${WF_I18N.bi('التاريخ', 'Date')}</th>
                    <th>${WF_I18N.bi('إجراء', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${files.map((f) => `
                    <tr>
                      <td><strong>${WF.escapeHtml(f.original_name)}</strong></td>
                      <td><a href="javascript:void(0)" onclick="WF_Views.openTaskDetailModal('${f.task_id}')">${WF.escapeHtml(f.task_title)}</a></td>
                      <td>${WF.escapeHtml(f.uploaded_by_name)}</td>
                      <td>${WF.formatBytes(f.size_bytes)}</td>
                      <td>${WF.formatDateTime(f.created_at)}</td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="WF_Views.downloadAttachment('${f.id}', '${WF.escapeHtml(f.original_name)}')">⬇️ ${WF_I18N.bi('تحميل آمن', 'Download')}</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
    } else if (activeTab === 'activity') {
      tabContentHtml = `
        <div class="card">
          <div class="card-header"><span class="card-title">🕒 ${WF_I18N.bi('سجل نشاط المشروع', 'Project Activity Timeline')}</span></div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${activity.map((a) => `
              <div style="padding:10px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;">
                <div>
                  <strong>${WF.escapeHtml(a.actor_name || 'System')}</strong> — <span class="badge badge-neutral">${WF.escapeHtml(a.action)}</span>
                </div>
                <span style="font-size:12px;color:var(--text-muted);">${WF.formatDateTime(a.created_at)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else if (activeTab === 'reports') {
      tabContentHtml = `
        <div class="card">
          <div class="card-header"><span class="card-title">📈 ${WF_I18N.bi('تقرير أداء المشروع وطريقة الحساب', 'Project Performance Report')}</span></div>
          <p style="margin-bottom:12px;color:var(--text-secondary);">
            <strong>${WF_I18N.bi('معادلة حساب التقدم:', 'Calculation Formula:')}</strong>
            <code>${WF.escapeHtml(p.progress_formula)}</code> (${p.completed_tasks} / ${p.total_tasks} = ${p.progress_percentage}%)
          </p>
          <div class="grid-2">
            <div>
              <h4 style="margin-bottom:8px;">${WF_I18N.bi('توزيع المهام حسب الحالة', 'Tasks by Status')}</h4>
              <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;">
                <li>✅ ${WF_I18N.t('status_completed')}: <strong>${p.completed_tasks}</strong></li>
                <li>🔄 ${WF_I18N.t('status_in_progress')}: <strong>${p.in_progress_tasks}</strong></li>
                <li>🔎 ${WF_I18N.t('status_in_review')}: <strong>${p.in_review_tasks}</strong></li>
                <li>⛔ ${WF_I18N.t('status_blocked')}: <strong>${p.blocked_tasks}</strong></li>
                <li>⚠️ ${WF_I18N.bi('متأخرة (Overdue):', 'Overdue:')} <strong>${p.overdue_tasks}</strong></li>
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="page-header">
        <div>
          <div style="display:flex;align-items:center;gap:10px;">
            <a href="#/projects" class="btn btn-ghost btn-sm">← ${WF_I18N.bi('المشاريع', 'Projects')}</a>
            <h1 class="page-title">${WF.escapeHtml(p.name)}</h1>
            ${WF_I18N.projectStatusBadge(p.status)}
            ${WF_I18N.healthBadge(p.health)}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${canEdit ? `<button class="btn btn-secondary" onclick="WF_Views.openEditProjectModal('${p.id}')">✏️ ${WF_I18N.bi('تعديل المشروع', 'Edit Project')}</button>` : ''}
          <button class="btn btn-primary" onclick="WF_Views.openCreateTaskModal('${p.id}')">+ ${WF_I18N.t('create_task')}</button>
        </div>
      </div>

      <div class="tabs">
        ${tabs.map(([code, label]) => `
          <button class="tab-btn ${activeTab === code ? 'active' : ''}" onclick="WF_Views.projectDetailTab='${code}';WF_Views.renderProjectDetail(document.getElementById('page-content'), '${p.id}')">
            ${label}
          </button>
        `).join('')}
      </div>

      ${tabContentHtml}
    `;

    if (activeTab === 'board') {
      this.bindKanbanDragAndDrop();
    }
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.openCreateProjectModal = async function () {
  await WF.refreshReferenceData();
  WF.openModal({
    title: `+ ${WF_I18N.t('create_project')}`,
    size: 'lg',
    bodyHtml: `
      <form id="create-project-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('اسم المشروع *', 'Project Name *')}</label>
            <input type="text" class="form-control" name="name" required />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('القسم', 'Department')}</label>
            <select class="form-control" name="department_id">
              <option value="">—</option>
              ${WF.departments.map((d) => `<option value="${d.id}">${WF.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('وصف المشروع', 'Description')}</label>
          <textarea class="form-control" name="description" rows="2"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('مدير المشروع', 'Project Manager')}</label>
            <select class="form-control" name="manager_user_id">
              ${WF.directory.map((u) => `<option value="${u.id}" ${u.id === WF.auth.user.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)} (${u.role})</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الأولوية', 'Priority')}</label>
            <select class="form-control" name="priority">
              <option value="low">${WF_I18N.t('priority_low')}</option>
              <option value="medium" selected>${WF_I18N.t('priority_medium')}</option>
              <option value="high">${WF_I18N.t('priority_high')}</option>
              <option value="urgent">${WF_I18N.t('priority_urgent')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('حالة المشروع', 'Project Status')}</label>
            <select class="form-control" name="status">
              <option value="planning">${WF_I18N.t('proj_planning')}</option>
              <option value="active" selected>${WF_I18N.t('proj_active')}</option>
              <option value="on_hold">${WF_I18N.t('proj_on_hold')}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('تاريخ البدء', 'Start Date')}</label>
            <input type="date" class="form-control" name="start_date" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('تاريخ الانتهاء المستهدف', 'Target Completion Date')}</label>
            <input type="date" class="form-control" name="deadline" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الخصوصية (Visibility)', 'Visibility')}</label>
            <select class="form-control" name="visibility">
              <option value="public">${WF_I18N.t('vis_public')}</option>
              <option value="team">${WF_I18N.t('vis_team')}</option>
              <option value="confidential">${WF_I18N.t('vis_confidential')}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الساعات المقدرة', 'Estimated Hours')}</label>
            <input type="number" class="form-control" name="estimated_hours" value="0" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('لون المشروع', 'Project Color')}</label>
            <input type="color" class="form-control" name="color" value="#1d4ed8" style="height:40px;" />
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitCreateProject()">${WF_I18N.t('save')}</button>
    `
  });
};

WF_Views.submitCreateProject = async function () {
  const form = document.getElementById('create-project-form');
  if (!form) return;
  const fd = new FormData(form);
  try {
    await WF.api('/api/projects', {
      method: 'POST',
      body: Object.fromEntries(fd.entries())
    });
    WF.toast(WF_I18N.bi('تم إنشاء المشروع بنجاح', 'Project created successfully'), 'success');
    WF.closeModal();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openEditProjectModal = async function (projectId) {
  const data = await WF.api(`/api/projects/${projectId}`);
  const p = data.project;
  WF.openModal({
    title: `✏️ ${WF_I18N.bi('تعديل المشروع:', 'Edit Project:')} ${WF.escapeHtml(p.name)}`,
    bodyHtml: `
      <form id="edit-project-form">
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('اسم المشروع', 'Project Name')}</label>
          <input type="text" class="form-control" name="name" value="${WF.escapeHtml(p.name)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('الوصف', 'Description')}</label>
          <textarea class="form-control" name="description" rows="2">${WF.escapeHtml(p.description || '')}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الحالة', 'Status')}</label>
            <select class="form-control" name="status">
              ${['planning', 'active', 'on_hold', 'completed', 'archived'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${WF_I18N.t('proj_' + s)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الأولوية', 'Priority')}</label>
            <select class="form-control" name="priority">
              ${['low', 'medium', 'high', 'urgent'].map((pr) => `<option value="${pr}" ${p.priority === pr ? 'selected' : ''}>${WF_I18N.t('priority_' + pr)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الموعد النهائي', 'Deadline')}</label>
            <input type="date" class="form-control" name="deadline" value="${WF.escapeHtml(p.deadline || '')}" />
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      ${WF.auth.membership.role === 'owner' ? `<button class="btn btn-danger" style="margin-inline-end:auto;" onclick="WF_Views.deleteProject('${p.id}')">🗑️ ${WF_I18N.t('delete')}</button>` : ''}
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitEditProject('${p.id}')">${WF_I18N.t('save')}</button>
    `
  });
};

WF_Views.submitEditProject = async function (projectId, forceOverride = false) {
  const form = document.getElementById('edit-project-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  if (forceOverride) body.force_override = true;

  try {
    await WF.api(`/api/projects/${projectId}`, { method: 'PUT', body });
    WF.toast(WF_I18N.bi('تم تحديث المشروع', 'Project updated'), 'success');
    WF.closeModal();
    WF_App.route();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.requires_override) {
      if (confirm(WF_I18N.bi(`${err.message}\nهل ترغب في تجاوز القاعدة وإغلاق المشروع كمكتمل؟`, `${err.message}\nDo you want to explicitly override and mark completed?`))) {
        return this.submitEditProject(projectId, true);
      }
    } else {
      WF.toast(err.message, 'error');
    }
  }
};

WF_Views.deleteProject = async function (projectId) {
  if (!confirm(WF_I18N.bi('هل أنت متأكد من حذف هذا المشروع وجميع مهامه؟', 'Are you sure you want to delete this project?'))) return;
  try {
    await WF.api(`/api/projects/${projectId}`, { method: 'DELETE' });
    WF.toast(WF_I18N.bi('تم حذف المشروع', 'Project deleted'), 'success');
    WF.closeModal();
    location.hash = '#/projects';
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 5. CREATE TASK & RICH TASK DETAILS COLLABORATION MODAL
// ============================================================================
WF_Views.readFileAsDataURL = function (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

WF_Views.previewCreateTaskImage = function (input) {
  const previewWrap = document.getElementById('create-task-image-preview');
  if (!previewWrap) return;
  if (!input.files || !input.files[0]) {
    previewWrap.style.display = 'none';
    previewWrap.innerHTML = '';
    return;
  }
  const file = input.files[0];
  const url = URL.createObjectURL(file);
  previewWrap.style.display = 'block';
  previewWrap.innerHTML = `
    <div style="margin-top:8px;padding:8px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <img src="${url}" alt="preview" style="width:48px;height:48px;object-fit:contain;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-muted);" />
        <div style="min-width:0;">
          <div style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${WF.escapeHtml(file.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${WF.formatBytes(file.size)}</div>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('create-task-image-input').value='';WF_Views.previewCreateTaskImage(document.getElementById('create-task-image-input'))">✕</button>
    </div>
  `;
};

WF_Views.previewCreateTaskFile = function (input) {
  const previewWrap = document.getElementById('create-task-file-preview');
  if (!previewWrap) return;
  if (!input.files || !input.files[0]) {
    previewWrap.style.display = 'none';
    previewWrap.innerHTML = '';
    return;
  }
  const file = input.files[0];
  previewWrap.style.display = 'block';
  previewWrap.innerHTML = `
    <div style="margin-top:8px;padding:8px 10px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <div style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📎 ${WF.escapeHtml(file.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${WF.formatBytes(file.size)}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('create-task-file-input').value='';WF_Views.previewCreateTaskFile(document.getElementById('create-task-file-input'))">✕</button>
    </div>
  `;
};

WF_Views.openCreateTaskModal = async function (defaultProjectId = '') {
  await WF.refreshReferenceData();
  WF.openModal({
    title: `+ ${WF_I18N.t('create_task')}`,
    size: 'lg',
    bodyHtml: `
      <form id="create-task-form">
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('عنوان المهمة *', 'Task Title *')}</label>
          <input type="text" class="form-control" name="title" required placeholder="${WF_I18N.bi('أدخل عنواناً واضحاً للمهمة...', 'Enter a clear task title...')}" />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('الوصف التفصيلي للمهمة', 'Detailed Description')}</label>
          <textarea class="form-control" name="description" rows="3" placeholder="${WF_I18N.bi('اشرح المطلوب تنفيذه للموظف بالتفصيل...', 'Describe what needs to be done...')}"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المشروع', 'Project')}</label>
            <select class="form-control" name="project_id">
              <option value="">${WF_I18N.bi('بدون مشروع (مهمة عامة/شخصية)', 'No Project (Personal/General)')}</option>
              ${WF.projects.map((p) => `<option value="${p.id}" ${defaultProjectId === p.id ? 'selected' : ''}>${WF.escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('القسم', 'Department')}</label>
            <select class="form-control" name="department_id">
              <option value="">—</option>
              ${WF.departments.map((d) => `<option value="${d.id}">${WF.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الموظف المسؤول (Assignee)', 'Assigned Employee')}</label>
            <select class="form-control" name="assignee_user_id">
              <option value="">—</option>
              ${WF.directory.map((u) => `<option value="${u.id}" ${u.id === WF.auth.user.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)} (${u.role})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الأولوية', 'Priority')}</label>
            <select class="form-control" name="priority">
              <option value="low">${WF_I18N.t('priority_low')}</option>
              <option value="medium" selected>${WF_I18N.t('priority_medium')}</option>
              <option value="high">${WF_I18N.t('priority_high')}</option>
              <option value="urgent">${WF_I18N.t('priority_urgent')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الحالة', 'Status')}</label>
            <select class="form-control" name="status">
              <option value="backlog">${WF_I18N.t('status_backlog')}</option>
              <option value="todo" selected>${WF_I18N.t('status_todo')}</option>
              <option value="in_progress">${WF_I18N.t('status_in_progress')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المدة المقدرة (ساعات)', 'Estimated Duration (Hours)')}</label>
            <input type="number" class="form-control" name="estimated_hours" value="4" min="0" step="0.5" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('تاريخ البدء', 'Start Date')}</label>
            <input type="date" class="form-control" name="start_date" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الموعد النهائي للتسليم (Deadline)', 'Deadline')}</label>
            <input type="date" class="form-control" name="deadline" />
          </div>
        </div>

        <!-- Optional Reference Image & Optional Reference File for Employee -->
        <div class="form-group">
          <label class="form-label">🖼️ ${WF_I18N.bi('إرفاق صورة مرجعية أو ملف عمل للموظف (اختياري)', 'Reference Image / Logo & Work File for Employee (Optional)')}</label>
          <div class="upload-options-grid">
            <div class="upload-drop-card">
              <div style="font-weight:800;font-size:13.5px;margin-bottom:4px;color:var(--primary);">🖼️ ${WF_I18N.bi('صورة مرجعية / لوجو (اختياري)', 'Reference Image / Logo (Optional)')}</div>
              <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
                ${WF_I18N.bi('ارفع صورة لوجو أو نموذج تصميم ليقوم الموظف بمعاينته وتحميله وتنفيذ مثله.', 'Upload a logo or reference image for the employee to preview and download.')}
              </p>
              <input type="file" id="create-task-image-input" class="form-control" style="padding:6px;font-size:12.5px;" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onchange="WF_Views.previewCreateTaskImage(this)" />
              <div id="create-task-image-preview" style="display:none;"></div>
            </div>

            <div class="upload-drop-card">
              <div style="font-weight:800;font-size:13.5px;margin-bottom:4px;color:var(--text-primary);">📎 ${WF_I18N.bi('ملف مرفق للمهمة (اختياري)', 'Task Attachment File (Optional)')}</div>
              <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
                ${WF_I18N.bi('ارفع ملف تفاصيل (PDF, Word, Excel, ZIP, TXT...) ليتمكن الموظف من تنزيله.', 'Attach a document, brief, or archive for the employee to download.')}
              </p>
              <input type="file" id="create-task-file-input" class="form-control" style="padding:6px;font-size:12.5px;" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.zip,.txt,.pptx,.ppt,image/*" onchange="WF_Views.previewCreateTaskFile(this)" />
              <div id="create-task-file-preview" style="display:none;"></div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('قائمة خطوات أولية (سطر لكل خطوة - اختياري)', 'Initial Checklist Items (one per line, optional)')}</label>
          <textarea class="form-control" name="checklist_raw" rows="2" placeholder="${WF_I18N.bi('مثال:\nمراجعة المتطلبات\nتنفيذ التصميم', 'e.g.\nReview requirements\nImplement feature')}"></textarea>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitCreateTask()">${WF_I18N.t('save')}</button>
    `
  });
};

WF_Views.submitCreateTask = async function () {
  const form = document.getElementById('create-task-form');
  if (!form) return;
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  if (body.checklist_raw) {
    body.checklist_items = String(body.checklist_raw)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  try {
    const initialAttachments = [];
    const imgInput = document.getElementById('create-task-image-input');
    if (imgInput && imgInput.files && imgInput.files[0]) {
      const imgFile = imgInput.files[0];
      const base64 = await WF_Views.readFileAsDataURL(imgFile);
      initialAttachments.push({
        filename: imgFile.name,
        mime_type: imgFile.type || 'image/png',
        content_base64: base64
      });
    }

    const docInput = document.getElementById('create-task-file-input');
    if (docInput && docInput.files && docInput.files[0]) {
      const docFile = docInput.files[0];
      const base64 = await WF_Views.readFileAsDataURL(docFile);
      initialAttachments.push({
        filename: docFile.name,
        mime_type: docFile.type || 'application/octet-stream',
        content_base64: base64
      });
    }

    if (initialAttachments.length > 0) {
      body.initial_attachments = initialAttachments;
    }

    await WF.api('/api/tasks', { method: 'POST', body });
    WF.toast(WF_I18N.bi('تم إنشاء المهمة وإرفاق الملفات وإشعار الموظف المسؤول', 'Task created and assignee notified'), 'success');
    WF.closeModal();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openTaskDetailModal = async function (taskId) {
  try {
    await WF.refreshReferenceData();
    const data = await WF.api(`/api/tasks/${taskId}`);
    const t = data.task;
    const subtasks = data.subtasks || [];
    const checklist = data.checklist_items || [];
    const comments = data.comments || [];
    const attachments = data.attachments || [];
    const reviews = data.reviews || [];
    const timeEntries = data.time_entries || [];
    const activity = data.activity || [];
    const runningTimer = timeEntries.find((te) => te.user_id === WF.auth.user.id && te.is_running === 1);

    WF.openModal({
      title: `📌 ${WF.escapeHtml(t.title)}`,
      size: 'lg',
      bodyHtml: `
        <!-- Top Status & Workflow Bar -->
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:12px;background:var(--bg-muted);border-radius:var(--radius-sm);margin-bottom:16px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${WF_I18N.statusBadge(t.status)}
            ${WF_I18N.priorityBadge(t.priority)}
            ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${t.can_modify && t.status !== 'in_review' && t.status !== 'completed' ? `
              <button class="btn btn-success btn-sm" onclick="WF_Views.reviewActionFromModal('${t.id}', 'submit')">📤 ${WF_I18N.t('submit_for_review')}</button>
            ` : ''}
            ${t.can_approve && t.status === 'in_review' ? `
              <button class="btn btn-success btn-sm" onclick="WF_Views.reviewActionFromModal('${t.id}', 'approve')">✅ ${WF_I18N.t('approve_task')}</button>
              <button class="btn btn-warning btn-sm" onclick="WF_Views.reviewActionFromModal('${t.id}', 'request_changes')">↩️ ${WF_I18N.t('request_changes')}</button>
            ` : ''}
            ${t.can_approve && t.status === 'completed' ? `
              <button class="btn btn-secondary btn-sm" onclick="WF_Views.reviewActionFromModal('${t.id}', 'reopen')">🔄 ${WF_I18N.t('reopen_task')}</button>
            ` : ''}
          </div>
        </div>

        <div class="grid-2">
          <!-- Left Column: Core Fields & Update Form -->
          <div>
            <form id="update-task-detail-form">
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('عنوان المهمة', 'Task Title')}</label>
                <input type="text" class="form-control" name="title" value="${WF.escapeHtml(t.title)}" ${!t.can_modify ? 'disabled' : ''} />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('الوصف', 'Description')}</label>
                <textarea class="form-control" name="description" rows="3" ${!t.can_modify ? 'disabled' : ''}>${WF.escapeHtml(t.description || '')}</textarea>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('الحالة', 'Status')}</label>
                  <select class="form-control" name="status" ${!t.can_modify ? 'disabled' : ''}>
                    ${['backlog', 'todo', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled'].map((s) => `
                      <option value="${s}" ${t.status === s ? 'selected' : ''}>${WF_I18N.t('status_' + s)}</option>
                    `).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('الأولوية', 'Priority')}</label>
                  <select class="form-control" name="priority" ${!t.can_modify ? 'disabled' : ''}>
                    ${['low', 'medium', 'high', 'urgent'].map((pr) => `
                      <option value="${pr}" ${t.priority === pr ? 'selected' : ''}>${WF_I18N.t('priority_' + pr)}</option>
                    `).join('')}
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('الموظف المسؤول', 'Assignee')}</label>
                  <select class="form-control" name="assignee_user_id" ${(WF.auth.membership.role === 'employee' && !WF.hasPerm('can_assign_tasks')) ? 'disabled' : ''}>
                    <option value="">—</option>
                    ${WF.directory.map((u) => `<option value="${u.id}" ${t.assignee_user_id === u.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('نسبة الإنجاز (%)', 'Progress (%)')}</label>
                  <input type="number" class="form-control" name="progress" min="0" max="100" value="${t.progress}" ${!t.can_modify ? 'disabled' : ''} />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('الموعد النهائي', 'Deadline')}</label>
                  <input type="date" class="form-control" name="deadline" value="${WF.escapeHtml(t.deadline || '')}" ${(WF.auth.membership.role === 'employee' && !WF.hasPerm('can_assign_tasks')) ? 'disabled' : ''} />
                </div>
                <div class="form-group">
                  <label class="form-label">${WF_I18N.bi('السبب عند التوقف (Blocker)', 'Blocker Reason')}</label>
                  <input type="text" class="form-control" name="blocker_reason" value="${WF.escapeHtml(t.blocker_reason || '')}" placeholder="${WF_I18N.bi('اذكر سبب التوقف إن وجد...', 'Optional blocker reason...')}" />
                </div>
              </div>
              ${t.can_modify ? `
                <button type="button" class="btn btn-primary btn-sm" onclick="WF_Views.saveTaskDetailForm('${t.id}')">💾 ${WF_I18N.bi('حفظ التغييرات', 'Save Task Changes')}</button>
              ` : ''}
            </form>

            <!-- Deadline Extension Request Box -->
            <div style="margin-top:16px;padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;">⏳ ${WF_I18N.bi('طلب تمديد الموعد النهائي أو استيضاح', 'Deadline Extension / Clarification Request')}</div>
              ${t.extension_status === 'pending' ? `
                <div style="background:var(--warning-soft);padding:8px;border-radius:var(--radius-sm);font-size:12.5px;margin-bottom:8px;">
                  ${WF_I18N.bi('طلب تمديد معلق إلى:', 'Pending extension to:')} <strong>${WF.escapeHtml(t.extension_requested_date)}</strong> — ${WF.escapeHtml(t.extension_reason)}
                  ${(WF.auth.membership.role === 'owner' || WF.auth.membership.role === 'manager') ? `
                    <div style="margin-top:6px;display:flex;gap:6px;">
                      <button class="btn btn-success btn-sm" onclick="WF_Views.decideExtension('${t.id}', 'approved')">${WF_I18N.bi('موافقة على التمديد', 'Approve Extension')}</button>
                      <button class="btn btn-danger btn-sm" onclick="WF_Views.decideExtension('${t.id}', 'rejected')">${WF_I18N.bi('رفض', 'Reject')}</button>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <input type="date" id="ext-date-input" class="form-control" style="width:150px;padding:5px 8px;" value="${WF.escapeHtml(t.extension_requested_date || '')}" />
                <input type="text" id="ext-reason-input" class="form-control" style="flex:1;padding:5px 8px;" placeholder="${WF_I18N.bi('سبب طلب التمديد أو الاستفسار...', 'Reason for extension or clarification...')}" />
                <button class="btn btn-secondary btn-sm" onclick="WF_Views.requestTaskExtension('${t.id}')">${WF_I18N.bi('إرسال الطلب', 'Send Request')}</button>
              </div>
            </div>

            <!-- Time Tracking Box -->
            <div style="margin-top:16px;padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-weight:700;font-size:13px;">⏱️ ${WF_I18N.bi('تتبع الوقت (Time Tracking)', 'Time Tracking')}</span>
                <span style="font-size:12px;color:var(--text-secondary);">
                  ${WF_I18N.bi('المقدر:', 'Est:')} <strong>${t.estimated_hours}h</strong> | ${WF_I18N.bi('الفعلي:', 'Actual:')} <strong>${t.actual_hours}h</strong>
                </span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                ${runningTimer ? `
                  <button class="btn btn-danger btn-sm" onclick="WF_Views.stopTaskTimer('${t.id}')">⏹️ ${WF_I18N.bi('إيقاف المؤقت الجاري', 'Stop Active Timer')}</button>
                ` : `
                  <button class="btn btn-primary btn-sm" onclick="WF_Views.startTaskTimer('${t.id}')">▶️ ${WF_I18N.bi('بدء مؤقت العمل', 'Start Timer')}</button>
                `}
                <input type="number" id="manual-mins-input" class="form-control" style="width:95px;padding:4px 8px;" placeholder="${WF_I18N.bi('دقائق', 'Minutes')}" min="1" />
                <input type="text" id="manual-desc-input" class="form-control" style="flex:1;padding:4px 8px;" placeholder="${WF_I18N.bi('وصف العمل المنجز...', 'Work description...')}" />
                <button class="btn btn-secondary btn-sm" onclick="WF_Views.addManualTime('${t.id}')">+ ${WF_I18N.bi('تسجيل يدوي', 'Log Time')}</button>
              </div>
              ${timeEntries.length > 0 ? `
                <div style="max-height:100px;overflow-y:auto;font-size:12px;">
                  ${timeEntries.map((te) => `
                    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color);">
                      <span>${WF.escapeHtml(te.user_name)}: ${WF.escapeHtml(te.description || '—')}</span>
                      <strong>${te.is_running ? '🟢 Running' : `${te.duration_minutes} min`}</strong>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Right Column: Checklists, Subtasks, Dependencies, Attachments, Comments -->
          <div>
            <!-- Checklist & Subtasks -->
            <div style="padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);margin-bottom:12px;">
              <div style="font-weight:700;font-size:13px;margin-bottom:8px;">☑️ ${WF_I18N.bi('قائمة الخطوات والمهام الفرعية', 'Checklist & Subtasks')} (${t.checklist_completed}/${t.checklist_total})</div>
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
                ${checklist.map((item) => `
                  <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
                    <input type="checkbox" ${item.is_completed ? 'checked' : ''} onchange="WF_Views.toggleChecklistItem('${t.id}', '${item.id}', this.checked)" />
                    <span style="${item.is_completed ? 'text-decoration:line-through;color:var(--text-muted);' : ''}">${WF.escapeHtml(item.title)}</span>
                  </label>
                `).join('')}
              </div>
              <div style="display:flex;gap:6px;">
                <input type="text" id="new-checklist-title" class="form-control" style="padding:5px 8px;" placeholder="${WF_I18N.bi('أضف خطوة جديدة للقائمة...', 'Add checklist step...')}" />
                <button class="btn btn-secondary btn-sm" onclick="WF_Views.addChecklistItem('${t.id}')">+</button>
              </div>
            </div>

            <!-- Dependencies -->
            <div style="padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);margin-bottom:12px;">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;">🔗 ${WF_I18N.bi('الاعتماديات (Task Dependencies)', 'Task Dependencies')}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                ${(t.dependencies || []).map((d) => `
                  <span class="badge ${d.status === 'completed' ? 'badge-success' : 'badge-warning'}">
                    ${WF.escapeHtml(d.title)} (${d.status})
                    <a href="javascript:void(0)" style="color:inherit;margin-inline-start:4px;" onclick="WF_Views.removeDependency('${t.id}', '${d.id}')">✕</a>
                  </span>
                `).join('') || `<span style="font-size:12px;color:var(--text-muted);">${WF_I18N.bi('لا توجد مهام سابقة مشروطة.', 'No prerequisite tasks.')}</span>`}
              </div>
              <div style="display:flex;gap:6px;">
                <input type="text" id="dep-task-id-input" class="form-control" style="padding:5px 8px;" placeholder="${WF_I18N.bi('معرف المهمة السابقة (Task ID)...', 'Prerequisite Task ID...')}" />
                <button class="btn btn-secondary btn-sm" onclick="WF_Views.addDependency('${t.id}')">+ ${WF_I18N.bi('ربط', 'Link')}</button>
              </div>
            </div>

            <!-- Reference Images & File Attachments -->
            <div style="padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);margin-bottom:12px;">
              <div style="font-weight:700;font-size:13.5px;margin-bottom:8px;">🖼️ ${WF_I18N.bi('الصور المرجعية والملفات المرفقة (Attachments)', 'Reference Images & File Attachments')} (${attachments.length})</div>
              ${attachments.length === 0 ? `
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
                  ${WF_I18N.bi('لا توجد صور أو ملفات مرفقة بهذه المهمة حتى الآن.', 'No reference images or files attached yet.')}
                </div>
              ` : `
                <div style="margin-bottom:10px;">
                  ${WF_Views.renderTaskAttachmentsBlock(attachments, false)}
                </div>
              `}
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <input type="file" id="task-file-input" class="form-control" style="padding:5px;flex:1;min-width:180px;font-size:12.5px;" accept="image/*,.pdf,.docx,.doc,.xlsx,.xls,.csv,.zip,.txt,.pptx,.ppt" />
                <button class="btn btn-primary btn-sm" onclick="WF_Views.uploadTaskAttachment('${t.id}')">⬆️ ${WF_I18N.bi('رفع صورة أو ملف', 'Upload Image / File')}</button>
              </div>
            </div>

            <!-- Comments & @Mentions -->
            <div style="padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);">
              <div style="font-weight:700;font-size:13px;margin-bottom:8px;">💬 ${WF_I18N.bi('التعليقات والنقاش (@mentions)', 'Comments & Discussion')} (${comments.length})</div>
              <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
                ${comments.map((c) => `
                  <div style="padding:8px 10px;background:var(--bg-muted);border-radius:var(--radius-sm);font-size:12.5px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                      <strong>${WF.escapeHtml(c.author_name)}</strong>
                      <span style="font-size:11px;color:var(--text-muted);">${WF.formatDateTime(c.created_at)} ${c.is_edited ? `(${WF_I18N.bi('معدل', 'Edited')})` : ''}</span>
                    </div>
                    <div>${WF.escapeHtml(c.content)}</div>
                  </div>
                `).join('')}
              </div>
              <div style="display:flex;gap:6px;">
                <input type="text" id="new-comment-input" class="form-control" placeholder="${WF_I18N.bi('أضف تعليقاً أو أشر لموظف بـ @email...', 'Write a comment or @mention...')}" />
                <button class="btn btn-primary btn-sm" onclick="WF_Views.postTaskComment('${t.id}')">${WF_I18N.bi('إرسال', 'Send')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity & Review History Timeline -->
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">🕒 ${WF_I18N.bi('سجل المراجعات والتغييرات على المهمة', 'Task Review & Activity Timeline')}</div>
          <div style="max-height:130px;overflow-y:auto;font-size:12px;display:flex;flex-direction:column;gap:4px;">
            ${activity.map((a) => `
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color);">
                <span><strong>${WF.escapeHtml(a.actor_name || 'System')}</strong>: ${WF.escapeHtml(a.action)}</span>
                <span style="color:var(--text-muted);">${WF.formatDateTime(a.created_at)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `,
      footerHtml: `
        ${WF.hasPerm('can_delete_tasks') ? `<button class="btn btn-danger btn-sm" style="margin-inline-end:auto;" onclick="WF_Views.deleteTask('${t.id}')">🗑️ ${WF_I18N.t('delete')}</button>` : ''}
        <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('close')}</button>
      `
    });
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.saveTaskDetailForm = async function (taskId, forceSubtasks = false) {
  const form = document.getElementById('update-task-detail-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  if (forceSubtasks) body.force_complete_subtasks = true;

  try {
    await WF.api(`/api/tasks/${taskId}`, { method: 'PUT', body });
    WF.toast(WF_I18N.bi('تم حفظ تغييرات المهمة', 'Task updated'), 'success');
    await this.openTaskDetailModal(taskId);
    WF_App.route();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.requires_confirmation) {
      if (confirm(WF_I18N.bi(`${err.message}\nهل تريد المتابعة رغم وجود خطوات غير مكتملة؟`, `${err.message}\nProceed anyway?`))) {
        return this.saveTaskDetailForm(taskId, true);
      }
    } else {
      WF.toast(err.message, 'error');
    }
  }
};

WF_Views.reviewActionFromModal = async function (taskId, action) {
  let feedback = '';
  if (action === 'request_changes') {
    feedback = prompt(WF_I18N.bi('أدخل ملاحظات المراجعة والتعديلات المطلوبة للموظف:', 'Enter review feedback and requested changes:')) || '';
    if (!feedback) return;
  } else if (action === 'approve') {
    feedback = prompt(WF_I18N.bi('ملاحظة الاعتماد (اختياري):', 'Approval feedback (optional):'), WF_I18N.bi('عمل ممتاز، تم الاعتماد.', 'Great work, approved.')) || '';
  }

  try {
    await WF.api(`/api/tasks/${taskId}/review`, {
      method: 'POST',
      body: { action, feedback }
    });
    WF.toast(WF_I18N.bi('تم تحديث قرار المراجعة بنجاح', 'Review decision saved'), 'success');
    await this.openTaskDetailModal(taskId);
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.requestTaskExtension = async function (taskId) {
  const extDate = document.getElementById('ext-date-input').value;
  const extReason = document.getElementById('ext-reason-input').value;
  if (!extDate) return WF.toast(WF_I18N.bi('حدد التاريخ الجديد المطلوب', 'Select requested date'), 'warning');
  try {
    await WF.api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: { extension_requested_date: extDate, extension_reason: extReason }
    });
    WF.toast(WF_I18N.bi('تم إرسال طلب تمديد الموعد للمدير', 'Extension request sent to manager'), 'success');
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.decideExtension = async function (taskId, decision) {
  try {
    await WF.api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: { extension_decision: decision }
    });
    WF.toast(WF_I18N.bi('تم تحديث قرار التمديد', 'Extension decision updated'), 'success');
    await this.openTaskDetailModal(taskId);
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.addChecklistItem = async function (taskId) {
  const input = document.getElementById('new-checklist-title');
  const title = input ? input.value.trim() : '';
  if (!title) return;
  try {
    await WF.api(`/api/tasks/${taskId}/checklist`, { method: 'POST', body: { title } });
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.toggleChecklistItem = async function (taskId, itemId, isCompleted) {
  try {
    await WF.api(`/api/tasks/${taskId}/checklist/${itemId}`, {
      method: 'PUT',
      body: { is_completed: isCompleted }
    });
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.addDependency = async function (taskId) {
  const depId = document.getElementById('dep-task-id-input').value.trim();
  if (!depId) return;
  try {
    await WF.api(`/api/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: { depends_on_task_id: depId }
    });
    WF.toast(WF_I18N.bi('تمت إضافة الاعتمادية', 'Dependency linked'), 'success');
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.removeDependency = async function (taskId, depId) {
  try {
    await WF.api(`/api/tasks/${taskId}/dependencies/${depId}`, { method: 'DELETE' });
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.postTaskComment = async function (taskId) {
  const input = document.getElementById('new-comment-input');
  const content = input ? input.value.trim() : '';
  if (!content) return;
  try {
    await WF.api(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: { content }
    });
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.uploadTaskAttachment = async function (taskId) {
  const fileInput = document.getElementById('task-file-input');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    return WF.toast(WF_I18N.bi('يرجى اختيار ملف أولاً', 'Please choose a file first'), 'warning');
  }
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await WF.api(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: {
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          content_base64: reader.result
        }
      });
      WF.toast(WF_I18N.bi('تم رفع الملف بنجاح', 'File uploaded successfully'), 'success');
      await WF_Views.openTaskDetailModal(taskId);
      WF_App.route();
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
};

WF_Views.downloadAttachment = async function (attachmentId, filename) {
  try {
    const res = await fetch(`/api/attachments/${attachmentId}/download`, {
      headers: WF.token ? { 'Authorization': `Bearer ${WF.token}` } : {}
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Download failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.startTaskTimer = async function (taskId) {
  try {
    await WF.api(`/api/tasks/${taskId}/time/start`, { method: 'POST', body: {} });
    WF.toast(WF_I18N.bi('تم بدء مؤقت العمل', 'Timer started'), 'success');
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.stopTaskTimer = async function (taskId) {
  try {
    await WF.api(`/api/tasks/${taskId}/time/stop`, { method: 'POST', body: {} });
    WF.toast(WF_I18N.bi('تم إيقاف المؤقت وحساب الساعات', 'Timer stopped'), 'success');
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.addManualTime = async function (taskId) {
  const mins = Number(document.getElementById('manual-mins-input').value || 0);
  const desc = document.getElementById('manual-desc-input').value.trim();
  if (mins <= 0) return WF.toast(WF_I18N.bi('أدخل عدد الدقائق', 'Enter duration in minutes'), 'warning');
  try {
    await WF.api(`/api/tasks/${taskId}/time/manual`, {
      method: 'POST',
      body: { duration_minutes: mins, description: desc }
    });
    WF.toast(WF_I18N.bi('تم تسجيل الوقت بنجاح', 'Time entry recorded'), 'success');
    await this.openTaskDetailModal(taskId);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.deleteTask = async function (taskId) {
  if (!confirm(WF_I18N.bi('هل أنت متأكد من حذف هذه المهمة؟', 'Are you sure you want to delete this task?'))) return;
  try {
    await WF.api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    WF.toast(WF_I18N.bi('تم حذف المهمة', 'Task deleted'), 'success');
    WF.closeModal();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};
