import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { LogMailer } from './infra.js';

describe('LogMailer', () => {
  it('never writes the message body (and therefore no token) to the log', async () => {
    const lines: string[] = [];
    const log = {
      info: (obj: unknown, msg?: string) => {
        lines.push(JSON.stringify({ obj, msg }));
      },
    } as unknown as FastifyBaseLogger;
    const token = 'SECRET-TOKEN-VALUE-123';
    await new LogMailer(log).send({
      to: 'a@example.test',
      subject: 'Reset your password',
      text: `Open https://app.example/reset-password?token=${token}`,
    });
    const out = lines.join('\n');
    expect(out).not.toContain(token);
    expect(out).not.toContain('reset-password');
    expect(out).toContain('a@example.test');
    expect(out).toContain('Reset your password');
  });
});
