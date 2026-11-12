import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer']);
export const verificationMethodEnum = pgEnum('verification_method', [
  'dns_txt',
  'well_known',
  'meta_tag',
]);
export const domainStatusEnum = pgEnum('domain_status', [
  'pending',
  'verified',
  'failed',
  'expired',
  'revoked',
]);
export const actorTypeEnum = pgEnum('actor_type', ['user', 'api_key', 'system']);
export const interactionPolicyEnum = pgEnum('interaction_policy', [
  'read_only',
  'approved_workflows',
]);

// ---------------------------------------------------------------- identity (not tenant-owned)

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(), // stored lower-cased by the application; unique index is on lower(email)
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: id(),
    sessionHash: text('session_hash').notNull(),
    csrfHash: text('csrf_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('user_sessions_hash_uq').on(t.sessionHash),
    index('user_sessions_user_idx').on(t.userId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('password_reset_tokens_hash_uq').on(t.tokenHash),
    index('prt_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------- tenancy

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    settings: jsonb('settings').notNull().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('organizations_slug_uq').on(t.slug)],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('org_members_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('invitations_token_hash_uq').on(t.tokenHash),
    index('invitations_org_idx').on(t.organizationId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    // RESTRICT, not CASCADE: audit history is append-only and must not vanish with an organization.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt)],
);

// ---------------------------------------------------------------- projects

export const projects = pgTable(
  'projects',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('projects_org_id_uq').on(t.organizationId, t.id),
    uniqueIndex('projects_org_name_uq')
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const projectSettings = pgTable(
  'project_settings',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').primaryKey(),
    wcagVersion: text('wcag_version').notNull().default('2.2'),
    conformanceLevel: text('conformance_level').notNull().default('AA'),
    crawlConfig: jsonb('crawl_config').notNull().default({}),
    interactionPolicy: interactionPolicyEnum('interaction_policy').notNull().default('read_only'),
    aiEnabled: boolean('ai_enabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'project_settings_project_fk',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
  ],
);

export const authorizedDomains = pgTable(
  'authorized_domains',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    hostname: text('hostname').notNull(),
    verificationMethod: verificationMethodEnum('verification_method').notNull(),
    status: domainStatusEnum('status').notNull().default('pending'),
    tokenHash: text('token_hash').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    nextRevalidateAt: timestamp('next_revalidate_at', { withTimezone: true }),
    failedChecks: integer('failed_checks').notNull().default(0),
    lastFailureReason: text('last_failure_reason'),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'authorized_domains_project_fk',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    unique('authorized_domains_project_host_uq').on(t.projectId, t.hostname),
    unique('authorized_domains_token_hash_uq').on(t.tokenHash),
    index('authorized_domains_revalidate_idx').on(t.status, t.nextRevalidateAt),
  ],
);

// ---------------------------------------------------------------- scanning (Phase 2)

export const scanStatusEnum = pgEnum('scan_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const pageStatusEnum = pgEnum('page_status', ['pending', 'scanned', 'failed', 'skipped']);
export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export const ruleSourceEnum = pgEnum('rule_source', ['axe', 'custom', 'interaction']);
/** How sure the engine is. Only `confirmed` may be presented as a violation. */
export const classificationEnum = pgEnum('finding_classification', [
  'confirmed',
  'strong_potential',
  'manual_verification',
  'informational',
]);
export const severityEnum = pgEnum('finding_severity', [
  'critical',
  'serious',
  'moderate',
  'minor',
  'none',
]);
export const reviewStatusEnum = pgEnum('finding_review_status', [
  'open',
  'false_positive',
  'accepted_risk',
  'fixed',
]);
export const evidenceKindEnum = pgEnum('evidence_kind', [
  'html_snippet',
  'selector',
  'computed_style',
  'accessible_name',
  'screenshot',
  'interaction_trace',
  'check_data',
]);
export const manualStatusEnum = pgEnum('manual_task_status', [
  'pending',
  'passed',
  'failed',
  'not_applicable',
]);

/** Global rule catalogue (not tenant-owned): WCAG 2.2 mapping for every rule the engine can emit. */
export const accessibilityRules = pgTable('accessibility_rules', {
  id: text('id').primaryKey(), // e.g. axe:color-contrast, custom:focus-visible
  source: ruleSourceEnum('source').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  wcagCriteria: text('wcag_criteria')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  wcagLevel: text('wcag_level'), // A | AA | AAA | null (best practice)
  defaultSeverity: severityEnum('default_severity').notNull(),
  helpUrl: text('help_url'),
  engineVersion: text('engine_version').notNull(),
  updatedAt: updatedAt(),
});

export const scans = pgTable(
  'scans',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    status: scanStatusEnum('status').notNull().default('queued'),
    startUrl: text('start_url').notNull(),
    maxPages: integer('max_pages').notNull().default(10),
    wcagVersion: text('wcag_version').notNull().default('2.2'),
    conformanceLevel: text('conformance_level').notNull().default('AA'),
    interactionTests: boolean('interaction_tests').notNull().default(true),
    failureReason: text('failure_reason'),
    engineVersions: jsonb('engine_versions').notNull().default({}),
    /** Per-scan options fixed at creation, e.g. robotsOverride { reason, by } (ADR-018). */
    configSnapshot: jsonb('config_snapshot').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set once the completion/failure email was sent (ADR-028). */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'scans_project_fk',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    unique('scans_org_id_uq').on(t.organizationId, t.id),
    index('scans_project_created_idx').on(t.projectId, t.createdAt),
    index('scans_status_idx').on(t.status),
  ],
);

export const crawledPages = pgTable(
  'crawled_pages',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    scanId: uuid('scan_id').notNull(),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    httpStatus: integer('http_status'),
    title: text('title'),
    status: pageStatusEnum('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    domNodes: integer('dom_nodes'),
    depth: integer('depth').notNull().default(0),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'crawled_pages_scan_fk',
      columns: [t.organizationId, t.scanId],
      foreignColumns: [scans.organizationId, scans.id],
    }).onDelete('cascade'),
    unique('crawled_pages_org_id_uq').on(t.organizationId, t.id),
    unique('crawled_pages_scan_url_uq').on(t.scanId, t.url),
  ],
);

/** Durable mirror of queue work, so progress and failures survive a Redis restart. */
export const scanJobs = pgTable(
  'scan_jobs',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    scanId: uuid('scan_id').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'scan_jobs_scan_fk',
      columns: [t.organizationId, t.scanId],
      foreignColumns: [scans.organizationId, scans.id],
    }).onDelete('cascade'),
    index('scan_jobs_status_idx').on(t.status),
  ],
);

