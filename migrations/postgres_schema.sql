-- WorkFlow Production PostgreSQL Schema with Row-Level Security (RLS)
-- Reference migration for external PostgreSQL deployments

CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    industry VARCHAR(128) DEFAULT '',
    size VARCHAR(64) DEFAULT '',
    description TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    brand_color VARCHAR(32) DEFAULT '#1d4ed8',
    owner_user_id VARCHAR(64),
    setup_wizard_completed SMALLINT DEFAULT 0,
    subscription_plan VARCHAR(64) DEFAULT 'free_trial',
    subscription_status VARCHAR(64) DEFAULT 'active',
    seat_limit INTEGER DEFAULT 50,
    project_limit INTEGER DEFAULT 100,
    storage_limit_mb INTEGER DEFAULT 1024,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row-Level Security (RLS) for multi-tenant tables in PostgreSQL
-- Using session variable: app.current_company_id
-- Example policy applied to tenant-scoped tables:
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation_projects ON projects
--   USING (company_id = current_setting('app.current_company_id', true));
