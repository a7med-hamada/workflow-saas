window.WF_App = {
  async init() {
    window.addEventListener('hashchange', () => this.route());
    await this.refreshAuth();
    this.route();
  },

  async refreshAuth() {
    if (!WF.token) {
      WF.auth = null;
      return;
    }
    try {
      const data = await WF.api('/api/auth/me');
      WF.auth = data;
    } catch (_) {
      WF.token = null;
      WF.auth = null;
      localStorage.removeItem('wf_token');
    }
  },

  toggleLang() {
    const next = WF_I18N.lang === 'ar' ? 'en' : 'ar';
    WF_I18N.setLang(next);
    this.route();
  },

  toggleTheme() {
    const next = WF_I18N.theme === 'dark' ? 'light' : 'dark';
    WF_I18N.setTheme(next);
    this.route();
  },

  async logout() {
    try {
      await WF.api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (_) {}
    WF.token = null;
    WF.auth = null;
    localStorage.removeItem('wf_token');
    location.hash = '#/login';
  },

  getNavItems() {
    const role = WF.auth.membership.role;
    const items = [];

    if (role === 'owner' || role === 'manager') {
      items.push({ hash: '#/dashboard', icon: WF.icon('dashboard', 17), label: WF_I18N.t('nav_dashboard') });
    }

    items.push({ hash: '#/my-tasks', icon: WF.icon('check', 17), label: WF_I18N.t('nav_my_tasks') });
    items.push({ hash: '#/projects', icon: WF.icon('folder', 17), label: WF_I18N.t('nav_projects') });

    if (role === 'owner' || role === 'manager' || WF.hasPerm('can_assign_tasks')) {
      items.push({ hash: '#/tasks', icon: WF.icon('tasks', 17), label: WF_I18N.t('nav_all_tasks') });
    } else {
      items.push({ hash: '#/tasks', icon: WF.icon('tasks', 17), label: WF_I18N.bi('لوحة كانبان والمهام', 'Kanban & Tasks') });
    }

    if (role === 'owner' || role === 'manager' || WF.hasPerm('can_manage_employees')) {
      items.push({ hash: '#/employees', icon: WF.icon('users', 17), label: WF_I18N.t('nav_employees') });
    }

    if (role === 'owner' || role === 'manager' || WF.hasPerm('can_manage_departments')) {
      items.push({ hash: '#/departments', icon: WF.icon('building', 17), label: WF_I18N.t('nav_departments') });
    }

    items.push({ hash: '#/calendar', icon: WF.icon('calendar', 17), label: WF_I18N.t('nav_calendar') });
    items.push({ hash: '#/daily-reports', icon: WF.icon('file-text', 17), label: WF_I18N.t('nav_daily_reports') });
    items.push({ hash: '#/reports', icon: WF.icon('bar-chart', 17), label: WF_I18N.t('nav_reports') });
    items.push({
      hash: '#/notifications',
      icon: WF.icon('bell', 17),
      label: WF_I18N.t('nav_notifications'),
      badge: WF.auth.unread_notifications || 0
    });

    if (role === 'owner' || WF.hasPerm('can_view_audit_logs')) {
      items.push({ hash: '#/audit-logs', icon: WF.icon('shield', 17), label: WF_I18N.t('nav_audit_logs') });
    }

    if (role === 'owner' || WF.hasPerm('can_manage_settings')) {
      items.push({ hash: '#/settings', icon: WF.icon('settings', 17), label: WF_I18N.t('nav_settings') });
    }

    items.push({ hash: '#/profile', icon: WF.icon('user', 17), label: WF_I18N.t('nav_profile') });
    return items;
  },

  renderAppShell(activeRoute) {
    const app = document.getElementById('app');
    const navItems = this.getNavItems();
    const u = WF.auth.user;
    const c = WF.auth.company;
    const m = WF.auth.membership;

    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar ${WF.sidebarCollapsed ? 'collapsed' : ''} ${WF.mobileMenuOpen ? 'mobile-open' : ''}" id="app-sidebar">
          <div class="sidebar-header">
            <div class="brand-logo" style="color:#fff;">
              <span class="brand-logo-icon">W</span>
              <div class="sidebar-company-meta">
                <div style="font-size:15px;line-height:1.2;">WorkFlow</div>
                <div style="font-size:11px;color:var(--text-sidebar-muted);font-weight:400;">${WF.escapeHtml(c.name)}</div>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" style="color:#fff;" onclick="WF.sidebarCollapsed=!WF.sidebarCollapsed;WF_App.route()">☰</button>
          </div>

          <nav class="sidebar-nav">
            ${navItems.map((item) => {
              const isActive = activeRoute === item.hash || (item.hash !== '#/' && activeRoute.startsWith(item.hash));
              return `
                <button class="nav-item ${isActive ? 'active' : ''}" onclick="WF.mobileMenuOpen=false;location.hash='${item.hash}'">
                  <span class="nav-icon" style="display:inline-flex;align-items:center;justify-content:center;">${item.icon}</span>
                  <span class="sidebar-label">${item.label}</span>
                  ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
                </button>
              `;
            }).join('')}
          </nav>

          <div class="sidebar-footer" style="cursor:pointer;" onclick="WF_Views.openQuickProfileModal()" title="${WF_I18N.bi('تعديل الاسم والصورة الشخصية', 'Edit Name & Profile Photo')}">
            ${WF.renderAvatar(u.full_name, u.avatar_url)}
            <div class="sidebar-footer-info" style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${WF.escapeHtml(u.full_name)}</div>
              <div style="font-size:11px;color:var(--text-sidebar-muted);display:inline-flex;align-items:center;gap:4px;">${WF.escapeHtml(m.role.toUpperCase())} ${WF.icon('edit', 11)}</div>
            </div>
            <button class="btn btn-ghost btn-sm" style="color:#f87171;" title="${WF_I18N.t('logout')}" onclick="event.stopPropagation();WF_App.logout()">${WF.icon('log-out', 16)}</button>
          </div>
        </aside>

        <div class="main-area">
          <header class="topbar">
            <div class="topbar-start">
              <button class="btn btn-secondary btn-sm mobile-menu-btn" onclick="WF.mobileMenuOpen=!WF.mobileMenuOpen;document.getElementById('app-sidebar').classList.toggle('mobile-open')">☰</button>
              <form class="search-box" onsubmit="event.preventDefault();WF_App.submitGlobalSearch()">
                <input type="search" id="global-search-input" placeholder="${WF_I18N.t('search_placeholder')}" />
              </form>
            </div>
            <div class="topbar-end">
              <button class="btn btn-primary btn-sm" onclick="WF_App.openSwitchAccountModal()" style="display:inline-flex;align-items:center;gap:6px;">
                ${WF.icon('users', 14)}
                <span>${WF_I18N.bi('تبديل الحساب (مدير / موظف)', 'Switch Account')}</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="WF_Views.openQuickProfileModal()" style="display:inline-flex;align-items:center;gap:8px;padding:4px 12px;">
                ${WF.renderAvatar(u.full_name, u.avatar_url, 'avatar-sm')}
                <span>${WF.escapeHtml(u.full_name)}</span>
                <span style="font-size:11.5px;color:var(--primary);display:inline-flex;align-items:center;gap:4px;">${WF.icon('edit', 13)} <span>${WF_I18N.bi('الاسم والصورة', 'Edit Profile')}</span></span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="WF_App.toggleLang()">${WF.icon('globe', 14)} <span>${WF_I18N.lang === 'ar' ? 'English' : 'العربية'}</span></button>
              <button class="btn btn-secondary btn-sm" onclick="WF_App.toggleTheme()">${WF_I18N.theme === 'dark' ? `${WF.icon('sun', 14)} <span>Light</span>` : `${WF.icon('moon', 14)} <span>Dark</span>`}</button>
              <button class="btn btn-secondary btn-sm" onclick="location.hash='#/notifications'">
                ${WF.icon('bell', 15)} ${WF.auth.unread_notifications ? `<span class="badge badge-danger">${WF.auth.unread_notifications}</span>` : ''}
              </button>
              <button class="btn-action-chip danger" onclick="WF_App.logout()" title="${WF_I18N.t('logout')}">
                ${WF.icon('log-out', 14)}
                <span>${WF_I18N.bi('خروج', 'Logout')}</span>
              </button>
            </div>
          </header>

          <main class="page-content" id="page-content"></main>
        </div>
      </div>
    `;
  },

  submitGlobalSearch() {
    const q = document.getElementById('global-search-input').value.trim();
    if (!q) return;
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  },

  async renderSearchPage(container, queryParams) {
    const q = queryParams.get('q') || '';
    container.innerHTML = `<div class="card">${WF_I18N.bi('جاري البحث...', 'Searching...')}</div>`;
    try {
      const res = await WF.api(`/api/search?q=${encodeURIComponent(q)}`);
      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">🔍 ${WF_I18N.bi('نتائج البحث عن:', 'Search Results for:')} "${WF.escapeHtml(q)}"</h1>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">📋 ${WF_I18N.bi('المهام', 'Tasks')} (${res.tasks.length})</span></div>
            ${res.tasks.length === 0 ? `<div class="empty-state">${WF_I18N.bi('لا توجد مهام مطابقة', 'No matching tasks')}</div>` : res.tasks.map((t) => `
              <div style="padding:8px;border-bottom:1px solid var(--border-color);cursor:pointer;" onclick="WF_Views.openTaskDetailModal('${t.id}')">
                <strong>${WF.escapeHtml(t.title)}</strong>
                <div>${WF_I18N.statusBadge(t.status)} ${WF_I18N.priorityBadge(t.priority)}</div>
              </div>
            `).join('')}
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">📁 ${WF_I18N.bi('المشاريع', 'Projects')} (${res.projects.length})</span></div>
            ${res.projects.length === 0 ? `<div class="empty-state">${WF_I18N.bi('لا توجد مشاريع مطابقة', 'No matching projects')}</div>` : res.projects.map((p) => `
              <div style="padding:8px;border-bottom:1px solid var(--border-color);cursor:pointer;" onclick="location.hash='#/projects/${p.id}'">
                <strong>${WF.escapeHtml(p.name)}</strong>
                <div>${WF_I18N.projectStatusBadge(p.status)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card">${WF.escapeHtml(err.message)}</div>`;
    }
  },

  renderAuthScreen(screen, queryParams) {
    const app = document.getElementById('app');
    const topControls = `
      <div class="auth-topbar">
        <div class="brand-logo">
          <span class="brand-logo-icon">W</span>
          <span>${WF_I18N.t('appName')}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="WF_App.toggleLang()">🌐 ${WF_I18N.lang === 'ar' ? 'English' : 'العربية'}</button>
          <button class="btn btn-secondary btn-sm" onclick="WF_App.toggleTheme()">${WF_I18N.theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </div>
    `;

    if (screen === 'register') {
      app.innerHTML = `
        <div class="auth-wrapper">
          ${topControls}
          <div class="auth-card">
            <h2 style="margin-bottom:6px;">${WF_I18N.t('register_company')}</h2>
            <p style="color:var(--text-muted);font-size:13px;margin-bottom:18px;">
              ${WF_I18N.bi('أنشئ مساحة عمل مستقلة لشركتك (تبدأ فارغة تماماً وجاهزة لإضافة فريقك ومشاريعك).', 'Create a new isolated company workspace (starts clean and empty for your real team).')}
            </p>
            <form id="register-form" onsubmit="event.preventDefault();WF_App.submitRegister()">
              <div class="form-group">
                <label class="form-label">${WF_I18N.t('company_name')} *</label>
                <input type="text" class="form-control" name="company_name" required />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.t('owner_full_name')} *</label>
                <input type="text" class="form-control" name="full_name" required />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.t('business_email')} *</label>
                <input type="email" class="form-control" name="email" required />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">${WF_I18N.t('password')} *</label>
                  <input type="password" class="form-control" name="password" minlength="8" required />
                </div>
                <div class="form-group">
                  <label class="form-label">${WF_I18N.t('confirm_password')} *</label>
                  <input type="password" class="form-control" name="confirm_password" minlength="8" required />
                </div>
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px;">${WF_I18N.t('register_company')}</button>
            </form>
            <div style="text-align:center;margin-top:16px;font-size:13px;">
              <a href="#/login">${WF_I18N.bi('لديك حساب بالفعل؟ تسجيل الدخول', 'Already have an account? Sign In')}</a>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (screen === 'forgot-password') {
      app.innerHTML = `
        <div class="auth-wrapper">
          ${topControls}
          <div class="auth-card">
            <h2 style="margin-bottom:8px;">${WF_I18N.t('forgot_password')}</h2>
            <form id="forgot-form" onsubmit="event.preventDefault();WF_App.submitForgotPassword()">
              <div class="form-group">
                <label class="form-label">${WF_I18N.t('business_email')}</label>
                <input type="email" class="form-control" name="email" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;">${WF_I18N.bi('إرسال رابط الاستعادة', 'Send Reset Instructions')}</button>
            </form>
            <div id="forgot-dev-output"></div>
            <div style="text-align:center;margin-top:14px;"><a href="#/login">← ${WF_I18N.t('login')}</a></div>
          </div>
        </div>
      `;
      return;
    }

    if (screen === 'reset-password') {
      const token = queryParams.get('token') || '';
      app.innerHTML = `
        <div class="auth-wrapper">
          ${topControls}
          <div class="auth-card">
            <h2 style="margin-bottom:8px;">${WF_I18N.t('reset_password')}</h2>
            <form id="reset-form" onsubmit="event.preventDefault();WF_App.submitResetPassword()">
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('رمز الاستعادة (Token)', 'Reset Token')}</label>
                <input type="text" class="form-control" name="token" value="${WF.escapeHtml(token)}" required />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('كلمة المرور الجديدة (8 أحرف على الأقل)', 'New Password (min 8 chars)')}</label>
                <input type="password" class="form-control" name="password" minlength="8" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;">${WF_I18N.t('reset_password')}</button>
            </form>
            <div style="text-align:center;margin-top:14px;"><a href="#/login">← ${WF_I18N.t('login')}</a></div>
          </div>
        </div>
      `;
      return;
    }

    if (screen === 'accept-invite') {
      const token = queryParams.get('token') || '';
      app.innerHTML = `
        <div class="auth-wrapper">
          ${topControls}
          <div class="auth-card">
            <h2 style="margin-bottom:8px;">✉️ ${WF_I18N.bi('قبول دعوة الانضمام للشركة', 'Accept Workspace Invitation')}</h2>
            <form id="accept-invite-form" onsubmit="event.preventDefault();WF_App.submitAcceptInvite()">
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('رمز الدعوة', 'Invitation Token')}</label>
                <input type="text" class="form-control" name="token" value="${WF.escapeHtml(token)}" required />
              </div>
              <div class="form-group">
                <label class="form-label">${WF_I18N.bi('عيّن كلمة المرور الخاصة بك (8 أحرف على الأقل)', 'Set Your Password (min 8 chars)')}</label>
                <input type="password" class="form-control" name="password" minlength="8" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;">${WF_I18N.bi('تفعيل الحساب والانضمام للشركة', 'Activate Account & Join Workspace')}</button>
            </form>
          </div>
        </div>
      `;
      return;
    }

    // Default: Login screen
    app.innerHTML = `
      <div class="auth-wrapper">
        ${topControls}
        <div class="auth-card">
          <h2 style="margin-bottom:4px;">${WF_I18N.t('login')}</h2>
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:18px;">${WF_I18N.t('appTagline')}</p>
          <form id="login-form" onsubmit="event.preventDefault();WF_App.submitLogin()">
            <div class="form-group">
              <label class="form-label">${WF_I18N.t('business_email')}</label>
              <input type="email" class="form-control" name="email" id="login-email" required />
            </div>
            <div class="form-group">
              <label class="form-label">${WF_I18N.t('password')}</label>
              <input type="password" class="form-control" name="password" id="login-password" required />
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:12.5px;">
              <a href="#/forgot-password">${WF_I18N.t('forgot_password')}</a>
              <a href="#/register">${WF_I18N.t('register_company')}</a>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;">${WF_I18N.t('login')}</button>
          </form>

          <!-- Optional Development Demo Workspace Panel -->
          <div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border-color);">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;display:inline-flex;align-items:center;gap:6px;">
              ${WF.icon('users', 15)}
              <span>${WF_I18N.bi('الدخول السريع (مالك / مدير / موظف)', 'Quick Login (Owner / Manager / Employee)')}</span>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
              ${WF_I18N.bi('اضغط على أي دور للدخول المباشر وتجربة صلاحياته، أو اختر أي موظف/مدير قمت بإنشائه:', 'Click any role to log in immediately, or select any employee/manager you created:')}
            </p>
            <button type="button" class="btn btn-secondary btn-sm" style="width:100%;margin-bottom:8px;" onclick="WF_App.seedAndLoginDemo('owner@demo.workflow.local')">
              ${WF.icon('shield', 15)}
              <span>${WF_I18N.bi('دخول كمالك شركة (Owner)', 'Login as Company Owner')}</span>
            </button>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="WF_App.seedAndLoginDemo('manager@demo.workflow.local')">
                ${WF.icon('user', 15)}
                <span>${WF_I18N.bi('دخول كمدير (Manager)', 'Login as Manager')}</span>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="WF_App.seedAndLoginDemo('employee@demo.workflow.local')">
                ${WF.icon('check', 15)}
                <span>${WF_I18N.bi('دخول كموظف (Employee)', 'Login as Employee')}</span>
              </button>
            </div>
            <div id="login-workspace-accounts-box"></div>
          </div>
        </div>
      </div>
    `;
    this.loadWorkspaceAccountsOnLogin();
  },

  async loadWorkspaceAccountsOnLogin() {
    try {
      const res = await WF.api('/api/auth/workspace-accounts');
      const accounts = res.accounts || [];
      const box = document.getElementById('login-workspace-accounts-box');
      if (!box || accounts.length === 0) return;
      box.innerHTML = `
        <div style="margin-top:8px;padding-top:10px;border-top:1px dashed var(--border-color);">
          <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">
            ${WF_I18N.bi('حسابات الشركة الحالية (اضغط للدخول المباشر):', 'Current Workspace Accounts (Click to login):')}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:190px;overflow-y:auto;">
            ${accounts.map((a) => `
              <button type="button" class="btn-action-chip" style="justify-content:space-between;width:100%;padding:7px 12px;" onclick="WF_App.quickSwitchUser('${a.user_id}')">
                <span class="emp-row-inline">
                  ${WF.renderAvatar(a.full_name, a.avatar_url, 'avatar-sm')}
                  <span style="font-weight:700;">${WF.escapeHtml(a.full_name)}</span>
                  <span style="font-size:11.5px;color:var(--text-muted);direction:ltr;">(${WF.escapeHtml(a.email)})</span>
                </span>
                ${WF_I18N.roleBadge(a.role)}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } catch (_) {}
  },

  async quickSwitchUser(userId) {
    try {
      const loginRes = await WF.api('/api/auth/quick-switch', {
        method: 'POST',
        body: { user_id: userId }
      });
      WF.token = loginRes.token;
      WF.auth = loginRes;
      localStorage.setItem('wf_token', loginRes.token);
      WF.closeModal();
      WF.toast(
        WF_I18N.bi(
          `تم الدخول بحساب: ${loginRes.user.full_name} (${loginRes.membership.role === 'manager' ? 'مدير' : loginRes.membership.role === 'owner' ? 'مالك' : 'موظف'})`,
          `Switched to ${loginRes.user.full_name}`
        ),
        'success'
      );
      const targetHash = `#${loginRes.redirect_to || '/dashboard'}`;
      if (location.hash === targetHash) {
        this.route();
      } else {
        location.hash = targetHash;
      }
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async openSwitchAccountModal() {
    try {
      await WF.api('/api/demo/seed', { method: 'POST', body: { reset: false } });
      const res = await WF.api('/api/auth/workspace-accounts');
      const accounts = res.accounts || [];
      const currentUserId = WF.auth && WF.auth.user ? WF.auth.user.id : '';

      WF.openModal({
        title: `<span style="display:inline-flex;align-items:center;gap:8px;">${WF.icon('users', 18)} <span>${WF_I18N.bi('تبديل الحساب السريع (ادخل كمدير أو موظف أو مالك)', 'Quick Account Switcher')}</span></span>`,
        bodyHtml: `
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">
            ${WF_I18N.bi('اختر أي حساب من حسابات الشركة للدخول به فوراً وتجربة لوحة التحكم الخاصة به (سواء المدير أو الموظف):', 'Select any workspace account to log in immediately and test their view:')}
          </p>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto;">
            ${accounts.map((a) => {
              const isCurrent = a.user_id === currentUserId;
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border:1px solid ${isCurrent ? 'var(--primary)' : 'var(--border-color)'};background:${isCurrent ? 'var(--primary-soft)' : 'var(--bg-surface)'};border-radius:var(--radius-sm);">
                  <div class="emp-row-inline">
                    ${WF.renderAvatar(a.full_name, a.avatar_url)}
                    <div>
                      <div style="font-weight:800;font-size:14px;">${WF.escapeHtml(a.full_name)}</div>
                      <div style="font-size:12px;color:var(--text-muted);direction:ltr;text-align:start;">${WF.escapeHtml(a.email)} ${a.department_name ? `• ${WF.escapeHtml(a.department_name)}` : ''}</div>
                    </div>
                  </div>
                  <div class="emp-actions-bar">
                    ${WF_I18N.roleBadge(a.role)}
                    ${isCurrent
                      ? `<span class="badge badge-success">${WF_I18N.bi('الحساب الحالي', 'Current')}</span>`
                      : `<button class="btn btn-primary btn-sm" onclick="WF_App.quickSwitchUser('${a.user_id}')">${WF.icon('check', 14)} <span>${WF_I18N.bi('دخول بهذا الحساب', 'Login as')}</span></button>`}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `,
        footerHtml: `<button class="btn btn-secondary" onclick="WF.closeModal()">${WF_I18N.t('close')}</button>`
      });
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async submitLogin() {
    const form = document.getElementById('login-form');
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await WF.api('/api/auth/login', { method: 'POST', body });
      WF.token = res.token;
      WF.auth = res;
      localStorage.setItem('wf_token', res.token);
      location.hash = `#${res.redirect_to || '/dashboard'}`;
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async submitRegister() {
    const form = document.getElementById('register-form');
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await WF.api('/api/auth/register', { method: 'POST', body });
      WF.token = res.token;
      WF.auth = res;
      localStorage.setItem('wf_token', res.token);
      WF.toast(WF_I18N.bi('تم تسجيل الشركة وإنشاء مساحة العمل الفارغة بنجاح!', 'Company registered!'), 'success');
      location.hash = '#/dashboard';
      setTimeout(() => WF_Views.openSetupWizardModal(), 400);
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async submitForgotPassword() {
    const form = document.getElementById('forgot-form');
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await WF.api('/api/auth/forgot-password', { method: 'POST', body });
      const out = document.getElementById('forgot-dev-output');
      if (out) {
        out.innerHTML = `
          <div style="margin-top:12px;padding:10px;background:var(--info-soft);border-radius:var(--radius-sm);font-size:12.5px;">
            <div>${WF.escapeHtml(res.message)}</div>
            ${res.dev_reset_url ? `<div style="margin-top:6px;"><a href="${WF.escapeHtml(res.dev_reset_url)}"><strong>${WF_I18N.bi('اضغط هنا لإعادة تعيين كلمة المرور (وضع التطوير)', 'Click here to reset password (Dev Mode)')}</strong></a></div>` : ''}
          </div>
        `;
      }
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async submitResetPassword() {
    const form = document.getElementById('reset-form');
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      await WF.api('/api/auth/reset-password', { method: 'POST', body });
      WF.toast(WF_I18N.bi('تمت إعادة تعيين كلمة المرور بنجاح', 'Password reset successfully'), 'success');
      location.hash = '#/login';
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async submitAcceptInvite() {
    const form = document.getElementById('accept-invite-form');
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await WF.api('/api/auth/accept-invite', { method: 'POST', body });
      WF.token = res.token;
      WF.auth = res;
      localStorage.setItem('wf_token', res.token);
      WF.toast(WF_I18N.bi('تم الانضمام لمساحة عمل الشركة بنجاح!', 'Joined company workspace!'), 'success');
      location.hash = `#${res.redirect_to || '/my-tasks'}`;
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  async seedAndLoginDemo(email) {
    try {
      const seedRes = await WF.api('/api/demo/seed', { method: 'POST', body: { reset: false } });
      const password = (seedRes.demo && seedRes.demo.demo_password) || 'Demo@12345';
      const loginRes = await WF.api('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      WF.token = loginRes.token;
      WF.auth = loginRes;
      localStorage.setItem('wf_token', loginRes.token);
      WF.toast(WF_I18N.bi('تم تسجيل الدخول بنجاح', 'Logged in successfully'), 'success');
      const targetHash = `#${loginRes.redirect_to}`;
      if (location.hash === targetHash) {
        this.route();
      } else {
        location.hash = targetHash;
      }
    } catch (err) {
      WF.toast(err.message, 'error');
    }
  },

  route() {
    const rawHash = location.hash || '#/login';
    const [pathPart, queryPart] = rawHash.split('?');
    const queryParams = new URLSearchParams(queryPart || '');

    if (!WF.auth) {
      if (pathPart === '#/register') return this.renderAuthScreen('register', queryParams);
      if (pathPart === '#/forgot-password') return this.renderAuthScreen('forgot-password', queryParams);
      if (pathPart === '#/reset-password') return this.renderAuthScreen('reset-password', queryParams);
      if (pathPart === '#/accept-invite') return this.renderAuthScreen('accept-invite', queryParams);
      return this.renderAuthScreen('login', queryParams);
    }

    if (['#/login', '#/register', '#/', ''].includes(pathPart)) {
      const defaultTarget = WF.auth.membership.role === 'employee' ? '#/my-tasks' : '#/dashboard';
      location.hash = defaultTarget;
      return;
    }

    this.renderAppShell(pathPart);
    const container = document.getElementById('page-content');

    if (pathPart === '#/dashboard') {
      if (WF.auth.membership.role === 'employee') {
        location.hash = '#/my-tasks';
        return;
      }
      return WF_Views.renderDashboard(container);
    }
    if (pathPart === '#/my-tasks') return WF_Views.renderMyTasks(container);
    if (pathPart === '#/tasks') return WF_Views.renderAllTasks(container, queryParams);
    if (pathPart === '#/projects') return WF_Views.renderProjects(container);
    const projMatch = pathPart.match(/^#\/projects\/([^/]+)$/);
    if (projMatch) return WF_Views.renderProjectDetail(container, projMatch[1]);
    if (pathPart === '#/employees') return WF_Views.renderEmployees(container);
    if (pathPart === '#/departments') return WF_Views.renderDepartments(container);
    if (pathPart === '#/calendar') return WF_Views.renderCalendar(container);
    if (pathPart === '#/daily-reports') return WF_Views.renderDailyReports(container);
    if (pathPart === '#/reports') return WF_Views.renderReports(container);
    if (pathPart === '#/notifications') return WF_Views.renderNotifications(container);
    if (pathPart === '#/audit-logs') return WF_Views.renderAuditLogs(container);
    if (pathPart === '#/settings') return WF_Views.renderSettings(container);
    if (pathPart === '#/profile') return WF_Views.renderProfile(container);
    if (pathPart === '#/search') return this.renderSearchPage(container, queryParams);

    WF_Views.renderMyTasks(container);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  WF_App.init();
});
