import { AppError, httpStatusForCode, type ApiErrorBody } from '@accessaudit/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { ZodType, output } from 'zod';
import type { ErrorReporter } from './deps.js';

export function parse<S extends ZodType>(schema: S, data: unknown): output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Request validation failed.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Walks the `cause` chain (drizzle wraps driver errors). */
export function findCause<T>(err: unknown, pred: (e: unknown) => e is T): T | undefined {
  for (let x: unknown = err, i = 0; x !== undefined && x !== null && i < 8; i++) {
    if (pred(x)) return x;
    x = (x as { cause?: unknown }).cause;
  }
  return undefined;
}

export const pgCode = (err: unknown): string | undefined =>
  findCause(
    err,
    (e): e is { code: string } =>
      typeof (e as { code?: unknown }).code === 'string' &&
      /^[0-9A-Z]{5}$/.test((e as { code: string }).code),
  )?.code;

export const messageMatches = (err: unknown, re: RegExp): boolean =>
  findCause(err, (e): e is Error => e instanceof Error && re.test(e.message)) !== undefined;

export function registerErrorHandling(app: FastifyInstance, reporter?: ErrorReporter): void {
  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = {
      error: { code: 'NOT_FOUND', message: 'Not found.', requestId: req.id },
    };
    void reply.status(404).send(body);
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    let code: ApiErrorBody['error']['code'] = 'INTERNAL';
    let message = 'Internal server error.';
    let details: unknown;
    const statusCode = (err as FastifyError).statusCode;

    if (err instanceof AppError) {
      code = err.code;
      message = err.message;
      details = err.details;
    } else if ((err as FastifyError).statusCode === 429) {
      code = 'RATE_LIMITED';
      message = 'Too many requests. Try again later.';
    } else if (pgCode(err) === '23505') {
      code = 'CONFLICT';
      message = 'Resource already exists.';
    } else if (messageMatches(err, /at least one owner/)) {
      code = 'CONFLICT';
      message = 'An organization must keep at least one owner.';
    } else if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      code = 'VALIDATION_FAILED';
      message = 'Malformed request.';
    }

    if (code === 'INTERNAL') {
      req.log.error({ err }, 'unhandled error');
      // Fire and forget; the response must not wait on the tracker.
      void reporter
        ?.report(err, { requestId: req.id, method: req.method, url: req.routeOptions.url ?? '' })
        .catch(() => undefined);
    }
    const body: ApiErrorBody = {
      error: { code, message, requestId: req.id, ...(details !== undefined ? { details } : {}) },
    };
    void reply.status(httpStatusForCode[code]).send(body);
  });
}
