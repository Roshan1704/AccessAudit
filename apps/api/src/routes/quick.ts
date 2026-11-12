import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, quickCheckSchema } from '@accessaudit/shared';
import { checkUrl } from '@accessaudit/security';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';
import { enforceCsrf } from '../session.js';
import { param, uuidOr404 } from '../util.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function sign(secret: string, salt: string, expires: number): string {
  return createHmac('sha256', secret)
    .update(`${salt}.${String(expires)}`)
    .digest('hex');
}

/** True when sha256(`${challenge}:${nonce}`) starts with at least `bits` zero bits. */
export function powValid(challenge: string, nonce: string, bits: number): boolean {
  const h = createHash('sha256').update(`${challenge}:${nonce}`).digest();
  let remaining = bits;
  for (const byte of h) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
    } else {
      return byte >> (8 - remaining) === 0;
    }
  }
  return remaining <= 0;
}

/**
 * Anonymous one-page check (ADR-026): passive scan only, no crawling, no interaction tests,
 * nothing stored in PostgreSQL. Abuse controls: kill switch, proof of work, one-time signed
 * challenges, per-IP and daily caps, a busy gate, the SSRF gate, and robots.txt in the worker.
 */
export function quickRoutes(app: FastifyInstance, deps: Deps): void {
  const { config } = deps;
  const guard = (): void => {
    if (!config.QUICK_CHECK_ENABLED)
      throw new AppError('FORBIDDEN', 'The quick check is switched off right now.');
  };

  app.get(
    '/quick-check/challenge',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    () => {
      guard();
      const salt = randomBytes(12).toString('hex');
      const expires = deps.now().getTime() + CHALLENGE_TTL_MS;
      return {
        challenge: `${salt}.${String(expires)}.${sign(config.SESSION_COOKIE_SECRET, salt, expires)}`,
        bits: config.QUICK_CHECK_POW_BITS,
      };
    },
  );

  app.post(
    '/quick-check',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      guard();
      enforceCsrf(deps, req, undefined);
      const input = parse(quickCheckSchema, req.body);

      const [salt, exp, mac] = input.challenge.split('.');
      const expires = Number(exp);
      const expected = salt && exp ? sign(config.SESSION_COOKIE_SECRET, salt, expires) : '';
      const macOk =
        mac !== undefined &&
        mac.length === expected.length &&
        timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
      if (!macOk || !Number.isFinite(expires) || expires < deps.now().getTime())
        throw new AppError(
          'VALIDATION_FAILED',
          'The challenge is invalid or expired. Reload and retry.',
        );
      if (!powValid(input.challenge, input.nonce, config.QUICK_CHECK_POW_BITS))
        throw new AppError('VALIDATION_FAILED', 'Proof of work is not valid.');

      const chk = checkUrl(input.url);
      if (!chk.ok)
        throw new AppError('URL_NOT_ALLOWED', 'This URL cannot be checked.', {
          reason: chk.reason,
        });

      if (!(await deps.quick.consumeChallenge(input.challenge, CHALLENGE_TTL_MS / 1000)))
        throw new AppError('VALIDATION_FAILED', 'This challenge was already used.');
      const adm = await deps.quick.admit(req.ip);
      if (!adm.ok) {
        const msg =
          adm.reason === 'ip_limit'
            ? 'Too many quick checks from your network. Try again later, or create an account.'
            : adm.reason === 'daily_cap'
              ? 'The free quick check has reached its daily limit. Try again tomorrow.'
              : 'The checker is busy. Try again in a minute.';
        throw new AppError('RATE_LIMITED', msg, { reason: adm.reason });
      }
      const id = await deps.quick.submit(chk.url.href);
      return reply.status(202).send({ id });
    },
  );

  app.get(
    '/quick-check/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      guard();
      const s = await deps.quick.status(uuidOr404(param(req, 'id')));
      if (s.state === 'unknown') throw new AppError('NOT_FOUND', 'Not found.');
      return s;
    },
  );
}
