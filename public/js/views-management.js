window.WF_Views = window.WF_Views || {};

// ============================================================================
// 1. EMPLOYEES MANAGEMENT (MANUAL CREATE, INVITE BY EMAIL, PERMISSIONS, PROFILE)
// ============================================================================
WF_Views.renderEmployees = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل بيانات الموظفين...', 'Loading employees...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const res = await WF.api('/api/employees');
    const employees = res.employees || [];
    const invitations = res.invitations || [];
    const canManage =
      WF.auth.membership.role === 'owner' ||
      WF.auth.membership.role === 'manager' ||
      WF.hasPerm('can_manage_employees');

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title" style="display:inline-flex;align-items:center;gap:10px;">
            <span style="color:var(--primary);display:inline-flex;">${WF.icon('users', 24)}</span>
            <span>${WF_I18N.t('nav_employees')}</span>
          </h1>
          <p class="page-subtitle">${WF_I18N.bi('إنشاء حسابات الموظفين (إيميل وباسورد تابعين للشركة)، متابعة السجل، التعديل، التحكم في حالة الحساب، أو الحذف.', 'Create employee accounts under your company, view history, edit details, toggle active status, or delete.')}</p>
        </div>
        ${canManage ? `
          <div class="emp-actions-bar">
            <button class="btn btn-secondary" onclick="WF_Views.openInviteEmployeeModal()">
              ${WF.icon('mail', 16)}
              <span>${WF_I18N.t('invite_employee')}</span>
            </button>
            <button class="btn btn-primary" onclick="WF_Views.openCreateEmployeeModal()">
              ${WF.icon('user-plus', 16)}
              <span>${WF_I18N.bi('إضافة موظف جديد', 'Add Employee')}</span>
            </button>
          </div>
        ` : ''}
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>${WF_I18N.bi('الموظف', 'Employee')}</th>
                <th>${WF_I18N.bi('البريد الإلكتروني', 'Email')}</th>
                <th>${WF_I18N.bi('القسم', 'Department')}</th>
                <th>${WF_I18N.bi('الدور', 'Role')}</th>
                <th>${WF_I18N.bi('المهام', 'Tasks')}</th>
                <th>${WF_I18N.bi('الحالة والتحكم', 'Status & Actions')}</th>
              </tr>
            </thead>
            <tbody>
              ${employees.map((e) => {
                const isActive = e.status === 'active';
                const canChangeStatus = canManage && e.role !== 'owner';
                const canDelete = canManage && e.role !== 'owner' && e.user_id !== WF.auth.user.id;
                return `
                  <tr>
                    <td style="white-space:nowrap;">
                      <div class="emp-row-inline">
                        ${WF.renderAvatar(e.full_name, e.avatar_url)}
                        <span style="font-weight:800;font-size:14.5px;color:var(--text-primary);">${WF.escapeHtml(e.full_name)}</span>
                        ${e.job_title ? `<span class="badge badge-neutral">${WF.escapeHtml(e.job_title)}</span>` : ''}
                      </div>
                    </td>
                    <td style="font-weight:600;direction:ltr;text-align:start;white-space:nowrap;">${WF.escapeHtml(e.email)}</td>
                    <td style="white-space:nowrap;font-weight:600;color:var(--text-secondary);">${WF.escapeHtml(e.department_name || '—')}</td>
                    <td style="white-space:nowrap;">${WF_I18N.roleBadge(e.role)}</td>
                    <td style="white-space:nowrap;">
                      <div class="emp-actions-bar">
                        <span class="badge badge-primary">${e.open_tasks_count} ${WF_I18N.bi('مفتوحة', 'open')}</span>
                        ${e.overdue_tasks_count > 0 ? `<span class="badge badge-danger">${e.overdue_tasks_count} ${WF_I18N.bi('متأخرة', 'overdue')}</span>` : ''}
                      </div>
                    </td>
                    <td style="white-space:nowrap;">
                      <div class="emp-actions-bar">
                        <button
                          type="button"
                          class="status-toggle-btn ${isActive ? 'is-active' : 'is-inactive'}"
                          ${canChangeStatus ? `onclick="WF_Views.toggleEmployeeStatus('${e.user_id}', '${isActive ? 'inactive' : 'active'}')"` : 'disabled'}
                          title="${canChangeStatus ? WF_I18N.bi('اضغط للتحويل بين نشط وغير نشط', 'Click to toggle Active / Inactive') : ''}"
                        >
                          ${isActive ? WF.icon('toggle-on', 16) : WF.icon('toggle-off', 16)}
                          <span>${isActive ? WF_I18N.bi('نشط', 'Active') : WF_I18N.bi('غير نشط', 'Inactive')}</span>
                        </button>

                        ${isActive && e.user_id !== WF.auth.user.id ? `
                          <button type="button" class="btn-action-chip" onclick="WF_App.quickSwitchUser('${e.user_id}')" title="${WF_I18N.bi('الدخول بحساب هذا الشخص لتجربة صلاحياته', 'Login as this user')}">
                            ${WF.icon('user', 15)}
                            <span>${WF_I18N.bi('دخول', 'Login')}</span>
                          </button>
                        ` : ''}

                        <button type="button" class="btn-action-chip" onclick="WF_Views.openEmployeeHistoryModal('${e.user_id}')">
                          ${WF.icon('history', 15)}
                          <span>${WF_I18N.bi('السجل', 'History')}</span>
                        </button>

                        ${canManage ? `
                          <button type="button" class="btn-action-chip" onclick="WF_Views.openEditEmployeeModal('${e.user_id}')">
                            ${WF.icon('edit', 15)}
                            <span>${WF_I18N.bi('تعديل', 'Edit')}</span>
                          </button>
                        ` : ''}

                        ${canDelete ? `
                          <button type="button" class="btn-action-chip danger" onclick="WF_Views.confirmDeleteEmployee('${e.user_id}', '${WF.escapeHtml(e.full_name)}')">
                            ${WF.icon('trash', 15)}
                            <span>${WF_I18N.bi('حذف', 'Delete')}</span>
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${invitations.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title" style="display:inline-flex;align-items:center;gap:8px;">
              ${WF.icon('mail', 17)}
              <span>${WF_I18N.bi('الدعوات المرسلة (Invitations)', 'Sent Invitations')}</span>
            </span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${WF_I18N.bi('الاسم', 'Name')}</th>
                  <th>${WF_I18N.bi('البريد', 'Email')}</th>
                  <th>${WF_I18N.bi('الدور', 'Role')}</th>
                  <th>${WF_I18N.bi('الحالة', 'Status')}</th>
                  <th>${WF_I18N.bi('رابط الدعوة التجريبي', 'Invitation Link')}</th>
                </tr>
              </thead>
              <tbody>
                ${invitations.map((inv) => `
                  <tr>
                    <td>${WF.escapeHtml(inv.full_name)}</td>
                    <td>${WF.escapeHtml(inv.email)}</td>
                    <td>${WF_I18N.roleBadge(inv.role)}</td>
                    <td><span class="badge ${inv.status === 'pending' ? 'badge-warning' : 'badge-success'}">${inv.status}</span></td>
                    <td>
                      ${inv.status === 'pending' ? `<code style="font-size:11.5px;">#/accept-invite?token=${inv.token}</code>` : '—'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.confirmDeleteEmployee = function (userId, fullName) {
  WF.openModal({
    title: `<span style="display:inline-flex;align-items:center;gap:8px;color:var(--danger);">${WF.icon('trash', 18)} <span>${WF_I18N.bi('تأكيد حذف الموظف', 'Confirm Delete Employee')}</span></span>`,
    bodyHtml: `
      <div style="font-size:14.5px;line-height:1.7;color:var(--text-primary);">
        ${WF_I18N.bi('هل أنت متأكد من حذف حساب الموظف:', 'Are you sure you want to delete employee:')}
        <strong style="color:var(--danger);">${WF.escapeHtml(fullName)}</strong> ؟
        <div style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">
          ${WF_I18N.bi('سيتم إزالة حسابه من الشركة وفصل أي مهام مسندة إليه دون حذف مشاريع الشركة.', 'Their account will be removed from the company workspace while keeping company projects intact.')}
        </div>
      </div>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-danger" onclick="WF_Views.executeDeleteEmployee('${userId}')">
        ${WF.icon('trash', 15)}
        <span>${WF_I18N.bi('نعم، حذف الموظف', 'Yes, Delete Employee')}</span>
      </button>
    `
  });
};

WF_Views.executeDeleteEmployee = async function (userId) {
  try {
    await WF.api(`/api/employees/${userId}`, { method: 'DELETE' });
    WF.toast(WF_I18N.bi('تم حذف حساب الموظف من الشركة بنجاح', 'Employee deleted successfully'), 'success');
    WF.closeModal();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openCreateEmployeeModal = function () {
  const companyName = (WF.auth && WF.auth.company && WF.auth.company.name) || '';
  WF.openModal({
    title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('user-plus', 18)} <span>${WF_I18N.bi('إنشاء حساب موظف جديد تابع للشركة', 'Create Employee Account')}</span></span>`,
    size: 'lg',
    bodyHtml: `
      <div style="padding:12px 14px;background:var(--primary-soft);border-inline-start:4px solid var(--primary);border-radius:var(--radius-sm);margin-bottom:16px;font-size:13px;color:var(--text-primary);">
        <strong style="display:inline-flex;align-items:center;gap:6px;">${WF.icon('building', 15)} <span>${WF_I18N.bi('إضافة موظف إلى شركة:', 'Adding employee to company:')} ${WF.escapeHtml(companyName)}</span></strong><br/>
        <span style="color:var(--text-secondary);">
          ${WF_I18N.bi('حدد الإيميل والباسورد للموظف هنا ليسجل الدخول بهما مباشرة، ويمكنه بعد الدخول تعديل اسمه وصورته الشخصية من حسابه.', 'Set the employee email and password here so they can log in directly, and they can update their own name and profile photo anytime.')}
        </span>
      </div>
      <form id="create-emp-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('اسم الموظف الكامل *', 'Employee Full Name *')}</label>
            <input type="text" class="form-control" name="full_name" required placeholder="${WF_I18N.bi('مثال: محمد أحمد', 'e.g. Mohamed Ahmed')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('البريد الإلكتروني (لتسجيل الدخول) *', 'Login Email Address *')}</label>
            <input type="email" class="form-control" name="email" style="direction:ltr;text-align:start;" required placeholder="employee@company.com" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('كلمة المرور (لتسجيل الدخول - 6 أحرف على الأقل) *', 'Login Password (min 6 chars) *')}</label>
            <input type="text" class="form-control" name="password" minlength="6" style="direction:ltr;text-align:start;" required placeholder="${WF_I18N.bi('اكتب الباسورد الذي سيسجل به الموظف...', 'Enter password for employee login...')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المسمى الوظيفي', 'Job Title')}</label>
            <input type="text" class="form-control" name="job_title" placeholder="${WF_I18N.bi('مثال: مصمم جرافيك، مطور ويب...', 'e.g. Designer, Developer...')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الدور الوظيفي', 'Role')}</label>
            <select class="form-control" name="role">
              <option value="employee" selected>${WF_I18N.t('role_employee')}</option>
              <option value="manager">${WF_I18N.t('role_manager')}</option>
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
            <label class="form-label">${WF_I18N.bi('المدير المباشر', 'Assigned Manager')}</label>
            <select class="form-control" name="manager_user_id">
              <option value="">—</option>
              ${WF.directory.map((u) => `<option value="${u.id}" ${u.id === WF.auth.user.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)}</option>`).join('')}
            </select>
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitCreateEmployee()">
        ${WF.icon('check', 15)}
        <span>${WF_I18N.bi('إنشاء حساب الموظف', 'Create Employee Account')}</span>
      </button>
    `
  });
};

WF_Views.submitCreateEmployee = async function () {
  const form = document.getElementById('create-emp-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await WF.api('/api/employees', { method: 'POST', body });
    WF.toast(WF_I18N.bi('تم إنشاء حساب الموظف وربطه بالشركة بنجاح! يمكنه تسجيل الدخول الآن.', 'Employee account created and linked to your company!'), 'success');
    WF.closeModal();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openInviteEmployeeModal = function () {
  WF.openModal({
    title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('mail', 18)} <span>${WF_I18N.bi('دعوة موظف عبر البريد الإلكتروني', 'Invite Employee by Email')}</span></span>`,
    bodyHtml: `
      <form id="invite-emp-form">
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('الاسم الكامل للموظف *', 'Employee Full Name *')}</label>
          <input type="text" class="form-control" name="full_name" required />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('البريد الإلكتروني *', 'Email Address *')}</label>
          <input type="email" class="form-control" name="email" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الدور', 'Role')}</label>
            <select class="form-control" name="role">
              <option value="employee">${WF_I18N.t('role_employee')}</option>
              <option value="manager">${WF_I18N.t('role_manager')}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('القسم', 'Department')}</label>
            <select class="form-control" name="department_id">
              <option value="">—</option>
              ${WF.departments.map((d) => `<option value="${d.id}">${WF.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      </form>
      <div id="invite-result-box"></div>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('close')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitInviteEmployee()">
        ${WF.icon('mail', 15)}
        <span>${WF_I18N.bi('إرسال الدعوة', 'Send Invitation')}</span>
      </button>
    `
  });
};

WF_Views.submitInviteEmployee = async function () {
  const form = document.getElementById('invite-emp-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await WF.api('/api/employees/invite', { method: 'POST', body });
    WF.toast(WF_I18N.bi('تم توليد دعوة الموظف بنجاح', 'Invitation created'), 'success');
    const box = document.getElementById('invite-result-box');
    if (box && res.dev_invite_url) {
      box.innerHTML = `
        <div style="margin-top:12px;padding:12px;background:var(--info-soft);border-radius:var(--radius-sm);font-size:12.5px;">
          <strong>${WF.escapeHtml(res.dev_mode_notice)}</strong>
          <div style="margin-top:6px;word-break:break-all;">
            <code>${WF.escapeHtml(res.dev_invite_url)}</code>
          </div>
        </div>
      `;
    }
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openEditEmployeeModal = async function (userId) {
  const data = await WF.api(`/api/employees/${userId}`);
  const e = data.employee;
  const p = e.permissions || {};

  const permKeys = [
    ['can_create_projects', WF_I18N.bi('إنشاء المشاريع', 'Can create projects')],
    ['can_create_tasks', WF_I18N.bi('إنشاء المهام', 'Can create tasks')],
    ['can_assign_tasks', WF_I18N.bi('إسناد المهام', 'Can assign tasks')],
    ['can_delete_tasks', WF_I18N.bi('حذف المهام', 'Can delete tasks')],
    ['can_approve_work', WF_I18N.bi('اعتماد الأعمال المكتملة', 'Can approve completed work')],
    ['can_view_team_reports', WF_I18N.bi('عرض تقارير الفريق', 'Can view team reports')],
    ['can_manage_employees', WF_I18N.bi('إدارة الموظفين', 'Can manage employees')]
  ];

  WF.openModal({
    title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('edit', 18)} <span>${WF_I18N.bi('تعديل بيانات الموظف والصلاحيات:', 'Edit Employee & Permissions:')} ${WF.escapeHtml(e.full_name)}</span></span>`,
    size: 'lg',
    bodyHtml: `
      <form id="edit-emp-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الاسم الكامل', 'Full Name')}</label>
            <input type="text" class="form-control" name="full_name" value="${WF.escapeHtml(e.full_name)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('البريد الإلكتروني (تسجيل الدخول)', 'Login Email')}</label>
            <input type="email" class="form-control" name="email" style="direction:ltr;text-align:start;" value="${WF.escapeHtml(e.email || '')}" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('كلمة مرور جديدة للموظف (اتركها فارغة لعدم التغيير)', 'New Password (leave blank to keep current)')}</label>
            <input type="text" class="form-control" name="new_password" minlength="6" style="direction:ltr;text-align:start;" placeholder="${WF_I18N.bi('أدخل كلمة مرور جديدة إذا أردت تغييرها...', 'Optional new password...')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المسمى الوظيفي', 'Job Title')}</label>
            <input type="text" class="form-control" name="job_title" value="${WF.escapeHtml(e.job_title || '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('القسم', 'Department')}</label>
            <select class="form-control" name="department_id">
              <option value="">—</option>
              ${WF.departments.map((d) => `<option value="${d.id}" ${e.department_id === d.id ? 'selected' : ''}>${WF.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('المدير المباشر', 'Manager')}</label>
            <select class="form-control" name="manager_user_id">
              <option value="">—</option>
              ${WF.directory.map((u) => `<option value="${u.id}" ${e.manager_user_id === u.id ? 'selected' : ''}>${WF.escapeHtml(u.full_name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الدور', 'Role')}</label>
            <select class="form-control" name="role" ${e.role === 'owner' ? 'disabled' : ''}>
              <option value="employee" ${e.role === 'employee' ? 'selected' : ''}>${WF_I18N.t('role_employee')}</option>
              <option value="manager" ${e.role === 'manager' ? 'selected' : ''}>${WF_I18N.t('role_manager')}</option>
              ${e.role === 'owner' ? `<option value="owner" selected>${WF_I18N.t('role_owner')}</option>` : ''}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('حالة الحساب (نشط / غير نشط)', 'Account Status')}</label>
            <select class="form-control" name="status" ${e.role === 'owner' ? 'disabled' : ''}>
              <option value="active" ${e.status === 'active' ? 'selected' : ''}>${WF_I18N.bi('نشط (Active)', 'Active')}</option>
              <option value="inactive" ${e.status === 'inactive' ? 'selected' : ''}>${WF_I18N.bi('غير نشط (Inactive)', 'Inactive')}</option>
            </select>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border-color);margin:14px 0;" />
        <h4 style="margin-bottom:10px;display:inline-flex;align-items:center;gap:6px;">
          ${WF.icon('shield', 16)}
          <span>${WF_I18N.bi('الصلاحيات المخصصة للموظف', 'Custom Permissions')}</span>
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
          ${permKeys.map(([code, label]) => `
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-color);border-radius:var(--radius-sm);cursor:pointer;">
              <input type="checkbox" class="emp-perm-cb" data-perm="${code}" ${p[code] ? 'checked' : ''} ${e.role === 'owner' ? 'disabled' : ''} />
              <span>${label}</span>
            </label>
          `).join('')}
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitEditEmployee('${e.user_id}')">
        ${WF.icon('save', 15)}
        <span>${WF_I18N.t('save')}</span>
      </button>
    `
  });
};

WF_Views.submitEditEmployee = async function (userId) {
  const form = document.getElementById('edit-emp-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  const permissions = {};
  document.querySelectorAll('.emp-perm-cb').forEach((cb) => {
    permissions[cb.getAttribute('data-perm')] = cb.checked;
  });
  body.permissions = permissions;

  try {
    await WF.api(`/api/employees/${userId}`, { method: 'PUT', body });
    WF.toast(WF_I18N.bi('تم تحديث بيانات الموظف بنجاح', 'Employee updated successfully'), 'success');
    WF.closeModal();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.toggleEmployeeStatus = async function (userId, newStatus) {
  try {
    await WF.api(`/api/employees/${userId}`, {
      method: 'PUT',
      body: { status: newStatus }
    });
    WF.toast(
      newStatus === 'inactive'
        ? WF_I18N.bi('تم تحويل حالة الموظف إلى (غير نشط) وإيقاف دخوله مع حفظ سجله الكامل', 'Employee set to Inactive; historical records preserved')
        : WF_I18N.bi('تم تحويل حالة الموظف إلى (نشط) بنجاح', 'Employee set to Active'),
      'success'
    );
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.openEmployeeHistoryModal = async function (userId) {
  try {
    const data = await WF.api(`/api/employees/${userId}`);
    const e = data.employee;
    const s = data.summary;
    const tasks = data.tasks || [];
    const activity = data.activity || [];

    WF.openModal({
      title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('history', 18)} <span>${WF_I18N.bi('سجل الموظف والمهام والنشاط:', 'Employee History & Activity Log:')} ${WF.escapeHtml(e.full_name)}</span></span>`,
      size: 'lg',
      bodyHtml: `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:nowrap;padding:12px 16px;background:var(--bg-muted);border-radius:var(--radius-md);margin-bottom:16px;">
          <div class="emp-row-inline">
            ${WF.renderAvatar(e.full_name, e.avatar_url)}
            <div>
              <div style="font-weight:800;font-size:15px;">${WF.escapeHtml(e.full_name)}</div>
              <div style="font-size:12px;color:var(--text-secondary);">${WF.escapeHtml(e.email)} • ${WF.escapeHtml(e.job_title || e.role)}</div>
            </div>
          </div>
          <div class="emp-actions-bar">
            <span class="status-toggle-btn ${e.status === 'active' ? 'is-active' : 'is-inactive'}" style="cursor:default;">
              ${e.status === 'active' ? WF.icon('toggle-on', 15) : WF.icon('toggle-off', 15)}
              <span>${e.status === 'active' ? WF_I18N.bi('نشط', 'Active') : WF_I18N.bi('غير نشط', 'Inactive')}</span>
            </span>
            <button class="btn-action-chip" onclick="WF.closeModal();WF_Views.openEditEmployeeModal('${e.user_id}')">
              ${WF.icon('edit', 14)}
              <span>${WF_I18N.bi('تعديل الموظف', 'Edit Employee')}</span>
            </button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('إجمالي المهام', 'Assigned')}</span><span class="kpi-value">${s.total_assigned}</span></div>
          <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('المكتملة', 'Completed')}</span><span class="kpi-value" style="color:var(--success);">${s.completed_count}</span></div>
          <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('المتأخرة', 'Overdue')}</span><span class="kpi-value" style="color:var(--danger);">${s.overdue_count}</span></div>
          <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('معدل الإنجاز', 'Completion Rate')}</span><span class="kpi-value">${s.completion_rate}%</span></div>
        </div>

        <h4 style="margin-bottom:10px;display:inline-flex;align-items:center;gap:6px;">
          ${WF.icon('tasks', 16)}
          <span>${WF_I18N.bi('سجل مهام الموظف', 'Employee Task History')} (${tasks.length})</span>
        </h4>
        <div class="table-responsive" style="margin-bottom:18px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>${WF_I18N.bi('المهمة', 'Task')}</th>
                <th>${WF_I18N.bi('المشروع', 'Project')}</th>
                <th>${WF_I18N.bi('الحالة', 'Status')}</th>
                <th>${WF_I18N.bi('نسبة الإنجاز', 'Progress')}</th>
                <th>${WF_I18N.bi('الموعد النهائي', 'Deadline')}</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length === 0 ? `
                <tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px;">${WF_I18N.bi('لا توجد مهام مسندة لهذا الموظف بعد.', 'No tasks assigned yet.')}</td></tr>
              ` : tasks.map((t) => `
                <tr style="cursor:pointer;" onclick="WF.closeModal();WF_Views.openTaskDetailModal('${t.id}')">
                  <td><strong>${WF.escapeHtml(t.title)}</strong></td>
                  <td>${WF.escapeHtml(t.project_name || '—')}</td>
                  <td>${WF_I18N.statusBadge(t.status)}</td>
                  <td><strong>${t.progress}%</strong></td>
                  <td>${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <h4 style="margin-bottom:10px;display:inline-flex;align-items:center;gap:6px;">
          ${WF.icon('history', 16)}
          <span>${WF_I18N.bi('سجل حركات ونشاط الموظف (Activity Log)', 'Employee Activity Log')} (${activity.length})</span>
        </h4>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px;">
          ${activity.length === 0 ? `
            <div style="text-align:center;color:var(--text-muted);padding:14px;">${WF_I18N.bi('لا يوجد سجل حركات بعد.', 'No activity recorded yet.')}</div>
          ` : activity.map((a) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 8px;border-bottom:1px solid var(--border-color);font-size:12.5px;">
              <div>
                <strong>${WF.escapeHtml(a.actor_name || e.full_name)}</strong>:
                <span class="badge badge-neutral" style="margin-inline-start:6px;">${WF.escapeHtml(a.action)}</span>
              </div>
              <span style="color:var(--text-muted);font-size:11.5px;">${WF.formatDateTime(a.created_at)}</span>
            </div>
          `).join('')}
        </div>
      `,
      footerHtml: `<button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('close')}</button>`
    });
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 2. DEPARTMENTS & TEAMS MANAGEMENT
// ============================================================================
WF_Views.renderDepartments = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل الأقسام...', 'Loading departments...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const res = await WF.api('/api/departments');
    const departments = res.departments || [];
    const canManage = WF.auth.membership.role === 'owner' || WF.hasPerm('can_manage_departments');

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.t('nav_departments')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('تنظيم هيكل الشركة، تعيين مدراء الأقسام، وحماية الأقسام النشطة من الحذف العرضي.', 'Organize company departments, assign department heads, and safely manage team members.')}</p>
        </div>
        ${canManage ? `<button class="btn btn-primary" onclick="WF_Views.openCreateDepartmentModal()">+ ${WF_I18N.t('create_department')}</button>` : ''}
      </div>

      ${departments.length === 0 ? `
        <div class="card empty-state">
          <div class="empty-state-icon">🏢</div>
          <div class="empty-state-title">${WF_I18N.bi('لم يتم إنشاء أقسام بعد', 'No departments configured yet')}</div>
          ${canManage ? `<button class="btn btn-primary" style="margin-top:10px;" onclick="WF_Views.openCreateDepartmentModal()">+ ${WF_I18N.t('create_department')}</button>` : ''}
        </div>
      ` : `
        <div class="grid-3">
          ${departments.map((d) => `
            <div class="card" style="margin-bottom:0;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <h3 style="font-size:16px;font-weight:700;">🏢 ${WF.escapeHtml(d.name)}</h3>
                <span class="badge ${d.status === 'active' ? 'badge-success' : 'badge-neutral'}">${d.status}</span>
              </div>
              <p style="font-size:12.5px;color:var(--text-secondary);min-height:36px;margin-bottom:10px;">${WF.escapeHtml(d.description || '')}</p>
              <div style="font-size:12.5px;margin-bottom:10px;">
                <div><strong>${WF_I18N.bi('مدير القسم:', 'Department Manager:')}</strong> ${WF.escapeHtml(d.manager_name || '—')}</div>
                <div><strong>${WF_I18N.bi('عدد الأعضاء:', 'Members:')}</strong> ${d.member_count} | <strong>${WF_I18N.bi('المشاريع النشطة:', 'Active Projects:')}</strong> ${d.active_projects_count}</div>
              </div>
              ${canManage ? `
                <div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid var(--border-color);">
                  <button class="btn btn-secondary btn-sm" onclick="WF_Views.deleteDepartmentFlow('${d.id}', '${WF.escapeHtml(d.name)}')">🗑️ ${WF_I18N.t('delete')}</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.openCreateDepartmentModal = async function () {
  await WF.refreshReferenceData();
  WF.openModal({
    title: `+ ${WF_I18N.t('create_department')}`,
    bodyHtml: `
      <form id="create-dept-form">
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('اسم القسم *', 'Department Name *')}</label>
          <input type="text" class="form-control" name="name" required placeholder="${WF_I18N.bi('مثال: التسويق، المبيعات، تطوير البرمجيات...', 'e.g. Marketing, Sales, Development...')}" />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('الوصف', 'Description')}</label>
          <textarea class="form-control" name="description" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('مدير القسم', 'Department Manager')}</label>
          <select class="form-control" name="manager_user_id">
            <option value="">—</option>
            ${WF.directory.map((u) => `<option value="${u.id}">${WF.escapeHtml(u.full_name)}</option>`).join('')}
          </select>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitCreateDepartment()">${WF_I18N.t('save')}</button>
    `
  });
};

WF_Views.submitCreateDepartment = async function () {
  const form = document.getElementById('create-dept-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await WF.api('/api/departments', { method: 'POST', body });
    WF.toast(WF_I18N.bi('تم إنشاء القسم بنجاح', 'Department created'), 'success');
    WF.closeModal();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.deleteDepartmentFlow = async function (deptId, deptName) {
  try {
    await WF.api(`/api/departments/${deptId}`, { method: 'DELETE' });
    WF.toast(WF_I18N.bi('تم حذف القسم', 'Department deleted'), 'success');
    WF_App.route();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.requires_reassignment) {
      const otherDepts = WF.departments.filter((d) => d.id !== deptId);
      WF.openModal({
        title: `⚠️ ${WF_I18N.bi('نقل الموظفين والمشاريع قبل حذف القسم', 'Safe Department Reassignment')}`,
        bodyHtml: `
          <p style="margin-bottom:12px;">${WF.escapeHtml(err.message)}</p>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('اختر القسم البديل لنقل الموظفين والمشاريع إليه:', 'Select target department for reassignment:')}</label>
            <select id="reassign-dept-select" class="form-control">
              ${otherDepts.map((d) => `<option value="${d.id}">${WF.escapeHtml(d.name)}</option>`).join('')}
            </select>
          </div>
        `,
        footerHtml: `
          <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
          <button class="btn btn-danger" onclick="WF_Views.confirmReassignDeleteDept('${deptId}')">${WF_I18N.bi('نقل وحذف القسم', 'Reassign & Delete')}</button>
        `
      });
    } else {
      WF.toast(err.message, 'error');
    }
  }
};

WF_Views.confirmReassignDeleteDept = async function (deptId) {
  const target = document.getElementById('reassign-dept-select').value;
  if (!target) return;
  try {
    await WF.api(`/api/departments/${deptId}?reassign_to=${encodeURIComponent(target)}`, { method: 'DELETE' });
    WF.toast(WF_I18N.bi('تم نقل الموظفين والمشاريع وحذف القسم بأمان', 'Reassigned and deleted department safely'), 'success');
    WF.closeModal();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 3. CALENDAR & TIMELINE (GANTT-STYLE) VIEWS
// ============================================================================
WF_Views.calendarMode = 'month'; // 'month', 'agenda', 'timeline'

WF_Views.renderCalendar = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل التقويم والجدول الزمني...', 'Loading calendar & timeline...')}</div>`;
  try {
    const [tasksRes, projRes] = await Promise.all([
      WF.api('/api/tasks'),
      WF.api('/api/projects')
    ]);
    const tasks = (tasksRes.tasks || []).filter((t) => t.deadline || t.start_date);
    const projects = projRes.projects || [];
    const mode = this.calendarMode;

    let bodyHtml = '';
    if (mode === 'timeline') {
      bodyHtml = `
        <div class="card">
          <div class="card-header"><span class="card-title">📊 ${WF_I18N.bi('المخطط الزمني للمهام والاعتماديات (Timeline / Gantt View)', 'Project Timeline & Dependencies View')}</span></div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${WF_I18N.bi('المهمة', 'Task')}</th>
                  <th>${WF_I18N.bi('المشروع', 'Project')}</th>
                  <th>${WF_I18N.bi('من (Start)', 'Start')}</th>
                  <th>${WF_I18N.bi('إلى (Deadline)', 'Deadline')}</th>
                  <th>${WF_I18N.bi('الاعتماديات', 'Dependencies')}</th>
                  <th>${WF_I18N.bi('شريط التقدم الزمني', 'Timeline Bar')}</th>
                </tr>
              </thead>
              <tbody>
                ${tasks.map((t) => `
                  <tr style="cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                    <td><strong>${WF.escapeHtml(t.title)}</strong></td>
                    <td>${WF.escapeHtml(t.project_name || '—')}</td>
                    <td>${WF.escapeHtml(t.start_date || '—')}</td>
                    <td>${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}</td>
                    <td>
                      ${(t.dependencies || []).map((d) => `<span class="badge badge-neutral">🔗 ${WF.escapeHtml(d.title)}</span>`).join(' ') || '—'}
                    </td>
                    <td style="min-width:180px;">
                      <div class="progress-track" style="height:12px;">
                        <div class="progress-fill ${t.is_overdue ? 'danger' : (t.status === 'completed' ? 'success' : '')}" style="width:${Math.max(15, t.progress)}%"></div>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      // Agenda & Upcoming Calendar Grid
      const sorted = [...tasks].sort((a, b) => String(a.deadline || a.start_date).localeCompare(String(b.deadline || b.start_date)));
      bodyHtml = `
        <div class="grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">📅 ${WF_I18N.bi('مواعيد تسليم المهام (Task Deadlines)', 'Task Deadlines')}</span></div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${sorted.map((t) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                  <div>
                    <div style="font-weight:700;">${WF.escapeHtml(t.title)}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${WF.escapeHtml(t.project_name || '')} • ${WF.escapeHtml(t.assignee_name || '')}</div>
                  </div>
                  ${WF_I18N.deadlineBadge(t.deadline_info, t.deadline)}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">🏁 ${WF_I18N.bi('مواعيد بدء وتسليم المشاريع (Project Milestones)', 'Project Start & Target Dates')}</span></div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${projects.map((p) => `
                <div style="padding:10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);cursor:pointer;" onclick="location.hash='#/projects/${p.id}'">
                  <div style="display:flex;justify-content:space-between;">
                    <strong>${WF.escapeHtml(p.name)}</strong>
                    ${WF_I18N.projectStatusBadge(p.status)}
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
                    ${WF_I18N.bi('البدء:', 'Start:')} ${WF.escapeHtml(p.start_date || '—')} | ${WF_I18N.bi('التسليم المستهدف:', 'Deadline:')} ${WF.escapeHtml(p.deadline || '—')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.t('nav_calendar')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('عرض المواعيد النهائية للمهام والمشاريع والمخطط الزمني حسب المنطقة الزمنية للشركة.', 'View task deadlines, project milestones, and dependency timeline in company timezone.')}</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn ${mode !== 'timeline' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="WF_Views.calendarMode='month';WF_Views.renderCalendar(document.getElementById('page-content'))">📅 ${WF_I18N.bi('التقويم والأجندة', 'Calendar & Agenda')}</button>
          <button class="btn ${mode === 'timeline' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="WF_Views.calendarMode='timeline';WF_Views.renderCalendar(document.getElementById('page-content'))">📊 ${WF_I18N.bi('المخطط الزمني (Timeline / Gantt)', 'Timeline / Gantt')}</button>
        </div>
      </div>
      ${bodyHtml}
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

// ============================================================================
// 4. DAILY AND WEEKLY WORK REPORTS
// ============================================================================
WF_Views.renderDailyReports = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل التقارير اليومية والأسبوعية...', 'Loading daily & weekly reports...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const res = await WF.api('/api/daily-reports');
    const reports = res.reports || [];
    const ws = res.weekly_summary || {};

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.t('nav_daily_reports')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('تحديثات العمل اليومية للموظفين وملخص الفريق الأسبوعي الفعلي.', 'Daily employee work updates and real data-driven weekly team summary.')}</p>
        </div>
        <button class="btn btn-primary" onclick="WF_Views.openSubmitDailyReportModal()">+ ${WF_I18N.bi('إرسال تقرير عمل يومي', 'Submit Daily Update')}</button>
      </div>

      <!-- Weekly Team Summary -->
      <div class="card" style="border-inline-start:4px solid var(--primary);">
        <div class="card-header">
          <span class="card-title">📋 ${WF_I18N.bi('ملخص الفريق الأسبوعي (Weekly Team Summary)', 'Weekly Team Summary')} (${ws.period_start || ''} → ${ws.period_end || ''})</span>
          <span class="badge badge-primary">${ws.reports_submitted_count || 0} ${WF_I18N.bi('تقارير مرسلة', 'reports')}</span>
        </div>
        <div class="grid-3">
          <div>
            <h4 style="margin-bottom:6px;color:var(--success);">✅ ${WF_I18N.bi('أبرز ما تم إنجازه', 'Completed Work')}</h4>
            <ul style="padding-inline-start:18px;font-size:12.5px;">
              ${(ws.completed_highlights || []).slice(0, 5).map((item) => `<li><strong>${WF.escapeHtml(item.employee_name)}:</strong> ${WF.escapeHtml(item.completed_work)}</li>`).join('') || `<li>${WF_I18N.bi('لا توجد بيانات مسجلة بعد', 'No recorded entries')}</li>`}
            </ul>
          </div>
          <div>
            <h4 style="margin-bottom:6px;color:var(--primary);">🔄 ${WF_I18N.bi('الأولويات الجارية', 'Current Priorities')}</h4>
            <ul style="padding-inline-start:18px;font-size:12.5px;">
              ${(ws.active_priorities || []).slice(0, 5).map((item) => `<li><strong>${WF.escapeHtml(item.employee_name)}:</strong> ${WF.escapeHtml(item.current_work)}</li>`).join('') || `<li>—</li>`}
            </ul>
          </div>
          <div>
            <h4 style="margin-bottom:6px;color:var(--danger);">⛔ ${WF_I18N.bi('العوائق المبلّغ عنها (Blockers)', 'Reported Blockers')}</h4>
            <ul style="padding-inline-start:18px;font-size:12.5px;">
              ${(ws.reported_blockers || []).map((item) => `<li><strong>${WF.escapeHtml(item.employee_name)}:</strong> ${WF.escapeHtml(item.blockers)}</li>`).join('') || `<li>${WF_I18N.bi('لا توجد عوائق مسجلة', 'No blockers reported')}</li>`}
            </ul>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        ${reports.length === 0 ? `
          <div class="card empty-state">
            <div class="empty-state-title">${WF_I18N.bi('لم يتم إرسال تقارير يومية بعد', 'No daily work reports submitted yet')}</div>
          </div>
        ` : reports.map((r) => `
          <div class="card" style="margin-bottom:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div>
                <strong>👤 ${WF.escapeHtml(r.employee_name)}</strong>
                <span class="badge badge-neutral">${WF.escapeHtml(r.department_name || '')}</span>
              </div>
              <span class="badge badge-primary">📅 ${WF.escapeHtml(r.report_date)}</span>
            </div>
            <div class="grid-2" style="gap:10px;font-size:13px;">
              <div><strong>✅ ${WF_I18N.bi('ما أنجزته:', 'Completed:')}</strong> ${WF.escapeHtml(r.completed_work)}</div>
              <div><strong>🔄 ${WF_I18N.bi('أعمل حالياً على:', 'Currently working on:')}</strong> ${WF.escapeHtml(r.current_work)}</div>
              ${r.blockers ? `<div style="color:var(--danger);"><strong>⛔ ${WF_I18N.bi('العوائق:', 'Blockers:')}</strong> ${WF.escapeHtml(r.blockers)}</div>` : ''}
              ${r.next_plan ? `<div><strong>⏭️ ${WF_I18N.bi('الخطة القادمة:', 'Next plan:')}</strong> ${WF.escapeHtml(r.next_plan)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.openSubmitDailyReportModal = function () {
  WF.openModal({
    title: `📝 ${WF_I18N.bi('إرسال التقرير اليومي للعمل', 'Submit Daily Work Report')}`,
    bodyHtml: `
      <form id="daily-report-form">
        <div class="form-group">
          <label class="form-label">✅ ${WF_I18N.bi('ماذا أنجزت اليوم؟ *', 'What I completed *')}</label>
          <textarea class="form-control" name="completed_work" rows="2" required></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">🔄 ${WF_I18N.bi('ما الذي أعمل عليه حالياً؟ *', 'What I am currently working on *')}</label>
          <textarea class="form-control" name="current_work" rows="2" required></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">⛔ ${WF_I18N.bi('هل يوجد أي عائق (Blocker)؟', 'What is blocked (optional)')}</label>
          <textarea class="form-control" name="blockers" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">⏭️ ${WF_I18N.bi('ما الذي أخطط للعمل عليه تالياً؟', 'What I plan to work on next')}</label>
          <textarea class="form-control" name="next_plan" rows="2"></textarea>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.submitDailyReport()">${WF_I18N.t('save')}</button>
    `
  });
};

WF_Views.submitDailyReport = async function () {
  const form = document.getElementById('daily-report-form');
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await WF.api('/api/daily-reports', { method: 'POST', body });
    WF.toast(WF_I18N.bi('تم حفظ وإرسال تقرير العمل اليومي', 'Daily report submitted'), 'success');
    WF.closeModal();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 5. PRODUCTIVITY & PERFORMANCE REPORTS + CSV/EXCEL EXPORT
// ============================================================================
WF_Views.reportsState = {
  period: 'all',
  department_id: '',
  project_id: ''
};

WF_Views.renderReports = async function (container) {
  const st = this.reportsState;
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري حساب تقارير الأداء والإنتاجية من قاعدة البيانات...', 'Calculating reports from database...')}</div>`;
  try {
    await WF.refreshReferenceData();
    const params = new URLSearchParams({ period: st.period });
    if (st.department_id) params.set('department_id', st.department_id);
    if (st.project_id) params.set('project_id', st.project_id);

    const data = await WF.api(`/api/reports/analytics?${params.toString()}`);
    const cr = data.company_report;
    const empReports = data.employee_reports || [];
    const projReports = data.project_reports || [];
    const deptReports = data.department_reports || [];
    const canExport = WF.auth.membership.role === 'owner' || WF.auth.membership.role === 'manager' || WF.hasPerm('can_view_team_reports');

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${WF_I18N.t('nav_reports')}</h1>
          <p class="page-subtitle">${WF.escapeHtml(data.methodology_note)}</p>
        </div>
        ${canExport ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="WF_Views.downloadReportExport('csv', 'tasks')">⬇️ ${WF_I18N.t('export_csv')} (${WF_I18N.bi('المهام', 'Tasks')})</button>
            <button class="btn btn-secondary" onclick="WF_Views.downloadReportExport('excel', 'tasks')">📊 ${WF_I18N.t('export_excel')} (${WF_I18N.bi('المهام', 'Tasks')})</button>
            <button class="btn btn-secondary" onclick="WF_Views.downloadReportExport('csv', 'employees')">⬇️ ${WF_I18N.t('export_csv')} (${WF_I18N.bi('الموظفون', 'Employees')})</button>
          </div>
        ` : ''}
      </div>

      <div class="filter-bar">
        <select class="form-control" onchange="WF_Views.reportsState.period=this.value;WF_Views.renderReports(document.getElementById('page-content'))">
          <option value="all" ${st.period === 'all' ? 'selected' : ''}>${WF_I18N.bi('كل الفترات', 'All Time')}</option>
          <option value="this_week" ${st.period === 'this_week' ? 'selected' : ''}>${WF_I18N.bi('هذا الأسبوع', 'This Week')}</option>
          <option value="last_week" ${st.period === 'last_week' ? 'selected' : ''}>${WF_I18N.bi('الأسبوع الماضي', 'Last Week')}</option>
          <option value="this_month" ${st.period === 'this_month' ? 'selected' : ''}>${WF_I18N.bi('هذا الشهر', 'This Month')}</option>
          <option value="last_month" ${st.period === 'last_month' ? 'selected' : ''}>${WF_I18N.bi('الشهر الماضي', 'Last Month')}</option>
        </select>
        <select class="form-control" onchange="WF_Views.reportsState.department_id=this.value;WF_Views.renderReports(document.getElementById('page-content'))">
          <option value="">${WF_I18N.bi('كل الأقسام', 'All Departments')}</option>
          ${WF.departments.map((d) => `<option value="${d.id}" ${st.department_id === d.id ? 'selected' : ''}>${WF.escapeHtml(d.name)}</option>`).join('')}
        </select>
        <select class="form-control" onchange="WF_Views.reportsState.project_id=this.value;WF_Views.renderReports(document.getElementById('page-content'))">
          <option value="">${WF_I18N.bi('كل المشاريع', 'All Projects')}</option>
          ${WF.projects.map((p) => `<option value="${p.id}" ${st.project_id === p.id ? 'selected' : ''}>${WF.escapeHtml(p.name)}</option>`).join('')}
        </select>
        <span style="margin-inline-start:auto;font-size:12px;color:var(--text-muted);">
          📐 <code>${WF.escapeHtml(data.formula_explanation)}</code>
        </span>
      </div>

      <!-- 1. Company Summary KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('المهام القابلة للتطبيق (بدون الملغاة)', 'Applicable Tasks')}</span><span class="kpi-value">${cr.applicable_tasks}</span><span class="kpi-meta">${WF_I18N.bi('الملغاة المستبعدة:', 'Excluded cancelled:')} ${cr.cancelled_tasks}</span></div>
        <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('المهام المكتملة', 'Completed Tasks')}</span><span class="kpi-value" style="color:var(--success);">${cr.completed_tasks}</span></div>
        <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('معدل الإنجاز (Completion Rate)', 'Completion Rate')}</span><span class="kpi-value" style="color:var(--primary);">${cr.completion_rate}%</span></div>
        <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('المهام المتأخرة', 'Overdue Tasks')}</span><span class="kpi-value" style="color:var(--danger);">${cr.overdue_tasks}</span></div>
        <div class="kpi-card"><span class="kpi-label">${WF_I18N.bi('بانتظار المراجعة', 'Awaiting Review')}</span><span class="kpi-value" style="color:var(--purple);">${cr.awaiting_review_tasks}</span></div>
      </div>

      <!-- 2. Employee Performance Report -->
      <div class="card">
        <div class="card-header"><span class="card-title">👥 ${WF_I18N.bi('تقرير أداء الموظفين وحجم العمل', 'Employee Workload & Completion Report')}</span></div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>${WF_I18N.bi('الموظف', 'Employee')}</th>
                <th>${WF_I18N.bi('القسم', 'Department')}</th>
                <th>${WF_I18N.bi('المسندة', 'Assigned')}</th>
                <th>${WF_I18N.bi('المكتملة', 'Completed')}</th>
                <th>${WF_I18N.bi('في الموعد', 'On Time')}</th>
                <th>${WF_I18N.bi('قيد التنفيذ', 'In Progress')}</th>
                <th>${WF_I18N.bi('للمراجعة', 'In Review')}</th>
                <th>${WF_I18N.bi('متأخرة', 'Overdue')}</th>
                <th>${WF_I18N.bi('متوقفة', 'Blocked')}</th>
                <th>${WF_I18N.bi('معدل الإنجاز', 'Completion Rate')}</th>
              </tr>
            </thead>
            <tbody>
              ${empReports.map((er) => `
                <tr>
                  <td><strong>${WF.escapeHtml(er.full_name)}</strong></td>
                  <td>${WF.escapeHtml(er.department_name || '—')}</td>
                  <td>${er.tasks_assigned}</td>
                  <td><strong style="color:var(--success);">${er.tasks_completed}</strong></td>
                  <td>${er.tasks_completed_on_time}</td>
                  <td>${er.tasks_in_progress}</td>
                  <td>${er.tasks_awaiting_review}</td>
                  <td>${er.tasks_overdue > 0 ? `<span class="badge badge-danger">${er.tasks_overdue}</span>` : '0'}</td>
                  <td>${er.tasks_blocked}</td>
                  <td><strong>${er.completion_rate}%</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <!-- 3. Project Report -->
        <div class="card">
          <div class="card-header"><span class="card-title">📁 ${WF_I18N.bi('تقرير المشاريع', 'Project Report')}</span></div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${WF_I18N.bi('المشروع', 'Project')}</th>
                  <th>${WF_I18N.bi('المهام', 'Tasks')}</th>
                  <th>${WF_I18N.bi('المكتملة', 'Completed')}</th>
                  <th>${WF_I18N.bi('المتأخرة', 'Overdue')}</th>
                  <th>${WF_I18N.bi('الإنجاز', 'Progress')}</th>
                </tr>
              </thead>
              <tbody>
                ${projReports.map((pr) => `
                  <tr>
                    <td><strong>${WF.escapeHtml(pr.project_name)}</strong></td>
                    <td>${pr.total_tasks}</td>
                    <td>${pr.completed_tasks}</td>
                    <td>${pr.overdue_tasks}</td>
                    <td><strong>${pr.completion_percentage}%</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 4. Department Report -->
        <div class="card">
          <div class="card-header"><span class="card-title">🏢 ${WF_I18N.bi('تقرير الأقسام', 'Department Report')}</span></div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${WF_I18N.bi('القسم', 'Department')}</th>
                  <th>${WF_I18N.bi('المشاريع', 'Projects')}</th>
                  <th>${WF_I18N.bi('المهام', 'Tasks')}</th>
                  <th>${WF_I18N.bi('المكتملة', 'Completed')}</th>
                  <th>${WF_I18N.bi('معدل الإنجاز', 'Rate')}</th>
                </tr>
              </thead>
              <tbody>
                ${deptReports.map((dr) => `
                  <tr>
                    <td><strong>${WF.escapeHtml(dr.department_name)}</strong></td>
                    <td>${dr.projects_count}</td>
                    <td>${dr.total_tasks}</td>
                    <td>${dr.completed_tasks}</td>
                    <td><strong>${dr.completion_rate}%</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.downloadReportExport = async function (format, reportType) {
  const st = this.reportsState;
  const params = new URLSearchParams({
    format,
    report_type: reportType,
    period: st.period
  });
  if (st.department_id) params.set('department_id', st.department_id);
  if (st.project_id) params.set('project_id', st.project_id);

  try {
    const res = await fetch(`/api/reports/export?${params.toString()}`, {
      headers: WF.token ? { 'Authorization': `Bearer ${WF.token}` } : {}
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow_${reportType}_${st.period}.${format === 'excel' ? 'xls' : 'csv'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

// ============================================================================
// 6. NOTIFICATIONS CENTER & AUTOMATIC REMINDERS TRIGGER
// ============================================================================
WF_Views.renderNotifications = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل الإشعارات...', 'Loading notifications...')}</div>`;
  try {
    const res = await WF.api('/api/notifications');
    const list = res.notifications || [];

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">🔔 ${WF_I18N.t('nav_notifications')} (${res.unread_count})</h1>
          <p class="page-subtitle">${WF_I18N.bi('تنبيهات المهام المسندة، المواعيد المقتربة والمتأخرة، الإشارات (@mentions)، وقرارات الاعتماد.', 'Alerts for assignments, deadlines, overdue tasks, @mentions, and review decisions.')}</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="WF_Views.triggerRemindersCheck()">⏰ ${WF_I18N.bi('فحص التذكيرات والمهام المتأخرة الآن', 'Run Deadline & Overdue Check')}</button>
          <button class="btn btn-primary btn-sm" onclick="WF_Views.markAllNotificationsRead()">✓ ${WF_I18N.bi('تحديد الكل كمقروء', 'Mark All as Read')}</button>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        ${list.length === 0 ? `
          <div class="empty-state">${WF_I18N.bi('لا توجد إشعارات حالياً.', 'No notifications yet.')}</div>
        ` : list.map((n) => `
          <div style="padding:14px 18px;border-bottom:1px solid var(--border-color);background:${n.is_read ? 'transparent' : 'var(--primary-soft)'};display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;" onclick="WF_Views.openNotificationTarget('${n.id}', '${WF.escapeHtml(n.link_url || '')}', '${n.entity_type}', '${n.entity_id}')">
            <div>
              <div style="font-weight:700;">${WF.escapeHtml(WF_I18N.lang === 'ar' ? n.title_ar : n.title_en)}</div>
              <div style="font-size:13px;color:var(--text-secondary);">${WF.escapeHtml(WF_I18N.lang === 'ar' ? n.message_ar : n.message_en)}</div>
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">${WF.formatDateTime(n.created_at)}</div>
            </div>
            ${!n.is_read ? `<span class="badge badge-primary">${WF_I18N.bi('جديد', 'New')}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.openNotificationTarget = async function (notifId, linkUrl, entityType, entityId) {
  try {
    await WF.api(`/api/notifications/${notifId}/read`, { method: 'PUT' });
    await WF_App.refreshAuth();
    if (entityType === 'task' && entityId) {
      this.openTaskDetailModal(entityId);
    } else if (linkUrl) {
      location.hash = linkUrl;
    } else {
      WF_App.route();
    }
  } catch (_) {}
};

WF_Views.markAllNotificationsRead = async function () {
  await WF.api('/api/notifications/read-all', { method: 'PUT' });
  await WF_App.refreshAuth();
  WF_App.route();
};

WF_Views.triggerRemindersCheck = async function () {
  const res = await WF.api('/api/reminders/process', { method: 'POST', body: {} });
  WF.toast(WF_I18N.bi(`تم فحص المواعيد وتوليد ${res.generatedCount} تذكيرات جديدة`, `Processed deadlines; ${res.generatedCount} new reminders generated`), 'success');
  await WF_App.refreshAuth();
  WF_App.route();
};

// ============================================================================
// 7. AUDIT LOGS & COMPANY SETTINGS & PROFILE
// ============================================================================
WF_Views.renderAuditLogs = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل سجل التدقيق...', 'Loading audit logs...')}</div>`;
  try {
    const res = await WF.api('/api/audit-logs?limit=150');
    const logs = res.audit_logs || [];

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">🛡️ ${WF_I18N.t('nav_audit_logs')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('سجل تدقيق أمني غير قابل للتعديل أو الحذف لجميع الإجراءات الحساسة في الشركة.', 'Immutable security and activity audit trail for your workspace.')}</p>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>${WF_I18N.bi('الوقت', 'Timestamp')}</th>
                <th>${WF_I18N.bi('المنفذ (Actor)', 'Actor')}</th>
                <th>${WF_I18N.bi('الإجراء (Action)', 'Action')}</th>
                <th>${WF_I18N.bi('الكيان المتأثر', 'Entity')}</th>
                <th>${WF_I18N.bi('القيم السابقة / الجديدة', 'Changes')}</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((l) => `
                <tr>
                  <td style="font-size:12px;white-space:nowrap;">${WF.formatDateTime(l.created_at)}</td>
                  <td><strong>${WF.escapeHtml(l.actor_name || 'System')}</strong></td>
                  <td><span class="badge badge-neutral">${WF.escapeHtml(l.action)}</span></td>
                  <td><code>${WF.escapeHtml(l.entity_type)}:${WF.escapeHtml(l.entity_id)}</code></td>
                  <td style="font-size:11.5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;">
                    <code>${WF.escapeHtml(JSON.stringify(l.new_values || {}))}</code>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.renderSettings = async function (container) {
  container.innerHTML = `<div class="card">${WF_I18N.bi('جاري تحميل إعدادات الشركة...', 'Loading company settings...')}</div>`;
  try {
    const data = await WF.api('/api/company/settings');
    const c = data.company;
    const s = data.settings;
    const u = data.usage;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">⚙️ ${WF_I18N.t('nav_settings')}</h1>
          <p class="page-subtitle">${WF_I18N.bi('تخصيص ملف الشركة، سير الاعتمادات، تتبع الوقت، التذكيرات، المنطقة الزمنية، والاشتراك.', 'Configure company profile, approval rules, time tracking, reminders, localization, and subscription.')}</p>
        </div>
      </div>

      <form id="company-settings-form" onsubmit="event.preventDefault();WF_Views.saveCompanySettings()">
        <div class="grid-2">
          <!-- Company Profile & Localization -->
          <div class="card">
            <div class="card-header"><span class="card-title">🏢 ${WF_I18N.bi('ملف الشركة والتوطين (Profile & Localization)', 'Company Profile & Localization')}</span></div>
            <div class="form-group">
              <label class="form-label">${WF_I18N.bi('اسم الشركة', 'Company Name')}</label>
              <input type="text" class="form-control" name="company_name" value="${WF.escapeHtml(c.name)}" required />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('المجال / الصناعة', 'Industry')}</label>
                <input type="text" class="form-control" name="industry" value="${WF.escapeHtml(c.industry || '')}" />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('المنطقة الزمنية (Timezone)', 'Company Timezone')}</label>
                <select class="form-control" name="timezone">
                  ${['Asia/Riyadh', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Amman', 'Europe/London', 'UTC'].map((tz) => `
                    <option value="${tz}" ${s.timezone === tz ? 'selected' : ''}>${tz}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('بداية الأسبوع', 'Week Start Day')}</label>
                <select class="form-control" name="week_start_day">
                  <option value="sunday" ${s.week_start_day === 'sunday' ? 'selected' : ''}>Sunday (الأحد)</option>
                  <option value="saturday" ${s.week_start_day === 'saturday' ? 'selected' : ''}>Saturday (السبت)</option>
                  <option value="monday" ${s.week_start_day === 'monday' ? 'selected' : ''}>Monday (الإثنين)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('الحد الأقصى لحجم الملف المرفق (MB)', 'Max Upload Size (MB)')}</label>
                <input type="number" class="form-control" name="max_upload_size_mb" value="${s.max_upload_size_mb || 10}" min="1" max="50" />
              </div>
            </div>
          </div>

          <!-- Task, Approval & Time Tracking Policies -->
          <div class="card">
            <div class="card-header"><span class="card-title">✅ ${WF_I18N.bi('سياسات المهام والاعتماد وتتبع الوقت', 'Task, Approval & Time Tracking Policies')}</span></div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="set-req-approval" ${s.require_task_approval ? 'checked' : ''} />
                <span>${WF_I18N.bi('إلزام مراجعة واعتماد المدير قبل إغلاق المهام كمكتملة', 'Require manager review & approval before marking tasks completed')}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="set-warn-subtasks" ${s.warn_incomplete_subtasks ? 'checked' : ''} />
                <span>${WF_I18N.bi('التنبيه عند محاولة إكمال مهمة تحتوي على خطوات فرعية غير مكتملة', 'Warn before completing tasks with unfinished subtasks/checklists')}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="set-personal-tasks" ${s.allow_employee_personal_tasks ? 'checked' : ''} />
                <span>${WF_I18N.bi('السماح للموظفين بإنشاء مهام شخصية', 'Allow employees to create personal tasks')}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="set-time-tracking" ${s.enable_time_tracking ? 'checked' : ''} />
                <span>${WF_I18N.bi('تفعيل وحدة تتبع الوقت (Time Tracking)', 'Enable Time Tracking module')}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="set-notify-overdue" ${s.notify_manager_on_overdue ? 'checked' : ''} />
                <span>${WF_I18N.bi('إشعار المدير تلقائياً عند تأخر أي مهمة عن موعدها', 'Automatically notify manager when a task becomes overdue')}</span>
              </label>
            </div>
            <div style="margin-top:16px;">
              <button type="submit" class="btn btn-primary">${WF_I18N.bi('حفظ جميع إعدادات الشركة', 'Save All Company Settings')}</button>
            </div>
          </div>
        </div>
      </form>

      <!-- Subscription & Usage Readiness -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">💳 ${WF_I18N.bi('حالة الاشتراك وحدود الاستخدام (Subscription Architecture)', 'Subscription & Workspace Usage')}</span>
          <span class="badge badge-success">${WF.escapeHtml(c.subscription_plan)} (${WF.escapeHtml(c.subscription_status)})</span>
        </div>
        <div class="grid-3">
          <div><strong>${WF_I18N.bi('مقاعد الموظفين:', 'Employee Seats:')}</strong> ${u.seats_used} / ${u.seat_limit}</div>
          <div><strong>${WF_I18N.bi('المشاريع النشطة:', 'Active Projects:')}</strong> ${u.projects_used} / ${u.project_limit}</div>
          <div><strong>${WF_I18N.bi('المساحة التخزينية:', 'Storage Used:')}</strong> ${u.storage_used_mb} MB / ${u.storage_limit_mb} MB</div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${WF.escapeHtml(err.message)}</div>`;
  }
};

WF_Views.saveCompanySettings = async function () {
  const form = document.getElementById('company-settings-form');
  if (!form) return;
  const fd = new FormData(form);
  try {
    await WF.api('/api/company/settings', {
      method: 'PUT',
      body: {
        company: {
          name: fd.get('company_name'),
          industry: fd.get('industry')
        },
        settings: {
          timezone: fd.get('timezone'),
          week_start_day: fd.get('week_start_day'),
          max_upload_size_mb: Number(fd.get('max_upload_size_mb') || 10),
          require_task_approval: document.getElementById('set-req-approval').checked,
          warn_incomplete_subtasks: document.getElementById('set-warn-subtasks').checked,
          allow_employee_personal_tasks: document.getElementById('set-personal-tasks').checked,
          enable_time_tracking: document.getElementById('set-time-tracking').checked,
          notify_manager_on_overdue: document.getElementById('set-notify-overdue').checked
        }
      }
    });
    WF.toast(WF_I18N.bi('تم حفظ إعدادات الشركة بنجاح', 'Company settings saved'), 'success');
    await WF_App.refreshAuth();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.pendingAvatarDataUrl = undefined;

WF_Views.handleProfileAvatarChange = async function (input, previewContainerId) {
  if (!input.files || !input.files[0]) return;
  try {
    const dataUrl = await WF.compressAvatarImage(input.files[0], 256);
    WF_Views.pendingAvatarDataUrl = dataUrl;
    const container = document.getElementById(previewContainerId);
    if (container) {
      container.innerHTML = `<img src="${dataUrl}" alt="avatar" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);display:block;" />`;
    }
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

WF_Views.clearProfileAvatar = function (previewContainerId, name) {
  WF_Views.pendingAvatarDataUrl = '';
  const container = document.getElementById(previewContainerId);
  if (container) {
    container.innerHTML = `<div class="avatar" style="width:76px;height:76px;font-size:24px;">${WF.initials(name)}</div>`;
  }
};

WF_Views.openQuickProfileModal = function () {
  const u = WF.auth.user;
  WF_Views.pendingAvatarDataUrl = undefined;

  WF.openModal({
    title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('user', 18)} <span>${WF_I18N.bi('تعديل الاسم والصورة الشخصية', 'Edit Name & Profile Photo')}</span></span>`,
    bodyHtml: `
      <form id="quick-profile-form" onsubmit="event.preventDefault();WF_Views.saveMyProfile('quick-profile-form', true)">
        <div style="display:flex;align-items:center;gap:16px;padding:14px;background:var(--bg-muted);border-radius:var(--radius-md);margin-bottom:16px;">
          <div id="quick-avatar-preview">
            ${u.avatar_url
              ? `<img src="${WF.escapeHtml(u.avatar_url)}" alt="avatar" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);display:block;" />`
              : `<div class="avatar" style="width:76px;height:76px;font-size:24px;">${WF.initials(u.full_name)}</div>`}
          </div>
          <div style="flex:1;">
            <label class="form-label" style="margin-bottom:6px;display:inline-flex;align-items:center;gap:6px;">
              ${WF.icon('camera', 15)}
              <span>${WF_I18N.bi('الصورة الشخصية', 'Profile Photo')}</span>
            </label>
            <input type="file" accept="image/*" class="form-control" style="padding:5px;font-size:12.5px;margin-bottom:6px;" onchange="WF_Views.handleProfileAvatarChange(this, 'quick-avatar-preview')" />
            <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11.5px;color:var(--danger);" onclick="WF_Views.clearProfileAvatar('quick-avatar-preview', '${WF.escapeHtml(u.full_name)}')">
              ${WF.icon('trash', 13)}
              <span>${WF_I18N.bi('حذف الصورة', 'Remove Photo')}</span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('الاسم الكامل *', 'Full Name *')}</label>
          <input type="text" class="form-control" name="full_name" value="${WF.escapeHtml(u.full_name)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('رقم الهاتف (اختياري)', 'Phone Number (Optional)')}</label>
          <input type="text" class="form-control" name="phone" value="${WF.escapeHtml(u.phone || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">${WF_I18N.bi('كلمة مرور جديدة (اختياري - اتركها فارغة لعدم التغيير)', 'New Password (Optional)')}</label>
          <input type="password" class="form-control" name="new_password" minlength="6" />
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('cancel')}</button>
      <button class="btn btn-primary" onclick="WF_Views.saveMyProfile('quick-profile-form', true)">
        ${WF.icon('save', 15)}
        <span>${WF_I18N.bi('حفظ الاسم والصورة', 'Save Profile')}</span>
      </button>
    `
  });
};

WF_Views.renderProfile = async function (container) {
  const u = WF.auth.user;
  const m = WF.auth.membership;
  WF_Views.pendingAvatarDataUrl = undefined;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title" style="display:inline-flex;align-items:center;gap:10px;">
          <span style="color:var(--primary);display:inline-flex;">${WF.icon('user', 24)}</span>
          <span>${WF_I18N.t('nav_profile')}</span>
        </h1>
        <p class="page-subtitle">${WF_I18N.bi('تعديل اسمك الشخصي، صورتك الرمزية، رقم الهاتف، وكلمة المرور.', 'Manage your personal name, profile photo, phone number, and password.')}</p>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <form id="my-profile-form" onsubmit="event.preventDefault();WF_Views.saveMyProfile('my-profile-form', false)">
          <div style="display:flex;align-items:center;gap:16px;padding:14px;background:var(--bg-muted);border-radius:var(--radius-md);margin-bottom:16px;">
            <div id="page-avatar-preview">
              ${u.avatar_url
                ? `<img src="${WF.escapeHtml(u.avatar_url)}" alt="avatar" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);display:block;" />`
                : `<div class="avatar" style="width:76px;height:76px;font-size:24px;">${WF.initials(u.full_name)}</div>`}
            </div>
            <div style="flex:1;">
              <label class="form-label" style="margin-bottom:6px;display:inline-flex;align-items:center;gap:6px;">
                ${WF.icon('camera', 15)}
                <span>${WF_I18N.bi('تغيير الصورة الشخصية', 'Change Profile Photo')}</span>
              </label>
              <input type="file" accept="image/*" class="form-control" style="padding:5px;font-size:12.5px;margin-bottom:6px;" onchange="WF_Views.handleProfileAvatarChange(this, 'page-avatar-preview')" />
              <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11.5px;color:var(--danger);" onclick="WF_Views.clearProfileAvatar('page-avatar-preview', '${WF.escapeHtml(u.full_name)}')">
                ${WF.icon('trash', 13)}
                <span>${WF_I18N.bi('حذف الصورة', 'Remove Photo')}</span>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('الاسم الكامل', 'Full Name')}</label>
            <input type="text" class="form-control" name="full_name" value="${WF.escapeHtml(u.full_name)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('البريد الإلكتروني (الخاص بتسجيل الدخول في الشركة)', 'Login Email')}</label>
            <input type="email" class="form-control" value="${WF.escapeHtml(u.email)}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('رقم الهاتف', 'Phone Number')}</label>
            <input type="text" class="form-control" name="phone" value="${WF.escapeHtml(u.phone || '')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${WF_I18N.bi('كلمة مرور جديدة (اتركها فارغة إن لم ترغب بالتغيير)', 'New Password (leave blank to keep current)')}</label>
            <input type="password" class="form-control" name="new_password" minlength="6" />
          </div>
          <button type="submit" class="btn btn-primary">
            ${WF.icon('save', 15)}
            <span>${WF_I18N.bi('حفظ التغييرات', 'Save Changes')}</span>
          </button>
        </form>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title" style="display:inline-flex;align-items:center;gap:8px;">
            ${WF.icon('building', 17)}
            <span>${WF_I18N.bi('بيانات العضوية في الشركة', 'Workspace Membership Info')}</span>
          </span>
        </div>
        <p style="margin-bottom:10px;"><strong>${WF_I18N.bi('الشركة التابع لها:', 'Company:')}</strong> ${WF.escapeHtml(WF.auth.company.name)}</p>
        <p style="margin-bottom:10px;"><strong>${WF_I18N.bi('الرقم الوظيفي:', 'Employee ID:')}</strong> ${WF.escapeHtml(m.employee_code || '—')}</p>
        <p style="margin-bottom:10px;"><strong>${WF_I18N.bi('المسمى الوظيفي:', 'Job Title:')}</strong> ${WF.escapeHtml(m.job_title || '—')}</p>
        <p style="margin-bottom:10px;"><strong>${WF_I18N.bi('القسم:', 'Department:')}</strong> ${WF.escapeHtml(m.department_name || '—')}</p>
        <p style="margin-bottom:10px;"><strong>${WF_I18N.bi('الدور:', 'Role:')}</strong> ${WF_I18N.roleBadge(m.role)}</p>
        <p><strong>${WF_I18N.bi('تاريخ الانضمام:', 'Joined Date:')}</strong> ${WF.escapeHtml(m.joined_at || '—')}</p>
      </div>
    </div>
  `;
};

WF_Views.saveMyProfile = async function (formId = 'my-profile-form', closeModalAfter = false) {
  const form = document.getElementById(formId);
  if (!form) return;
  const body = Object.fromEntries(new FormData(form).entries());
  if (WF_Views.pendingAvatarDataUrl !== undefined) {
    body.avatar_url = WF_Views.pendingAvatarDataUrl;
  }
  try {
    await WF.api('/api/auth/profile', { method: 'PUT', body });
    WF_Views.pendingAvatarDataUrl = undefined;
    WF.toast(WF_I18N.bi('تم تحديث الاسم والصورة الشخصية بنجاح!', 'Name and profile photo updated!'), 'success');
    if (closeModalAfter) WF.closeModal();
    await WF_App.refreshAuth();
    await WF.refreshReferenceData();
    WF_App.route();
  } catch (err) {
    WF.toast(err.message, 'error');
  }
};

