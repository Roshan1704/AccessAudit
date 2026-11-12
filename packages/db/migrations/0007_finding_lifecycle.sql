ALTER TABLE "findings" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_assignee_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "finding_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_comments" ADD CONSTRAINT "finding_comments_finding_fk" FOREIGN KEY ("organization_id","finding_id") REFERENCES "public"."findings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_comments" ADD CONSTRAINT "finding_comments_author_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_history" ADD CONSTRAINT "finding_history_finding_fk" FOREIGN KEY ("organization_id","finding_id") REFERENCES "public"."findings"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_history" ADD CONSTRAINT "finding_history_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_comments_finding_idx" ON "finding_comments" USING btree ("finding_id","created_at");--> statement-breakpoint
CREATE INDEX "finding_history_finding_idx" ON "finding_history" USING btree ("finding_id","created_at");--> statement-breakpoint
CREATE INDEX "findings_assignee_idx" ON "findings" USING btree ("assignee_id");--> statement-breakpoint
ALTER TABLE "finding_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finding_comments" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finding_history" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT ON "finding_comments", "finding_history" TO aa_api;
