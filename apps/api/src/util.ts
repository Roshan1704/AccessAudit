import { AppError } from '@accessaudit/shared';
import type { FastifyRequest } from 'fastify';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed ids are indistinguishable from unknown ids. */
export function uuidOr404(value: string | undefined): string {
  if (value === undefined || !UUID_RE.test(value)) throw new AppError('NOT_FOUND', 'Not found.');
  return value.toLowerCase();
}

export function param(req: FastifyRequest, name: string): string | undefined {
  const p = req.params as Record<string, string | undefined> | undefined;
  return p?.[name];
}
