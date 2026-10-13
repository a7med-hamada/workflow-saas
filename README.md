# WorkFlow — Multi-Tenant SaaS Project Management & Employee Task Tracking System

**WorkFlow (وورك فلو)** is a production-oriented, multi-tenant SaaS web application for managing company projects, assigning tasks to employees, tracking deadlines, reviewing submitted work, and measuring team productivity.

---

## 1. Architecture & Technology Stack

- **Backend Runtime:** Node.js (v22.5+ / v24+ built-in `node:http`, `node:sqlite`, `node:crypto`, `node:test`)
- **Database Engine:**
  - **Local / Default:** Relational SQLite (`node:sqlite` `DatabaseSync`) with WAL mode (`PRAGMA journal_mode = WAL`), strict foreign keys (`PRAGMA foreign_keys = ON`), ACID transactions (`BEGIN IMMEDIATE`), and indexed multi-tenant tables (`migrations/001_initial_schema.sql`).
  - **External Production Option:** PostgreSQL schema with Row-Level Security (RLS) policies provided in `migrations/postgres_schema.sql`.
- **Authentication & Security:**
  - `crypto.scryptSync` salted password hashing with constant-time `crypto.timingSafeEqual` verification.
  - Database-backed session tokens (`sessions` table) via `HttpOnly; SameSite=Lax` cookies and `Authorization: Bearer` headers.
  - Server-side Role-Based Access Control (`owner`, `manager`, `employee`) + granular custom permissions (`can_create_projects`, `can_create_tasks`, `can_assign_tasks`, `can_delete_tasks`, `can_approve_work`, `can_view_team_reports`, `can_manage_employees`).
  - Strict `company_id` tenant isolation enforced on every API route and SQL query.
  - Private disk file attachment storage (`storage/uploads/<company_id>/`) protected by authenticated download endpoints.
- **Frontend:**
  - Responsive Single-Page Application (SPA) with **Arabic (RTL)** as primary language and full **English (LTR)** support.
  - **Light & Dark themes** with persisted user preferences.

---

## 2. Environment Variables Configuration

Copy `.env.example` to `.env` to customize your environment:

```bash
cp .env.example .env
```

Key variables in `.env.example`:
- `PORT=3000` / `HOST=127.0.0.1`
- `NODE_ENV=development` (`production` disables development token helpers and demo seeding)
- `DATABASE_PATH=./data/workflow.sqlite`
- `UPLOAD_DIR=./storage/uploads`
- `MAX_UPLOAD_SIZE_MB=10`
- `REMINDER_INTERVAL_MS=60000`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (Optional external email provider for live invitation and password-reset emails)

---

## 3. Database Setup & Migrations

Migrations in [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql) run automatically on server startup via [`src/db.js`](src/db.js).
For external PostgreSQL production deployments, apply [`migrations/postgres_schema.sql`](migrations/postgres_schema.sql).

---

## 4. Demo Seed Instructions (Development Only)

Real customer registrations (`POST /api/auth/register`) **always** start with an empty employee list, empty department list, empty project list, and empty task list.

To create or reset the isolated development demo company (**شركة نماء التقنية المتقدمة — Namaa Tech**) containing 1 owner, 2 managers, 10 employees, 3 departments, 3 projects, and sample tasks across all statuses:

```powershell
.\seed.cmd
# or with standard Node on PATH:
npm run seed
```

You can also click **"Seed & Load Demo Workspace"** directly on the Login page in development mode.

---

## 5. Starting the Application

```powershell
.\start.cmd
# or with standard Node on PATH:
npm start
```

Then open `http://127.0.0.1:3000` in your browser.

---

## 6. Running Automated Tests

The test suite in [`tests/workflow.test.js`](tests/workflow.test.js) tests authentication, multi-tenancy isolation, RBAC & custom permissions, task management, overdue calculation, cancelled task exclusion, circular dependency detection, review/approval workflows, deduplicated notifications, private file uploads, reporting/exports, and the complete 20-step end-to-end acceptance scenario:

```powershell
.\test.cmd
# or with standard Node on PATH:
npm test
```

---

## 7. Production Deployment Notes

1. Set `NODE_ENV=production` and configure a strong `SESSION_SECRET`.
2. Mount persistent volumes for `DATABASE_PATH` (or connect to PostgreSQL) and `UPLOAD_DIR` (`./storage/uploads`).
3. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` to enable live transactional emails for employee invitations and password resets.
4. Background deadline and overdue reminders run automatically inside the Node server process (`setInterval` every `REMINDER_INTERVAL_MS`) and can also be triggered by an external cron job calling `POST /api/reminders/process`.
