const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Load .env if present
const envFile = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.ALLOW_DEMO !== 'false',
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(ROOT_DIR, process.env.DATABASE_PATH)
    : IS_SERVERLESS
      ? path.join(os.tmpdir(), 'workflow.sqlite')
      : path.join(ROOT_DIR, 'data', 'workflow.sqlite'),
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(ROOT_DIR, process.env.UPLOAD_DIR)
    : IS_SERVERLESS
      ? path.join(os.tmpdir(), 'uploads')
      : path.join(ROOT_DIR, 'storage', 'uploads'),
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 10),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 168),
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  authRateLimitMaxAttempts: Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || 50),
  reminderIntervalMs: Number(process.env.REMINDER_INTERVAL_MS || 60 * 1000),
  smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  allowedExtensions: new Set([
    '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv',
    '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif',
    '.zip', '.txt', '.pptx', '.ppt'
  ]),
  allowedMimePrefixes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument',
    'application/msword',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ],
  defaultRolePermissions: {
    owner: {
      can_create_projects: true,
      can_create_tasks: true,
      can_assign_tasks: true,
      can_delete_tasks: true,
      can_approve_work: true,
      can_view_team_reports: true,
      can_manage_employees: true,
      can_manage_departments: true,
      can_manage_settings: true,
      can_view_audit_logs: true
    },
    manager: {
      can_create_projects: true,
      can_create_tasks: true,
      can_assign_tasks: true,
      can_delete_tasks: false,
      can_approve_work: true,
      can_view_team_reports: true,
      can_manage_employees: true,
      can_manage_departments: false,
      can_manage_settings: false,
      can_view_audit_logs: false
    },
    employee: {
      can_create_projects: false,
      can_create_tasks: false,
      can_assign_tasks: false,
      can_delete_tasks: false,
      can_approve_work: false,
      can_view_team_reports: false,
      can_manage_employees: false,
      can_manage_departments: false,
      can_manage_settings: false,
      can_view_audit_logs: false
    }
  }
};

module.exports = config;
