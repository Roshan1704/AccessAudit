import { z } from 'zod';
import { Roles, VerificationMethods } from './roles.js';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Length over composition rules (NIST 800-63B style).
export const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export const recoveryRequestSchema = z.object({ email: emailSchema }).strict();
export const recoveryConfirmSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema })
  .strict();

export const createOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
        'Use lowercase letters, digits and hyphens (3-40 chars).',
      ),
  })
  .strict();

export const inviteSchema = z
  .object({ email: emailSchema, role: z.enum(['admin', 'member', 'viewer']) })
  .strict();

export const changeRoleSchema = z.object({ role: z.enum(Roles) }).strict();

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().pipe(z.url().max(2048)),
  })
  .strict();

export const updateProjectSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

export const addDomainSchema = z
  .object({
    hostname: z.string().trim().toLowerCase().min(1).max(253),
    method: z.enum(VerificationMethods),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type AddDomainInput = z.infer<typeof addDomainSchema>;

export const startScanSchema = z
  .object({
    projectId: z.uuid(),
    /** Defaults to the project's base URL. Must be on a verified domain of the project. */
    startUrl: z.string().trim().pipe(z.url().max(2048)).optional(),
    maxPages: z.number().int().min(1).max(50).default(10),
    wcagVersion: z.enum(['2.0', '2.1', '2.2']).default('2.2'),
    level: z.enum(['A', 'AA', 'AAA']).default('AA'),
    interactionTests: z.boolean().default(true),
    /** Log in first with this stored profile (ADR-031). Must belong to the same project. */
    authProfileId: z.uuid().optional(),
    /** Ignore robots.txt. Admin only, needs a written reason, audited (ADR-018). */
    robotsOverride: z
      .object({ reason: z.string().trim().min(10).max(500) })
      .strict()
      .optional(),
  })
  .strict();

/** Form-login recipe plus credentials. Credentials are write-only: never returned (ADR-031). */
export const createAuthProfileSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    loginUrl: z.string().trim().pipe(z.url().max(2048)),
    usernameSelector: z.string().trim().min(1).max(300),
    passwordSelector: z.string().trim().min(1).max(300),
    submitSelector: z.string().trim().min(1).max(300),
    /** Element that exists only when logged in; login counts as failed when it is absent. */
    successSelector: z.string().trim().min(1).max(300),
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(256),
  })
  .strict();

export const reviewFindingSchema = z
  .object({ status: z.enum(['open', 'false_positive', 'accepted_risk', 'fixed']) })
  .strict();

/** Review status and/or assignee; at least one field is required. `assigneeId: null` unassigns. */
export const updateFindingSchema = z
  .object({
    status: z.enum(['open', 'false_positive', 'accepted_risk', 'fixed']).optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: 'Provide status or assigneeId.',
  });

export const findingCommentSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

export const resolveTaskSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'not_applicable']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export type StartScanInput = z.infer<typeof startScanSchema>;

/** Recurring scan settings (ADR-027). Never carries a robots override: schedules respect robots.txt. */
export const createScheduleSchema = z
  .object({
    projectId: z.uuid(),
    frequency: z.enum(['daily', 'weekly']),
    maxPages: z.number().int().min(1).max(50).default(10),
    wcagVersion: z.enum(['2.0', '2.1', '2.2']).default('2.2'),
    level: z.enum(['A', 'AA', 'AAA']).default('AA'),
    interactionTests: z.boolean().default(true),
  })
  .strict();

export const updateScheduleSchema = z
  .object({ enabled: z.boolean().optional(), frequency: z.enum(['daily', 'weekly']).optional() })
  .strict()
  .refine((v) => v.enabled !== undefined || v.frequency !== undefined, {
    message: 'Provide enabled or frequency.',
  });
