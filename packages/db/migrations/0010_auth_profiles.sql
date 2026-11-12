CREATE TABLE "auth_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"login_url" text NOT NULL,
	"username_selector" text NOT NULL,
	"password_selector" text NOT NULL,
	"submit_selector" text NOT NULL,
	"success_selector" text NOT NULL,
	"username_enc" text NOT NULL,
	"password_enc" text NOT NULL,
	"key_id" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_profiles_org_id_uniq" UNIQUE ("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_profiles_project_idx" ON "auth_profiles" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "auth_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "auth_profiles" FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_profiles" TO aa_api;--> statement-breakpoint
GRANT SELECT ON "auth_profiles" TO aa_worker;
