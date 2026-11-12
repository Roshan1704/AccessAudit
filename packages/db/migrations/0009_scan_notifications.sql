ALTER TABLE "scans" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
-- Scans that finished before this migration must not trigger a flood of old emails.
UPDATE "scans" SET "notified_at" = now() WHERE "status" IN ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "scans_unnotified_idx" ON "scans" USING btree ("finished_at") WHERE "notified_at" IS NULL AND "status" IN ('completed', 'failed');--> statement-breakpoint
-- The notifier tick must find finished scans across organizations. Only server code that sets app.scheduler can read them; writes still go through the tenant policy.
CREATE POLICY scheduler_select ON "scans" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
