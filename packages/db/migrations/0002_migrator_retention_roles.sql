-- Adds the two roles documented in DATABASE_DESIGN.md that 0001 did not create.
-- No passwords here (no secrets in migrations); the environment bootstrap sets LOGIN and credentials.
--
-- aa_migrator: owner/DDL role. Created NOLOGIN; the bootstrap grants LOGIN and ownership of the schema.
-- aa_retention: the only role allowed to delete audit_logs rows, and only by DELETE (never UPDATE/TRUNCATE).
--
-- Rollback (forward-only policy; manual reversal if ever required, before aa_retention is used):
--   DROP POLICY retention_delete ON audit_logs;
--   REVOKE ALL ON audit_logs FROM aa_retention; REVOKE USAGE ON SCHEMA public FROM aa_retention;
--   restore audit_logs_immutable() body from 0001; DROP ROLE aa_retention; DROP ROLE aa_migrator;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aa_migrator') THEN
    CREATE ROLE aa_migrator NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aa_retention') THEN
    CREATE ROLE aa_retention NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO aa_retention;
--> statement-breakpoint
GRANT SELECT, DELETE ON audit_logs TO aa_retention;
--> statement-breakpoint

-- Retention works across organizations, so it needs its own policy; it can only see and delete.
CREATE POLICY retention_select ON audit_logs FOR SELECT TO aa_retention USING (true);
--> statement-breakpoint
CREATE POLICY retention_delete ON audit_logs FOR DELETE TO aa_retention USING (true);
--> statement-breakpoint

-- Row deletes stay blocked for everyone except aa_retention; updates and truncate are blocked for all.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND current_user = 'aa_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'restrict_violation';
END $$;
