import { z } from 'zod';

/** BullMQ queue that carries scan work from the API to the worker. */
export const SCAN_QUEUE = 'scan';

/**
 * Queue payloads carry identifiers only, never URLs or options. The worker re-reads the scan
 * under the stated organization's row-level-security scope, so a forged payload cannot reach
 * another tenant's data or change what is scanned.
 */
export const scanJobPayload = z.object({ orgId: z.uuid(), scanId: z.uuid() }).strict();
export type ScanJobPayload = z.infer<typeof scanJobPayload>;

/** Anonymous one-page check. The job carries the URL because nothing is stored in the database. */
export const QUICK_QUEUE = 'quick-check';
export const quickJobPayload = z.object({ url: z.string().max(2048) }).strict();
export type QuickJobPayload = z.infer<typeof quickJobPayload>;

export interface QuickFinding {
  ruleId: string;
  ruleTitle: string;
  classification: 'confirmed' | 'strong_potential' | 'manual_verification' | 'informational';
  confidence: number;
  severity: string;
  wcagCriteria: string[];
  message: string;
  selector: string | null;
  occurrences: number;
  evidence: { kind: string; content: Record<string, unknown> }[];
}

/** Result held in the queue backend for a few minutes only. Never written to PostgreSQL. */
export type QuickResult =
  | {
      status: 'done';
      url: string;
      finalUrl: string;
      title: string;
      findings: QuickFinding[];
      manualTasks: { ruleId: string; instructions: string }[];
      coverage: { interaction: boolean; note: string };
      engine: { engine: string; axe: string };
    }
  | { status: 'blocked'; reason: string };

export const quickCheckSchema = z
  .object({
    url: z.string().trim().pipe(z.url().max(2048)),
    challenge: z.string().min(10).max(500),
    nonce: z.string().min(1).max(40),
  })
  .strict();