/** Recurring scan definition (ADR-027). The scheduler creates ordinary scans from it. */
export const scanSchedules = pgTable(
  'scan_schedules',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    frequency: text('frequency').notNull(),
    maxPages: integer('max_pages').notNull().default(10),
    wcagVersion: text('wcag_version').notNull().default('2.2'),
    conformanceLevel: text('conformance_level').notNull().default('AA'),
    interactionTests: boolean('interaction_tests').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastScanId: uuid('last_scan_id'),
    lastError: text('last_error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'scan_schedules_project_fk',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    index('scan_schedules_project_idx').on(t.projectId),
  ],
);

/** Stored login recipe for authenticated scanning. Credentials are AES-256-GCM sealed (ADR-031); never selected into API responses. */
export const authProfiles = pgTable(
  'auth_profiles',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    loginUrl: text('login_url').notNull(),
    usernameSelector: text('username_selector').notNull(),
    passwordSelector: text('password_selector').notNull(),
    submitSelector: text('submit_selector').notNull(),
    successSelector: text('success_selector').notNull(),
    usernameEnc: text('username_enc').notNull(),
    passwordEnc: text('password_enc').notNull(),
    keyId: text('key_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('auth_profiles_org_id_uniq').on(t.organizationId, t.id),
    foreignKey({
      name: 'auth_profiles_project_fk',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    index('auth_profiles_project_idx').on(t.projectId),
  ],
);

export const findings = pgTable(
  'findings',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    scanId: uuid('scan_id').notNull(),
    pageId: uuid('page_id').notNull(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => accessibilityRules.id),
    /** Stable hash of rule + normalised selector + page path; dedupes within a scan. */
    fingerprint: text('fingerprint').notNull(),
    classification: classificationEnum('classification').notNull(),
    /** Ranking aid 0-100, not a probability. */
    confidence: integer('confidence').notNull(),
    severity: severityEnum('severity').notNull(),
    wcagCriteria: text('wcag_criteria')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    message: text('message').notNull(),
    selector: text('selector'),
    occurrences: integer('occurrences').notNull().default(1),
    reviewStatus: reviewStatusEnum('review_status').notNull().default('open'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'findings_scan_fk',
      columns: [t.organizationId, t.scanId],
      foreignColumns: [scans.organizationId, scans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'findings_page_fk',
      columns: [t.organizationId, t.pageId],
      foreignColumns: [crawledPages.organizationId, crawledPages.id],
    }).onDelete('cascade'),
    unique('findings_org_id_uq').on(t.organizationId, t.id),
    unique('findings_scan_fingerprint_uq').on(t.scanId, t.fingerprint),
    index('findings_scan_class_idx').on(t.scanId, t.classification),
    index('findings_assignee_idx').on(t.assigneeId),
  ],
);

export const findingComments = pgTable(
  'finding_comments',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    findingId: uuid('finding_id').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'finding_comments_finding_fk',
      columns: [t.organizationId, t.findingId],
      foreignColumns: [findings.organizationId, findings.id],
    }).onDelete('cascade'),
    index('finding_comments_finding_idx').on(t.findingId, t.createdAt),
  ],
);

