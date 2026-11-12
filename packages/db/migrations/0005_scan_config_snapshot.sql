ALTER TABLE "scans" ADD COLUMN "config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- The rule catalogue is seeded by the migrator (db:seed-rules); the worker only reads it.
REVOKE INSERT, UPDATE ON "accessibility_rules" FROM aa_worker;--> statement-breakpoint
GRANT INSERT, UPDATE ON "accessibility_rules" TO aa_migrator;
