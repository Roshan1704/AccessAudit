CREATE TABLE "scan_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"max_pages" integer DEFAULT 10 NOT NULL,
	"wcag_version" text DEFAULT '2.2' NOT NULL,
	"conformance_level" text DEFAULT 'AA' NOT NULL,
	"interaction_tests" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_scan_id" uuid,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_schedules_frequency_chk" CHECK ("frequency" IN ('daily', 'weekly')),
	CONSTRAINT "scan_schedules_max_pages_chk" CHECK ("max_pages" BETWEEN 1 AND 50)
);
--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_schedules_project_idx" ON "scan_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scan_schedules_due_idx" ON "scan_schedules" USING btree ("next_run_at") WHERE "enabled";--> statement-breakpoint
ALTER TABLE "scan_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scan_schedules" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
-- The scheduler tick must find due schedules across organizations. Only server code that sets app.scheduler can read them; the policy grants no write access.
CREATE POLICY scheduler_select ON "scan_schedules" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "scan_schedules" TO aa_api;
