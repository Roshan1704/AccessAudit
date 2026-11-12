CREATE TYPE "public"."finding_classification" AS ENUM('confirmed', 'strong_potential', 'manual_verification', 'informational');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('html_snippet', 'selector', 'computed_style', 'accessible_name', 'screenshot', 'interaction_trace', 'check_data');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."manual_task_status" AS ENUM('pending', 'passed', 'failed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."page_status" AS ENUM('pending', 'scanned', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."finding_review_status" AS ENUM('open', 'false_positive', 'accepted_risk', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('axe', 'custom', 'interaction');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'serious', 'moderate', 'minor', 'none');--> statement-breakpoint
CREATE TABLE "accessibility_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "rule_source" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"wcag_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"wcag_level" text,
	"default_severity" "finding_severity" NOT NULL,
	"help_url" text,
	"engine_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawled_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"http_status" integer,
	"title" text,
	"status" "page_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"dom_nodes" integer,
	"depth" integer DEFAULT 0 NOT NULL,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawled_pages_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "crawled_pages_scan_url_uq" UNIQUE("scan_id","url")
);
--> statement-breakpoint
CREATE TABLE "finding_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"content" jsonb NOT NULL,
	"blob_base64" text,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"classification" "finding_classification" NOT NULL,
	"confidence" integer NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"wcag_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"message" text NOT NULL,
	"selector" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"review_status" "finding_review_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "findings_scan_fingerprint_uq" UNIQUE("scan_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "manual_verification_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"finding_id" uuid,
	"rule_id" text NOT NULL,
	"instructions" text NOT NULL,
	"status" "manual_task_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"start_url" text NOT NULL,
	"max_pages" integer DEFAULT 10 NOT NULL,
	"wcag_version" text DEFAULT '2.2' NOT NULL,
	"conformance_level" text DEFAULT 'AA' NOT NULL,
	"interaction_tests" boolean DEFAULT true NOT NULL,
	"failure_reason" text,
	"engine_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD CONSTRAINT "crawled_pages_scan_fk" FOREIGN KEY ("organization_id","scan_id") REFERENCES "public"."scans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_evidence" ADD CONSTRAINT "finding_evidence_finding_fk" FOREIGN KEY ("organization_id","finding_id") REFERENCES "public"."findings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_accessibility_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."accessibility_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_fk" FOREIGN KEY ("organization_id","scan_id") REFERENCES "public"."scans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_page_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."crawled_pages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" ADD CONSTRAINT "manual_verification_tasks_rule_id_accessibility_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."accessibility_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" ADD CONSTRAINT "manual_verification_tasks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" ADD CONSTRAINT "manual_tasks_scan_fk" FOREIGN KEY ("organization_id","scan_id") REFERENCES "public"."scans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" ADD CONSTRAINT "manual_tasks_finding_fk" FOREIGN KEY ("organization_id","finding_id") REFERENCES "public"."findings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_fk" FOREIGN KEY ("organization_id","scan_id") REFERENCES "public"."scans"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_evidence_finding_idx" ON "finding_evidence" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "findings_scan_class_idx" ON "findings" USING btree ("scan_id","classification");--> statement-breakpoint
CREATE INDEX "manual_tasks_scan_status_idx" ON "manual_verification_tasks" USING btree ("scan_id","status");--> statement-breakpoint
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scans_project_created_idx" ON "scans" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");--> statement-breakpoint
ALTER TABLE "scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crawled_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crawled_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_verification_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scans" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "crawled_pages" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scan_jobs" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "findings" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finding_evidence" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "manual_verification_tasks" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scans", "crawled_pages", "scan_jobs", "findings", "manual_verification_tasks" TO aa_api;--> statement-breakpoint
GRANT SELECT ON "finding_evidence" TO aa_api;--> statement-breakpoint
GRANT SELECT ON "accessibility_rules" TO aa_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "accessibility_rules" TO aa_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scans", "crawled_pages", "scan_jobs", "findings", "manual_verification_tasks" TO aa_worker;--> statement-breakpoint
GRANT SELECT, INSERT ON "finding_evidence" TO aa_worker;
