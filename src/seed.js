const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { initDatabase, getDb, withTransaction, newId, nowIso } = require('./db');
const { hashPassword } = require('./auth');
const { logAudit } = require('./audit');
const { createNotification, processCompanyReminders } = require('./notifications');

const DEMO_COMPANY_SLUG = 'namaa-tech-demo';
const DEFAULT_DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';

const STANDARD_DEPARTMENTS = [
  { name: 'قسم تطوير البرمجيات', desc: 'مسؤول عن هندسة المنصة وتطبيقات الويب والجوال والـ API.' },
  { name: 'قسم التسويق الرقمي والنمو', desc: 'مسؤول عن الحملات الإعلانية والمحتوى وتحليلات النمو.' },
  { name: 'قسم العمليات ونجاح العملاء', desc: 'مسؤول عن تأهيل العملاء والدعم الفني وضمان الجودة.' },
  { name: 'قسم التصميم والجرافيك (UI/UX)', desc: 'مسؤول عن الهوية البصرية وتصميم الشعارات وواجهات المستخدم.' },
  { name: 'قسم المبيعات وتطوير الأعمال', desc: 'مسؤول عن التعاقدات، المبيعات، وتوسيع قاعدة العملاء.' },
  { name: 'قسم خدمة العملاء والدعم الفني', desc: 'مسؤول عن الرد على استفسارات العملاء وحل المشكلات الفنية.' },
  { name: 'قسم الموارد البشرية والشؤون الإدارية', desc: 'مسؤول عن التوظيف، شؤون الموظفين، والمتابعة الإدارية.' },
  { name: 'قسم الحسابات والمالية', desc: 'مسؤول عن الفواتير، الرواتب، الميزانيات، والتقارير المالية.' },
  { name: 'قسم صناعة المحتوى والميديا', desc: 'مسؤول عن كتابة المحتوى، الفيديوهات، وإدارة منصات التواصل.' },
  { name: 'قسم ضمان الجودة والاختبارات (QA)', desc: 'مسؤول عن مراجعة جودة المخرجات واختبار الأنظمة قبل التسليم.' },
  { name: 'قسم إدارة المشاريع والتخطيط', desc: 'مسؤول عن جدولة المشاريع وتوزيع المهام ومتابعة الالتزام بالمواعيد.' },
  { name: 'قسم العلاقات العامة والشراكات', desc: 'مسؤول عن التواصل المؤسسي وبناء الشراكات الاستراتيجية.' }
];

