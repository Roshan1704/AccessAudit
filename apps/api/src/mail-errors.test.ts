import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { HttpMailer, WebhookErrorReporter } from './infra.js';
import { registerErrorHandling } from './errors.js';
import type { ErrorReporter } from './deps.js';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, calls: Call[]) {
  return (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: status >= 200 && status < 300, status });
  };
}

describe('HttpMailer', () => {
  const cfg = {
    url: 'https://mail.example.com/send',
    apiKey: 'key-0123456789',
    from: 'A <a@x.io>',
  };

  it('posts the message with a bearer key', async () => {
    const calls: Call[] = [];
    await new HttpMailer(cfg, fakeFetch(202, calls)).send({
      to: 'u@example.com',
      subject: 'Hi',
      text: 'body',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(cfg.url);
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer key-0123456789',
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      from: cfg.from,
      to: 'u@example.com',
      subject: 'Hi',
      text: 'body',
    });
  });

  it('rejects when the provider answers an error, without leaking the body', async () => {
    const mailer = new HttpMailer(cfg, fakeFetch(500, []));
    await expect(
      mailer.send({ to: 'u@example.com', subject: 'Reset', text: 'secret-token' }),
    ).rejects.toThrow('mail provider answered 500');
  });
});

describe('error reporting', () => {
  it('webhook reporter sends the error and swallows transport failures', async () => {
    const calls: Call[] = [];
    const ctx = { requestId: 'r1', method: 'GET', url: '/x' };
    await new WebhookErrorReporter('https://hook.example.com', 'svc', fakeFetch(200, calls)).report(
      new Error('boom'),
      ctx,
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      service: 'svc',
      message: 'boom',
      requestId: 'r1',
    });
    const failing = new WebhookErrorReporter('https://hook.example.com', 'svc', () =>
      Promise.reject(new Error('network')),
    );
    await expect(failing.report(new Error('x'), ctx)).resolves.toBeUndefined();
  });

  it('the error handler reports unhandled errors only, not client errors', async () => {
    const seen: string[] = [];
    const reporter: ErrorReporter = {
      report: (err) => {
        seen.push((err as Error).message);
        return Promise.resolve();
      },
    };
    const app = Fastify({ logger: false });
    registerErrorHandling(app, reporter);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.post('/bad', { schema: { body: { type: 'object', required: ['a'] } } }, () => 'ok');
    expect((await app.inject({ url: '/boom' })).statusCode).toBe(500);
    expect((await app.inject({ method: 'POST', url: '/bad', payload: {} })).statusCode).toBe(400);
    expect(seen).toEqual(['kaboom']);
    await app.close();
  });
});
