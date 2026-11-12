-- Roles, grants, row-level security and integrity triggers.
-- Login credentials for aa_api / aa_worker are NOT set here (no secrets in migrations);
-- the environment bootstrap runs: ALTER ROLE aa_api LOGIN PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aa_api') THEN
    CREATE ROLE aa_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aa_worker') THEN
    CREATE ROLE aa_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

-- Helpers: current tenant / user from transaction-local settings. Unset or empty => NULL => no rows.
CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Grants (least privilege).
GRANT USAGE ON SCHEMA public TO aa_api, aa_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_id(), app_user_id() TO aa_api, aa_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users TO aa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions, password_reset_tokens TO aa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON organizations, projects, project_settings TO aa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members, invitations, authorized_domains TO aa_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO aa_api;
--> statement-breakpoint
-- Worker: no access to users, sessions, reset tokens or invitations.
GRANT SELECT ON organizations, projects, project_settings TO aa_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON authorized_domains TO aa_worker;
--> statement-breakpoint
GRANT INSERT ON audit_logs TO aa_worker;
--> statement-breakpoint

-- Row-level security.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE authorized_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE authorized_domains FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Members: visible within the active org, or the caller's own rows (to list "my organizations").
CREATE POLICY members_select ON organization_members FOR SELECT
  USING (organization_id = app_org_id() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY members_write ON organization_members FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint

-- Organizations: the active org, or any org the caller is a member of (read).
CREATE POLICY orgs_select ON organizations FOR SELECT
  USING (id = app_org_id()
      OR id IN (SELECT organization_id FROM organization_members WHERE user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY orgs_insert ON organizations FOR INSERT WITH CHECK (id = app_org_id());
--> statement-breakpoint
CREATE POLICY orgs_update ON organizations FOR UPDATE
  USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint

CREATE POLICY tenant_isolation ON invitations FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON projects FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_settings FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON authorized_domains FOR ALL
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint

-- audit_logs are append-only.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint

-- An organization must always keep at least one owner (checked at commit).
CREATE FUNCTION enforce_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id)
     AND NOT EXISTS (SELECT 1 FROM organization_members
                     WHERE organization_id = OLD.organization_id AND role = 'owner') THEN
    RAISE EXCEPTION 'organization must retain at least one owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER organization_members_last_owner
  AFTER UPDATE OR DELETE ON organization_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_last_owner();
