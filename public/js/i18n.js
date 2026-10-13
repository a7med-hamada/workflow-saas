window.WF_I18N = {
  lang: localStorage.getItem('wf_lang') || 'ar',
  theme: localStorage.getItem('wf_theme') || 'light',

  dict: {
    ar: {
      appName: 'وورك فلو WorkFlow',
      appTagline: 'منصة SaaS متكاملة لإدارة مشاريع الشركات ومهام الموظفين وقياس الإنتاجية',
      nav_dashboard: 'لوحة التحكم',
      nav_projects: 'المشاريع',
      nav_all_tasks: 'جميع المهام',
      nav_my_tasks: 'مهامي',
      nav_employees: 'الموظفون',
      nav_departments: 'الأقسام والفرق',
      nav_calendar: 'التقويم والجدول الزمني',
      nav_daily_reports: 'التقارير اليومية',
      nav_reports: 'تقارير الأداء والإنتاجية',
      nav_notifications: 'الإشعارات',
      nav_audit_logs: 'سجل التدقيق والنشاط',
      nav_settings: 'إعدادات الشركة',
      nav_profile: 'ملفي الشخصي',
      logout: 'تسجيل الخروج',
      login: 'تسجيل الدخول',
      register_company: 'تسجيل شركة جديدة',
      forgot_password: 'نسيت كلمة المرور؟',
      reset_password: 'إعادة تعيين كلمة المرور',
      company_name: 'اسم الشركة / المؤسسة',
      owner_full_name: 'الاسم الكامل لمالك الشركة',
      business_email: 'البريد الإلكتروني للعمل',
      password: 'كلمة المرور',
      confirm_password: 'تأكيد كلمة المرور',
      role_owner: 'مالك الشركة / مدير عام',
      role_manager: 'مدير مشروع / قائد فريق',
      role_employee: 'موظف',
      status_backlog: 'قائمة الانتظار (Backlog)',
      status_todo: 'للتنفيذ (To Do)',
      status_in_progress: 'قيد التنفيذ (In Progress)',
      status_in_review: 'قيد المراجعة (In Review)',
      status_completed: 'مكتملة (Completed)',
      status_blocked: 'متوقفة / عائق (Blocked)',
      status_cancelled: 'ملغاة (Cancelled)',
      priority_low: 'منخفضة',
      priority_medium: 'متوسطة',
      priority_high: 'عالية',
      priority_urgent: 'عاجلة',
      proj_planning: 'تخطيط',
      proj_active: 'نشط',
      proj_on_hold: 'معلق مؤقتاً',
      proj_completed: 'مكتمل',
      proj_archived: 'مؤرشف',
      vis_public: 'عام للشركة',
      vis_team: 'خاص بالقسم/الفريق',
      vis_confidential: 'سري (للمصرح لهم فقط)',
      health_on_track: 'يسير وفق الخطة',
      health_at_risk: 'معرض للتأخير',
      health_delayed: 'متأخر',
      health_completed: 'مكتمل',
      search_placeholder: 'ابحث في المهام، المشاريع، الموظفين، التعليقات...',
      create_task: 'إنشاء مهمة جديدة',
      create_project: 'إنشاء مشروع جديد',
      add_employee: 'إضافة موظف',
      invite_employee: 'دعوة عبر البريد',
      create_department: 'إنشاء قسم جديد',
      save: 'حفظ',
      cancel: 'إلغاء',
      delete: 'حذف',
      edit: 'تعديل',
      close: 'إغلاق',
      submit_for_review: 'إرسال للمراجعة والاعتماد',
      approve_task: 'اعتماد المهمة',
      request_changes: 'طلب تعديلات',
      reopen_task: 'إعادة فتح المهمة',
      start_task: 'بدء العمل على المهمة',
      mark_completed: 'تحديد كمكتملة',
      export_csv: 'تصدير CSV',
      export_excel: 'تصدير Excel',
      demo_mode_title: 'بيئة العرض التجريبية (Demo Mode)',
      demo_mode_desc: 'يمكنك تهيئة مساحة عمل تجريبية متكاملة (شركة، مالك، مدراء، 10 موظفين، 3 أقسام، 3 مشاريع ومهام متنوعة) لتجربة النظام فوراً دون التأثير على حسابات العملاء الحقيقية.',
      load_demo_btn: 'تهيئة وتشغيل البيانات التجريبية'
    },
    en: {
      appName: 'WorkFlow SaaS',
      appTagline: 'Complete SaaS Project Management & Employee Task Tracking Platform',
      nav_dashboard: 'Dashboard',
      nav_projects: 'Projects',
      nav_all_tasks: 'All Tasks',
      nav_my_tasks: 'My Tasks',
      nav_employees: 'Employees',
      nav_departments: 'Departments',
      nav_calendar: 'Calendar & Timeline',
      nav_daily_reports: 'Daily Reports',
      nav_reports: 'Productivity Reports',
      nav_notifications: 'Notifications',
      nav_audit_logs: 'Audit Logs',
      nav_settings: 'Company Settings',
      nav_profile: 'My Profile',
      logout: 'Logout',
      login: 'Sign In',
      register_company: 'Register New Company',
      forgot_password: 'Forgot password?',
      reset_password: 'Reset Password',
      company_name: 'Company Name',
      owner_full_name: 'Owner Full Name',
      business_email: 'Business Email',
      password: 'Password',
      confirm_password: 'Confirm Password',
      role_owner: 'Company Owner / Admin',
      role_manager: 'Manager / Team Leader',
      role_employee: 'Employee',
      status_backlog: 'Backlog',
      status_todo: 'To Do',
      status_in_progress: 'In Progress',
      status_in_review: 'In Review',
      status_completed: 'Completed',
      status_blocked: 'Blocked',
      status_cancelled: 'Cancelled',
      priority_low: 'Low',
      priority_medium: 'Medium',
      priority_high: 'High',
      priority_urgent: 'Urgent',
      proj_planning: 'Planning',
      proj_active: 'Active',
      proj_on_hold: 'On Hold',
      proj_completed: 'Completed',
      proj_archived: 'Archived',
      vis_public: 'Workspace Public',
      vis_team: 'Team / Department',
      vis_confidential: 'Confidential',
      health_on_track: 'On Track',
      health_at_risk: 'At Risk',
      health_delayed: 'Delayed',
      health_completed: 'Completed',
      search_placeholder: 'Search tasks, projects, employees, comments...',
      create_task: 'New Task',
      create_project: 'New Project',
      add_employee: 'Add Employee',
      invite_employee: 'Invite by Email',
      create_department: 'New Department',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      close: 'Close',
      submit_for_review: 'Submit for Review',
      approve_task: 'Approve Work',
      request_changes: 'Request Changes',
      reopen_task: 'Reopen Task',
      start_task: 'Start Task',
      mark_completed: 'Mark Completed',
      export_csv: 'Export CSV',
      export_excel: 'Export Excel',
      demo_mode_title: 'Development Demo Mode',
      demo_mode_desc: 'Initialize an isolated demo workspace (1 company, 1 owner, 2 managers, 10 employees, 3 departments, 3 projects & sample tasks) to test all roles.',
      load_demo_btn: 'Seed & Load Demo Workspace'
    }
  },

  t(key, fallback) {
    const table = this.dict[this.lang] || this.dict.ar;
    return table[key] || fallback || key;
  },

  bi(arText, enText) {
    return this.lang === 'ar' ? arText : enText;
  },

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ar';
    localStorage.setItem('wf_lang', this.lang);
    document.documentElement.lang = this.lang;
    document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
  },

  setTheme(theme) {
    this.theme = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('wf_theme', this.theme);
    document.documentElement.setAttribute('data-theme', this.theme);
  },

  init() {
    this.setLang(this.lang);
    this.setTheme(this.theme);
  },

  statusBadge(status) {
    const map = {
      backlog: ['badge-neutral', this.t('status_backlog')],
      todo: ['badge-info', this.t('status_todo')],
      in_progress: ['badge-primary', this.t('status_in_progress')],
      in_review: ['badge-purple', this.t('status_in_review')],
      completed: ['badge-success', this.t('status_completed')],
      blocked: ['badge-danger', this.t('status_blocked')],
      cancelled: ['badge-neutral', this.t('status_cancelled')]
    };
    const [cls, label] = map[status] || ['badge-neutral', status];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  priorityBadge(priority) {
    const map = {
      low: ['badge-neutral', this.t('priority_low')],
      medium: ['badge-info', this.t('priority_medium')],
      high: ['badge-warning', this.t('priority_high')],
      urgent: ['badge-danger', `🔥 ${this.t('priority_urgent')}`]
    };
    const [cls, label] = map[priority] || ['badge-neutral', priority];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  projectStatusBadge(status) {
    const map = {
      planning: ['badge-info', this.t('proj_planning')],
      active: ['badge-primary', this.t('proj_active')],
      on_hold: ['badge-warning', this.t('proj_on_hold')],
      completed: ['badge-success', this.t('proj_completed')],
      archived: ['badge-neutral', this.t('proj_archived')]
    };
    const [cls, label] = map[status] || ['badge-neutral', status];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  healthBadge(health) {
    const map = {
      on_track: ['badge-success', this.t('health_on_track')],
      at_risk: ['badge-warning', this.t('health_at_risk')],
      delayed: ['badge-danger', this.t('health_delayed')],
      completed: ['badge-primary', this.t('health_completed')]
    };
    const [cls, label] = map[health] || ['badge-neutral', health];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  roleBadge(role) {
    const map = {
      owner: ['badge-purple', this.t('role_owner')],
      manager: ['badge-primary', this.t('role_manager')],
      employee: ['badge-neutral', this.t('role_employee')]
    };
    const [cls, label] = map[role] || ['badge-neutral', role];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  deadlineBadge(deadlineInfo, rawDeadline) {
    if (!deadlineInfo || deadlineInfo.code === 'no_deadline' || !rawDeadline) {
      return `<span style="color:var(--text-muted);font-size:12px;">${this.bi('بدون موعد', 'No deadline')}</span>`;
    }
    const label = this.lang === 'ar' ? deadlineInfo.labelAr : deadlineInfo.labelEn;
    let cls = 'badge-neutral';
    if (deadlineInfo.isOverdue) cls = 'badge-danger';
    else if (deadlineInfo.code === 'due_today' || deadlineInfo.code === 'due_tomorrow') cls = 'badge-warning';
    else if (deadlineInfo.code === 'completed') cls = 'badge-success';
    return `<span class="badge ${cls}" title="${rawDeadline}">📅 ${rawDeadline} (${label})</span>`;
  }
};

window.WF_I18N.init();