function ensureDemoAccountsAndDepartments(db, companyId) {
  const now = nowIso();
  const passwordHash = hashPassword(DEFAULT_DEMO_PASSWORD);

  // 1. Ensure all 12 standard departments exist
  const existingDepts = db.prepare('SELECT id, name FROM departments WHERE company_id = ?').all(companyId);
  const deptByName = new Map(existingDepts.map((d) => [d.name, d.id]));
  const insertDept = db.prepare(`
    INSERT INTO departments (id, company_id, name, description, manager_user_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'active', ?, ?)
  `);
  for (const d of STANDARD_DEPARTMENTS) {
    if (!deptByName.has(d.name)) {
      const id = newId('dep');
      insertDept.run(id, companyId, d.name, d.desc, now, now);
      deptByName.set(d.name, id);
    }
  }

  const defaultDeptId = deptByName.get('قسم تطوير البرمجيات') || existingDepts[0]?.id || null;

  // 2. Ensure core demo accounts (owner, manager, employee) exist and are active so quick demo login buttons always work
  const coreAccounts = [
    {
      email: 'owner@demo.workflow.local',
      name: 'طارق المنصور (Tariq Al-Mansour)',
      role: 'owner',
      code: 'EMP-001',
      title: 'المدير التنفيذي ومالك الشركة',
      dept: null
    },
    {
      email: 'manager@demo.workflow.local',
      name: 'سارة العتيبي (Sara Al-Otaibi)',
      role: 'manager',
      code: 'EMP-098',
      title: 'مديرة هندسة البرمجيات',
      dept: defaultDeptId
    },
    {
      email: 'employee@demo.workflow.local',
      name: 'أحمد الزهراني (Ahmed Al-Zahrani)',
      role: 'employee',
      code: 'EMP-099',
      title: 'مطور واجهات أمامية أول',
      dept: defaultDeptId
    }
  ];

  for (const acc of coreAccounts) {
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(acc.email);
    if (!user) {
      const uid = newId('usr');
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, preferred_language, preferred_theme, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, '+966501000000', 'ar', 'light', 0, ?, ?)
      `).run(uid, acc.email, passwordHash, acc.name, now, now);
      user = { id: uid };
    } else {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    }

    const mem = db.prepare('SELECT * FROM company_memberships WHERE company_id = ? AND user_id = ?').get(companyId, user.id);
    if (!mem) {
      db.prepare(`
        INSERT INTO company_memberships (
          id, company_id, user_id, employee_code, job_title, department_id, manager_user_id,
          role, status, permissions_json, joined_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?)
      `).run(
        newId('mem'),
        companyId,
        user.id,
        acc.code,
        acc.title,
        acc.dept,
        acc.role,
        JSON.stringify(config.defaultRolePermissions[acc.role]),
        now.slice(0, 10),
        now,
        now
      );
    } else if (mem.status !== 'active') {
      db.prepare("UPDATE company_memberships SET status = 'active', updated_at = ? WHERE id = ?").run(now, mem.id);
    }
  }
}

function seedDemoWorkspace({ reset = true } = {}) {
  const db = getDb();

  const existingCompany = db.prepare('SELECT * FROM companies WHERE slug = ?').get(DEMO_COMPANY_SLUG);
  if (existingCompany && !reset) {
    withTransaction(() => {
      ensureDemoAccountsAndDepartments(db, existingCompany.id);
    });
    return {
      company_id: existingCompany.id,
      already_existed: true,
      demo_password: DEFAULT_DEMO_PASSWORD
    };
  }

  return withTransaction(() => {
    if (existingCompany && reset) {
      // Remove previous demo users that belong ONLY to the demo company
      const demoMembers = db.prepare('SELECT user_id FROM company_memberships WHERE company_id = ?').all(existingCompany.id);
      db.prepare('DELETE FROM companies WHERE id = ?').run(existingCompany.id);
      for (const dm of demoMembers) {
        const otherMemberships = db.prepare('SELECT COUNT(*) AS c FROM company_memberships WHERE user_id = ?').get(dm.user_id);
        if (Number(otherMemberships.c) === 0) {
          db.prepare('DELETE FROM users WHERE id = ?').run(dm.user_id);
        }
      }
    }

    const now = nowIso();
    const today = now.slice(0, 10);
    const dayOffset = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const companyId = newId('cmp');
    const ownerId = newId('usr');
    const passwordHash = hashPassword(DEFAULT_DEMO_PASSWORD);

    // 1. Create Demo Company & Settings
    db.prepare(`
      INSERT INTO companies (
        id, name, slug, industry, size, description, brand_color,
        owner_user_id, setup_wizard_completed, subscription_plan, subscription_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '#1d4ed8', ?, 1, 'monthly_pro', 'active', ?, ?)
    `).run(
      companyId,
      'شركة نماء التقنية المتقدمة (Namaa Tech)',
      DEMO_COMPANY_SLUG,
      'تطوير البرمجيات والحلول السحابية',
      '11-50',
      'بيئة عمل تجريبية متكاملة لإدارة المشاريع وفرق العمل وتتبع الإنتاجية.',
      ownerId,
      now,
      now
    );

    db.prepare(`
      INSERT INTO company_settings (
        company_id, timezone, week_start_day, default_language, require_task_approval,
        warn_incomplete_subtasks, allow_employee_personal_tasks, enable_time_tracking, updated_at
      ) VALUES (?, 'Asia/Riyadh', 'sunday', 'ar', 1, 1, 1, 1, ?)
    `).run(companyId, now);

    // Seed company roles
    const insertRole = db.prepare(`
      INSERT INTO roles (id, company_id, code, name_ar, name_en, default_permissions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertRole.run(newId('rol'), companyId, 'owner', 'مالك الشركة / المدير العام', 'Company Owner / Admin', JSON.stringify(config.defaultRolePermissions.owner), now);
    insertRole.run(newId('rol'), companyId, 'manager', 'مدير فريق / مشرف', 'Manager / Team Leader', JSON.stringify(config.defaultRolePermissions.manager), now);
    insertRole.run(newId('rol'), companyId, 'employee', 'موظف', 'Employee', JSON.stringify(config.defaultRolePermissions.employee), now);

    // Helper to create user + membership
    const insertUser = db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, phone, preferred_language, preferred_theme, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT INTO company_memberships (
        id, company_id, user_id, employee_code, job_title, department_id, manager_user_id,
        role, status, permissions_json, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `);

    // 2. Create Owner (1)
    insertUser.run(ownerId, 'owner@demo.workflow.local', passwordHash, 'طارق المنصور (Tariq Al-Mansour)', '+966501000001', now, now);
    insertMember.run(
      newId('mem'), companyId, ownerId, 'EMP-001', 'المدير التنفيذي ومالك الشركة',
      null, null, 'owner', JSON.stringify(config.defaultRolePermissions.owner), dayOffset(-120), now, now
    );

    // 3. Create Managers (2)
    const mgrEngId = newId('usr');
    const mgrMktId = newId('usr');
    insertUser.run(mgrEngId, 'manager@demo.workflow.local', passwordHash, 'سارة العتيبي (Sara Al-Otaibi)', '+966501000002', now, now);
    insertUser.run(mgrMktId, 'khaled@demo.workflow.local', passwordHash, 'خالد الحربي (Khaled Al-Harbi)', '+966501000003', now, now);

    // 4. Create 12 Comprehensive Departments
    const deptEngId = newId('dep');
    const deptMktId = newId('dep');
    const deptOpsId = newId('dep');
    const insertDept = db.prepare(`
      INSERT INTO departments (id, company_id, name, description, manager_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `);
    insertDept.run(deptEngId, companyId, 'قسم تطوير البرمجيات', 'مسؤول عن هندسة المنصة وتطبيقات الويب والجوال والـ API.', mgrEngId, now, now);
    insertDept.run(deptMktId, companyId, 'قسم التسويق الرقمي والنمو', 'مسؤول عن الحملات الإعلانية والمحتوى وتحليلات النمو.', mgrMktId, now, now);
    insertDept.run(deptOpsId, companyId, 'قسم العمليات ونجاح العملاء', 'مسؤول عن تأهيل العملاء والدعم الفني وضمان الجودة.', ownerId, now, now);

    for (const extraDept of STANDARD_DEPARTMENTS.slice(3)) {
      insertDept.run(newId('dep'), companyId, extraDept.name, extraDept.desc, ownerId, now, now);
    }

    insertMember.run(
      newId('mem'), companyId, mgrEngId, 'EMP-002', 'مديرة هندسة البرمجيات',
      deptEngId, ownerId, 'manager', JSON.stringify(config.defaultRolePermissions.manager), dayOffset(-100), now, now
    );
    insertMember.run(
      newId('mem'), companyId, mgrMktId, 'EMP-003', 'مدير التسويق والنمو',
      deptMktId, ownerId, 'manager', JSON.stringify(config.defaultRolePermissions.manager), dayOffset(-95), now, now
    );

    // 5. Create 10 Employees
    const employeesSpec = [
      { email: 'employee@demo.workflow.local', name: 'أحمد الزهراني (Ahmed Al-Zahrani)', title: 'مطور واجهات أمامية أول', dept: deptEngId, mgr: mgrEngId, code: 'EMP-004' },
      { email: 'noor@demo.workflow.local', name: 'نور القحطاني (Noor Al-Qahtani)', title: 'مهندسة برمجيات خلفية', dept: deptEngId, mgr: mgrEngId, code: 'EMP-005' },
      { email: 'omar@demo.workflow.local', name: 'عمر الشهري (Omar Al-Shehri)', title: 'مهندس DevOps وبنية سحابية', dept: deptEngId, mgr: mgrEngId, code: 'EMP-006' },
      { email: 'layla@demo.workflow.local', name: 'ليلى الدوسري (Layla Al-Dosari)', title: 'مصممة تجربة وواجهات المستخدم UI/UX', dept: deptEngId, mgr: mgrEngId, code: 'EMP-007' },
      { email: 'yasser@demo.workflow.local', name: 'ياسر الغامدي (Yasser Al-Ghamdi)', title: 'مهندس ضمان الجودة والاختبارات', dept: deptEngId, mgr: mgrEngId, code: 'EMP-008' },
      { email: 'reem@demo.workflow.local', name: 'ريم الشمري (Reem Al-Shammari)', title: 'أخصائية حملات إعلانية رقمية', dept: deptMktId, mgr: mgrMktId, code: 'EMP-009' },
      { email: 'fahad@demo.workflow.local', name: 'فهد المطيري (Fahad Al-Mutairi)', title: 'كاتب محتوى إبداعي وتقني', dept: deptMktId, mgr: mgrMktId, code: 'EMP-010' },
      { email: 'huda@demo.workflow.local', name: 'هدى السبيعي (Huda Al-Subaie)', title: 'محللة بيانات وتسويق', dept: deptMktId, mgr: mgrMktId, code: 'EMP-011' },
      { email: 'ziad@demo.workflow.local', name: 'زياد العنزي (Ziad Al-Anzi)', title: 'أخصائي تأهيل ونجاح العملاء', dept: deptOpsId, mgr: ownerId, code: 'EMP-012' },
      { email: 'mona@demo.workflow.local', name: 'منى اليامي (Mona Al-Yami)', title: 'مسؤولة العمليات والتقارير', dept: deptOpsId, mgr: ownerId, code: 'EMP-013' }
    ];

    const empIds = [];
    for (const spec of employeesSpec) {
      const uid = newId('usr');
      empIds.push(uid);
      insertUser.run(uid, spec.email, passwordHash, spec.name, '+966501000010', now, now);
      insertMember.run(
        newId('mem'), companyId, uid, spec.code, spec.title,
        spec.dept, spec.mgr, 'employee', JSON.stringify(config.defaultRolePermissions.employee), dayOffset(-60), now, now
      );
    }

    // 6. Create 3 Projects
    const proj1Id = newId('prj');
    const proj2Id = newId('prj');
    const proj3Id = newId('prj');
    const insertProj = db.prepare(`
      INSERT INTO projects (
        id, company_id, name, description, color, manager_user_id, department_id,
        start_date, deadline, priority, status, budget, estimated_hours, visibility, require_approval,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    insertProj.run(
      proj1Id, companyId,
      'إطلاق المنصة السحابية الجيل الثاني (Cloud v2)',
      'تطوير وإطلاق الجيل الثاني من المنصة السحابية مع لوحة تحكم تحليلية فورية وتكامل بوابات الدفع.',
      '#1d4ed8', mgrEngId, deptEngId,
      dayOffset(-20), dayOffset(14), 'urgent', 'active', 120000, 320, 'public', ownerId, now, now
    );

    insertProj.run(
      proj2Id, companyId,
      'حملة التوسع الإقليمي للربع الرابع',
      'تخطيط وتنفيذ الحملة التسويقية الرقمية لاستقطاب 500 شركة صغيرة ومتوسطة في المنطقة.',
      '#0d9488', mgrMktId, deptMktId,
      dayOffset(-15), dayOffset(21), 'high', 'active', 65000, 160, 'public', ownerId, now, now
    );

    insertProj.run(
      proj3Id, companyId,
      'أتمتة نظام تأهيل العملاء الجدد',
      'بناء مسار عمل مؤتمت لتدريب وتأهيل عملاء الشركات الجدد وتقليل وقت التفعيل بنسبة 50%.',
      '#7c3aed', ownerId, deptOpsId,
      dayOffset(-10), dayOffset(30), 'medium', 'active', 40000, 120, 'public', ownerId, now, now
    );

    // Add project members
    const insertPM = db.prepare(`
      INSERT OR IGNORE INTO project_members (id, company_id, project_id, user_id, member_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    [mgrEngId, empIds[0], empIds[1], empIds[2], empIds[3], empIds[4]].forEach((uid, i) => {
      insertPM.run(newId('pm'), companyId, proj1Id, uid, i === 0 ? 'manager' : 'member', now);
    });
    [mgrMktId, empIds[5], empIds[6], empIds[7]].forEach((uid, i) => {
      insertPM.run(newId('pm'), companyId, proj2Id, uid, i === 0 ? 'manager' : 'member', now);
    });
    [ownerId, empIds[8], empIds[9]].forEach((uid, i) => {
      insertPM.run(newId('pm'), companyId, proj3Id, uid, i === 0 ? 'manager' : 'member', now);
    });

    // 7. Create Sample Tasks across all statuses
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, company_id, project_id, department_id, parent_task_id,
        title, description, assignee_user_id, created_by,
        priority, status, progress, start_date, deadline,
        estimated_hours, actual_hours, blocker_reason, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const t1 = newId('tsk');
    const t2 = newId('tsk');
    const t3 = newId('tsk');
    const t4 = newId('tsk');
    const t5 = newId('tsk');
    const t6 = newId('tsk');
    const t7 = newId('tsk');
    const t8 = newId('tsk');
    const t9 = newId('tsk');
    const t10 = newId('tsk');

    // Completed task
    insertTask.run(
      t1, companyId, proj1Id, deptEngId, null,
      'تصميم هيكل قاعدة البيانات متعددة المستأجرين (Multi-Tenant Schema)',
      'بناء الجداول والفهارس وعزل بيانات الشركات بالكامل مع دعم الصلاحيات المخصصة.',
      empIds[1], mgrEngId, 'urgent', 'completed', 100, dayOffset(-15), dayOffset(-5), 16, 15.5, '', dayOffset(-6) + 'T14:00:00.000Z', now, now
    );

    // In Review task (assigned to Ahmed empIds[0])
    insertTask.run(
      t2, companyId, proj1Id, deptEngId, null,
      'تطوير لوحة كانبان التفاعلية بالسحب والإفلات',
      'بناء لوحة كانبان تدعم الحالات المتعددة والفلاتر والعمل السلس على الهاتف وسطح المكتب.',
      empIds[0], mgrEngId, 'high', 'in_review', 95, dayOffset(-8), dayOffset(1), 20, 18, '', null, now, now
    );

    // In Progress task (Due today, assigned to Ahmed empIds[0])
    insertTask.run(
      t3, companyId, proj1Id, deptEngId, null,
      'بناء صفحة مهامي وتجربة الموظف المتجاوبة',
      'تصميم وتنفيذ صفحة مهام الموظف مع التبويبات السريعة وعدادات الإنجاز اليومية.',
      empIds[0], mgrEngId, 'urgent', 'in_progress', 65, dayOffset(-4), today, 12, 8, '', null, now, now
    );

    // Overdue task (assigned to Omar empIds[2])
    insertTask.run(
      t4, companyId, proj1Id, deptEngId, null,
      'إعداد خطوط النشر التلقائي وفحص الأمان السحابي',
      'تكوين بيئة الإنتاج واختبارات الاختراق ومراقبة الأداء.',
      empIds[2], mgrEngId, 'urgent', 'in_progress', 40, dayOffset(-10), dayOffset(-2), 18, 10, '', null, now, now
    );

    // Blocked task (assigned to Yasser empIds[4])
    insertTask.run(
      t5, companyId, proj1Id, deptEngId, null,
      'اختبار التكامل مع بوابة الدفع الإلكتروني',
      'إجراء اختبارات شاملة لعمليات الاشتراك الشهري والسنوي.',
      empIds[4], mgrEngId, 'high', 'blocked', 30, dayOffset(-5), dayOffset(3), 10, 4, 'بانتظار مفاتيح البيئة التجريبية من مزود خدمة الدفع', null, now, now
    );

    // To Do task (assigned to Layla empIds[3])
    insertTask.run(
      t6, companyId, proj1Id, deptEngId, null,
      'مراجعة تباين الألوان للوضع الليلي ودعم RTL الكامل',
      'التأكد من وضوح الجداول والنوافذ المنبثقة في الوضع الداكن واللغة العربية.',
      empIds[3], mgrEngId, 'medium', 'todo', 0, today, dayOffset(4), 8, 0, '', null, now, now
    );

    // Marketing tasks
    insertTask.run(
      t7, companyId, proj2Id, deptMktId, null,
      'إطلاق صفحات الهبوط الإعلانية لحملة الربع الرابع',
      'تجهيز صفحات الهبوط باللغتين العربية والإنجليزية وربط تحليلات التحويل.',
      empIds[5], mgrMktId, 'high', 'completed', 100, dayOffset(-12), dayOffset(-3), 14, 13, '', dayOffset(-3) + 'T11:00:00.000Z', now, now
    );

    insertTask.run(
      t8, companyId, proj2Id, deptMktId, null,
      'كتابة سلسلة مقالات دراسات الحالة للشركات الصغيرة',
      'إعداد 4 مقالات تفصيلية توضح كيف ترفع المنصة إنتاجية الفرق بنسبة 40%.',
      empIds[6], mgrMktId, 'medium', 'in_review', 95, dayOffset(-6), dayOffset(2), 12, 11, '', null, now, now
    );

    // Operations tasks
    insertTask.run(
      t9, companyId, proj3Id, deptOpsId, null,
      'إعداد دليل البدء السريع ومعالج إعداد الشركة',
      'توثيق خطوات تسجيل الشركة وإضافة الأقسام والموظفين والمشاريع الأولى.',
      empIds[8], ownerId, 'high', 'in_progress', 60, dayOffset(-4), dayOffset(2), 10, 6, '', null, now, now
    );

    insertTask.run(
      t10, companyId, proj3Id, deptOpsId, null,
      'تحليل مؤشرات رضا العملاء الشهرية وتصدير التقارير',
      'جمع بيانات التفاعل وتوليد تقارير CSV و Excel للإدارة العليا.',
      empIds[9], ownerId, 'low', 'backlog', 0, dayOffset(1), dayOffset(10), 8, 0, '', null, now, now
    );

    // Subtask under t3
    const sub1 = newId('tsk');
    insertTask.run(
      sub1, companyId, proj1Id, deptEngId, t3,
      'إضافة فلاتر الأولوية والموعد النهائي في صفحة مهامي',
      'مهمة فرعية لتسهيل فرز المهام اليومية للموظف.',
      empIds[0], mgrEngId, 'medium', 'completed', 100, dayOffset(-3), today, 4, 3.5, '', now, now, now
    );

    // Checklist items on t3
    const chkId = newId('chk');
    db.prepare('INSERT INTO task_checklists (id, company_id, task_id, title, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(chkId, companyId, t3, 'خطوات التنفيذ الأساسية', now);
    const insertChkItem = db.prepare(`
      INSERT INTO task_checklist_items (id, company_id, task_id, checklist_id, title, is_completed, is_required, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertChkItem.run(newId('chi'), companyId, t3, chkId, 'تصميم بطاقات الملخص العلوية', 1, 1, now);
    insertChkItem.run(newId('chi'), companyId, t3, chkId, 'ربط تبويبات التصفية مع الـ API', 1, 2, now);
    insertChkItem.run(newId('chi'), companyId, t3, chkId, 'اختبار التجاوب على شاشات الجوال', 0, 3, now);

    // Dependency: t5 depends on t1
    db.prepare(`
      INSERT INTO task_dependencies (id, company_id, task_id, depends_on_task_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('dep'), companyId, t5, t1, now);

    // Sample Comments & Reviews
    db.prepare(`
      INSERT INTO task_comments (id, company_id, task_id, user_id, content, mentions_json, is_edited, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      newId('cmt'), companyId, t2, empIds[0],
      'أنهيت تطوير لوحة كانبان بالكامل مع دعم السحب والإفلات وتغيير الحالة على الجوال، جاهزة للمراجعة @manager@demo.workflow.local',
      JSON.stringify([mgrEngId]), now, now
    );

    db.prepare(`
      INSERT INTO task_reviews (id, company_id, task_id, submitted_by, action, feedback, created_at)
      VALUES (?, ?, ?, ?, 'submitted', 'تم إكمال جميع المتطلبات واختبار الصلاحيات.', ?)
    `).run(newId('rev'), companyId, t2, empIds[0], now);

    // Sample Reference Image (Logo/Mockup) & Reference File from Manager to Employee
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const sampleSvgLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="220" viewBox="0 0 520 220">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e3a8a"/>
          <stop offset="100%" stop-color="#2563eb"/>
        </linearGradient>
      </defs>
      <rect width="520" height="220" rx="20" fill="url(#bg)"/>
      <circle cx="110" cy="110" r="54" fill="#ffffff" fill-opacity="0.15"/>
      <rect x="82" y="82" width="56" height="56" rx="14" fill="#38bdf8"/>
      <path d="M96 112 L107 123 L126 98" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <text x="190" y="102" fill="#ffffff" font-family="Cairo, Arial, sans-serif" font-size="30" font-weight="bold">NAMAA TECH</text>
      <text x="190" y="138" fill="#bfdbfe" font-family="Cairo, Arial, sans-serif" font-size="18">نموذج الشعار والهوية البصرية المرجعية للمهمة</text>
    </svg>`;
    const logoBuffer = Buffer.from(sampleSvgLogo, 'utf8');
    const logoId = newId('att');
    const logoStoredName = `${logoId}_namaa-logo-reference.svg`;
    const logoStoragePath = path.join(config.uploadDir, logoStoredName);
    fs.writeFileSync(logoStoragePath, logoBuffer);

    const briefContent = `توصيف المهمة المرجعي — شركة نماء التقنية
========================================
1. يرجى الالتزام بألوان الهوية البصرية المرفقة في الصورة المرجعية (#2563eb و #1e3a8a).
2. استخدام خط Cairo في جميع العناوين والأزرار والبطاقات.
3. تسليم العمل للمراجعة فور الانتهاء من قائمة الخطوات.`;
    const briefBuffer = Buffer.from(briefContent, 'utf8');
    const briefId = newId('att');
    const briefStoredName = `${briefId}_task-specifications-brief.txt`;
    const briefStoragePath = path.join(config.uploadDir, briefStoredName);
    fs.writeFileSync(briefStoragePath, briefBuffer);

    const insertAtt = db.prepare(`
      INSERT INTO task_attachments (
        id, company_id, task_id, project_id, uploaded_by,
        original_name, stored_name, storage_path, mime_type, extension, size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAtt.run(logoId, companyId, t3, proj1Id, mgrEngId, 'namaa-logo-reference.svg', logoStoredName, logoStoragePath, 'image/svg+xml', '.svg', logoBuffer.length, now);
    insertAtt.run(briefId, companyId, t3, proj1Id, mgrEngId, 'task-specifications-brief.txt', briefStoredName, briefStoragePath, 'text/plain; charset=utf-8', '.txt', briefBuffer.length, now);

    // Sample Daily Work Reports
    db.prepare(`
      INSERT INTO daily_work_reports (
        id, company_id, user_id, department_id, project_id, report_date,
        completed_work, current_work, blockers, next_plan, links_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(
      newId('dwr'), companyId, empIds[0], deptEngId, proj1Id, today,
      'إنجاز لوحة كانبان التفاعلية وإرسالها للمراجعة.',
      'استكمال صفحة مهامي وتجربة الهاتف للموظفين.',
      '',
      'البدء في تحسينات جدول المهام الجماعي والتقويم.',
      now, now
    );

    db.prepare(`
      INSERT INTO daily_work_reports (
        id, company_id, user_id, department_id, project_id, report_date,
        completed_work, current_work, blockers, next_plan, links_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(
      newId('dwr'), companyId, empIds[4], deptEngId, proj1Id, today,
      'كتابة سيناريوهات اختبار سلة الاشتراكات.',
      'مراجعة صلاحيات عزل بيانات الشركات.',
      'بانتظار مفاتيح البيئة التجريبية من مزود خدمة الدفع لاستكمال اختبارات الدفع.',
      'تشغيل حزمة الاختبارات الآلية الشاملة.',
      now, now
    );

    // Audit logs
    logAudit({
      companyId,
      actorUserId: ownerId,
      action: 'company.demo_seeded',
      entityType: 'company',
      entityId: companyId,
      newValues: { projects: 3, departments: 3, employees: 10, managers: 2 }
    });
    logAudit({
      companyId,
      actorUserId: mgrEngId,
      action: 'task.created',
      entityType: 'task',
      entityId: t2,
      newValues: { title: 'تطوير لوحة كانبان التفاعلية بالسحب والإفلات', status: 'in_review' }
    });

    // Notifications
    createNotification({
      companyId,
      userId: mgrEngId,
      type: 'work_submitted_for_review',
      titleAr: 'عمل مرسل للمراجعة والاعتماد',
      titleEn: 'Work Submitted for Review',
      messageAr: 'قام أحمد الزهراني بإرسال المهمة "تطوير لوحة كانبان التفاعلية بالسحب والإفلات" للمراجعة.',
      messageEn: 'Ahmed Al-Zahrani submitted "Kanban Board" for review.',
      entityType: 'task',
      entityId: t2,
      linkUrl: `#/tasks?taskId=${t2}`
    });

    createNotification({
      companyId,
      userId: empIds[0],
      type: 'task_assigned',
      titleAr: 'تم إسناد مهمة إليك',
      titleEn: 'Task Assigned to You',
      messageAr: 'تم إسناد المهمة "بناء صفحة مهامي وتجربة الموظف المتجاوبة" إليك (تستحق اليوم).',
      messageEn: 'You have been assigned to "Build Employee My Tasks Page" (Due today).',
      entityType: 'task',
      entityId: t3,
      linkUrl: `#/tasks?taskId=${t3}`
    });

    processCompanyReminders(companyId);

    return {
      company_id: companyId,
      company_name: 'شركة نماء التقنية المتقدمة (Namaa Tech)',
      accounts: {
        owner: { email: 'owner@demo.workflow.local', role: 'owner', name: 'طارق المنصور' },
        manager: { email: 'manager@demo.workflow.local', role: 'manager', name: 'سارة العتيبي' },
        employee: { email: 'employee@demo.workflow.local', role: 'employee', name: 'أحمد الزهراني' }
      },
      demo_password: DEFAULT_DEMO_PASSWORD
    };
  });
}

if (require.main === module) {
  initDatabase();
  const info = seedDemoWorkspace({ reset: true });
  console.log('Demo workspace seeded successfully:', JSON.stringify(info, null, 2));
}

module.exports = {
  seedDemoWorkspace,
  DEMO_COMPANY_SLUG,
  DEFAULT_DEMO_PASSWORD
};