/** Append-only lifecycle trail (status and assignment). The API role has no UPDATE or DELETE. */
export const findingHistory = pgTable(
  'finding_history',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    findingId: uuid('finding_id').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // status | assignee
    fromValue: text('from_value'),
    toValue: text('to_value'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'finding_history_finding_fk',
      columns: [t.organizationId, t.findingId],
      foreignColumns: [findings.organizationId, findings.id],
    }).onDelete('cascade'),
    index('finding_history_finding_idx').on(t.findingId, t.createdAt),
  ],
);

export const findingEvidence = pgTable(
  'finding_evidence',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    findingId: uuid('finding_id').notNull(),
    kind: evidenceKindEnum('kind').notNull(),
    /** Structured evidence (snippet, styles, trace steps). Every finding needs at least one row. */
    content: jsonb('content').notNull(),
    /** Binary evidence such as a PNG screenshot, base64. */
    blobBase64: text('blob_base64'),
    contentType: text('content_type'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'finding_evidence_finding_fk',
      columns: [t.organizationId, t.findingId],
      foreignColumns: [findings.organizationId, findings.id],
    }).onDelete('cascade'),
    index('finding_evidence_finding_idx').on(t.findingId),
  ],
);

export const manualVerificationTasks = pgTable(
  'manual_verification_tasks',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    scanId: uuid('scan_id').notNull(),
    findingId: uuid('finding_id'),
    ruleId: text('rule_id')
      .notNull()
      .references(() => accessibilityRules.id),
    instructions: text('instructions').notNull(),
    status: manualStatusEnum('status').notNull().default('pending'),
    note: text('note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'manual_tasks_scan_fk',
      columns: [t.organizationId, t.scanId],
      foreignColumns: [scans.organizationId, scans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'manual_tasks_finding_fk',
      columns: [t.organizationId, t.findingId],
      foreignColumns: [findings.organizationId, findings.id],
    }).onDelete('cascade'),
    index('manual_tasks_scan_status_idx').on(t.scanId, t.status),
  ],
);
