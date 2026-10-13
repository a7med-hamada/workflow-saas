const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let dbInstance = null;

function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function initDatabase(customDbPath) {
  const dbPath = customDbPath || config.databasePath;
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  const schemaPath = path.resolve(__dirname, '..', 'migrations', '001_initial_schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // Seed canonical permissions catalog
  const perms = [
    ['can_create_projects', 'إنشاء المشاريع', 'Create Projects', 'Ability to create and edit projects'],
    ['can_create_tasks', 'إنشاء المهام', 'Create Tasks', 'Ability to create tasks in projects'],
    ['can_assign_tasks', 'إسناد المهام', 'Assign Tasks', 'Ability to assign or reassign tasks to employees'],
    ['can_delete_tasks', 'حذف المهام', 'Delete Tasks', 'Ability to delete tasks'],
    ['can_approve_work', 'اعتماد ومراجعة الأعمال', 'Approve Completed Work', 'Ability to review and approve or return submitted tasks'],
    ['can_view_team_reports', 'عرض تقارير الفريق', 'View Team Reports', 'Ability to view team and department productivity reports'],
    ['can_manage_employees', 'إدارة الموظفين', 'Manage Employees', 'Ability to invite, create, edit, and deactivate employee accounts'],
    ['can_manage_departments', 'إدارة الأقسام', 'Manage Departments', 'Ability to create, edit, and archive departments'],
    ['can_manage_settings', 'إدارة إعدادات الشركة', 'Manage Company Settings', 'Ability to modify company-wide configuration'],
    ['can_view_audit_logs', 'عرض سجل التدقيق', 'View Audit Logs', 'Ability to inspect company-wide security and activity audit logs']
  ];
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO permissions (code, name_ar, name_en, description) VALUES (?, ?, ?, ?)'
  );
  for (const [code, ar, en, desc] of perms) {
    insertPerm.run(code, ar, en, desc);
  }

  dbInstance = db;
  return db;
}

function getDb() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

function setDb(db) {
  dbInstance = db;
}

function withTransaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  }
}

module.exports = {
  initDatabase,
  getDb,
  setDb,
  withTransaction,
  newId,
  nowIso
};
