import { auditLogs, type Tx } from '@accessaudit/db';
import type { FastifyRequest } from 'fastify';
import type { Deps } from './deps.js';
import { keyedHash } from './session.js';

const SENSITIVE = /pass|token|secret|hash|cookie/i;

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !SENSITIVE.test(k)));
}

export async function writeAudit(
  deps: Deps,
  tx: Tx,
  req: FastifyRequest,
  entry: {
    orgId: string;
    actorId: string | null;
    action: string;
    targetType?: string | undefined;
    targetId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: entry.orgId,
    actorType: entry.actorId ? 'user' : 'system',
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: redact(entry.metadata ?? {}),
    requestId: req.id,
    ipHash: keyedHash(deps, req.ip),
  });
}
