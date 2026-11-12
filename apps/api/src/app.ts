import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from './deps.js';
import { registerErrorHandling } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { compareRoutes } from './routes/compare.js';
import { domainRoutes } from './routes/domains.js';
import { healthRoutes } from './routes/health.js';
import { orgRoutes } from './routes/orgs.js';
import { overviewRoutes } from './routes/overview.js';
import { reportRoutes } from './routes/reports.js';
import { scheduleRoutes } from './routes/schedules.js';
import { authProfileRoutes } from './routes/auth-profiles.js';
import { projectRoutes } from './routes/projects.js';
import { quickRoutes } from './routes/quick.js';
import { scanRoutes } from './routes/scans.js';

export interface BuildOptions {
  /** Log level; use 'silent' in tests. Defaults to deps.config.LOG_LEVEL. */
  logLevel?: string;
}

export async function buildApp(deps: Deps, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? deps.config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
        ],
        censor: '[redacted]',
      },
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });

  app.addHook('onSend', (req, reply, _payload, done) => {
    void reply.header('x-request-id', req.id);
    done();
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: deps.config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
  });
  await app.register(cookie);
  // Per-route limits (config.rateLimit) only; in-memory, per process (documented tech debt).
  await app.register(rateLimit, { global: false });

  registerErrorHandling(app, deps.errorReporter);

  healthRoutes(app, deps);
  authRoutes(app, deps);
  orgRoutes(app, deps);
  projectRoutes(app, deps);
  domainRoutes(app, deps);
  scanRoutes(app, deps);
  compareRoutes(app, deps);
  reportRoutes(app, deps);
  scheduleRoutes(app, deps);
  authProfileRoutes(app, deps);
  overviewRoutes(app, deps);
  quickRoutes(app, deps);

  return app;
}
