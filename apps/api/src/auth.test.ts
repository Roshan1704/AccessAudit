import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  makeHarness,
  ORIGIN,
  PASSWORD,
  registerUser,
  type Harness,
} from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('auth (integration, aa_api)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  it('health endpoints respond', async () => {
    expect((await h.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await h.app.inject({ url: '/readyz' })).statusCode).toBe(200);
  });

  it('registers, sets hardened cookies, and /auth/me works', async () => {
    const c = new Client(h.app);
    const email = `reg-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: ORIGIN },
      remoteAddress: c.ip,
      payload: { email, password: PASSWORD, name: 'Reg' },
    });
    expect(res.statusCode).toBe(201);
    const sess = res.cookies.find((x) => x.name === 'aa_session');
    expect(sess).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(res.cookies.find((x) => x.name === 'aa_csrf')?.httpOnly).not.toBe(true);
    expect(res.body).not.toContain('passwordHash');
    c.setSession(sess?.value);
    const me = await c.call('GET', '/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.organizations).toEqual([]);
  });

  it('rejects duplicate email with a generic conflict', async () => {
    const u = await registerUser(h.app, 'dup');
    const r = await new Client(h.app).call('POST', '/auth/register', {
      email: u.email,
      password: PASSWORD,
      name: 'x',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONFLICT');
    expect(JSON.stringify(r.body)).not.toMatch(/already registered|exists/i);
  });

  it('validates input: short password, unknown fields, bad email', async () => {
    const c = new Client(h.app);
    const short = await c.call('POST', '/auth/register', {
      email: 'a@example.test',
      password: 'short',
      name: 'x',
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_FAILED');
    const extra = await c.call('POST', '/auth/register', {
      email: 'b@example.test',
      password: PASSWORD,
      name: 'x',
      role: 'owner',
    });
    expect(extra.status).toBe(400);
    const bad = await c.call('POST', '/auth/register', {
      email: 'nope',
      password: PASSWORD,
      name: 'x',
    });
    expect(bad.status).toBe(400);
  });

  it('rejects mutations from a foreign or missing Origin', async () => {
    const c = new Client(h.app);
    const r = await c.call(
      'POST',
      '/auth/login',
      { email: 'a@example.test', password: PASSWORD },
      { origin: 'https://evil.test' },
    );
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_FAILED');
    const none = await c.call(
      'POST',
      '/auth/login',
      { email: 'a@example.test', password: PASSWORD },
      { origin: null },
    );
    expect(none.status).toBe(403);
  });

  it('requires the CSRF token on authenticated mutations', async () => {
    const u = await registerUser(h.app, 'csrf');
    const noToken = await u.c.call(
      'POST',
      '/orgs',
      { name: 'No Token', slug: 'no-token-org' },
      { csrf: null },
    );
    expect(noToken.status).toBe(403);
    const wrong = await u.c.call(
      'POST',
      '/orgs',
      { name: 'Wrong', slug: 'wrong-token-org' },
      { csrf: 'x'.repeat(30) },
    );
    expect(wrong.status).toBe(403);
  });

  it('unauthenticated requests get 401', async () => {
    const c = new Client(h.app);
    expect((await c.call('GET', '/auth/me')).status).toBe(401);
    expect((await c.call('GET', '/orgs')).status).toBe(401);
  });

  it('login: success rotates the session; wrong password is generic and indistinguishable from unknown user', async () => {
    const u = await registerUser(h.app, 'login');
    const c = new Client(h.app);
    const wrong = await c.call('POST', '/auth/login', {
      email: u.email,
      password: 'wrong wrong wrong 1',
    });
    const unknown = await c.call('POST', '/auth/login', {
      email: 'ghost@example.test',
      password: 'wrong wrong wrong 1',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);

    const ok = await c.call('POST', '/auth/login', {
      email: u.email.toUpperCase(),
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    const first = c.sessionCookie;
    const again = await c.call('POST', '/auth/login', { email: u.email, password: PASSWORD });
    expect(again.status).toBe(200);
    expect(c.sessionCookie).not.toBe(first);
    // the presented session was revoked on re-login
    const stale = new Client(h.app);
    stale.setSession(first);
    expect((await stale.call('GET', '/auth/me')).status).toBe(401);
  });

  it('locks the account after repeated failures, and the lock expires', async () => {
    const u = await registerUser(h.app, 'lock');
    const c = new Client(h.app);
    for (let i = 0; i < 5; i++) {
      expect(
        (await c.call('POST', '/auth/login', { email: u.email, password: 'bad bad bad bad 9' }))
          .status,
      ).toBe(401);
    }
    // correct password is now refused too
    expect(
      (await c.call('POST', '/auth/login', { email: u.email, password: PASSWORD })).status,
    ).toBe(401);
    h.clock.now = new Date(Date.now() + 16 * 60 * 1000);
    try {
      expect(
        (await c.call('POST', '/auth/login', { email: u.email, password: PASSWORD })).status,
      ).toBe(200);
    } finally {
      h.clock.now = new Date();
    }
  });

  it('logout revokes the session server-side', async () => {
    const u = await registerUser(h.app, 'logout');
    const stolen = u.c.sessionCookie;
    const r = await u.c.call('POST', '/auth/logout');
    expect(r.status).toBe(204);
    const replay = new Client(h.app);
    replay.setSession(stolen);
    expect((await replay.call('GET', '/auth/me')).status).toBe(401);
  });

  it('sessions expire (idle 24h, absolute 7d)', async () => {
    const u = await registerUser(h.app, 'expiry');
    try {
      h.clock.now = new Date(Date.now() + 25 * 3600 * 1000);
      expect((await u.c.call('GET', '/auth/me')).status).toBe(401);
    } finally {
      h.clock.now = new Date();
    }
    const v = await registerUser(h.app, 'expiry2');
    try {
      // stay active every 20h so idle never trips; absolute limit still ends it
      for (let day = 1; day <= 6; day++) {
        h.clock.now = new Date(Date.now() + day * 20 * 3600 * 1000);
        if (day * 20 < 168) expect((await v.c.call('GET', '/auth/me')).status).toBe(200);
      }
      h.clock.now = new Date(Date.now() + 169 * 3600 * 1000);
      expect((await v.c.call('GET', '/auth/me')).status).toBe(401);
    } finally {
      h.clock.now = new Date();
    }
  });

  it('recovery: always 202, token single-use, expires, revokes sessions, new password works', async () => {
    const u = await registerUser(h.app, 'recover');
    const anon = new Client(h.app);
    const unknown = await anon.call('POST', '/auth/recovery/request', {
      email: 'nobody@example.test',
    });
    expect(unknown.status).toBe(202);
    const before = h.mails.length;
    const known = await anon.call('POST', '/auth/recovery/request', { email: u.email });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(h.mails.length).toBe(before + 1);
    const token = /token=([\w-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const newPw = 'a brand new passphrase 42';
    expect(
      (await anon.call('POST', '/auth/recovery/confirm', { token, password: newPw })).status,
    ).toBe(200);
    expect(
      (await anon.call('POST', '/auth/recovery/confirm', { token, password: newPw })).status,
    ).toBe(400);
    // old sessions revoked, old password dead, new password works
    expect((await u.c.call('GET', '/auth/me')).status).toBe(401);
    expect(
      (await anon.call('POST', '/auth/login', { email: u.email, password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (await anon.call('POST', '/auth/login', { email: u.email, password: newPw })).status,
    ).toBe(200);
  });

  it('recovery token expires after 1h', async () => {
    const u = await registerUser(h.app, 'recover-exp');
    const anon = new Client(h.app);
    await anon.call('POST', '/auth/recovery/request', { email: u.email });
    const token = /token=([\w-]+)/.exec(h.mails[h.mails.length - 1]?.text ?? '')?.[1] ?? '';
    h.clock.now = new Date(Date.now() + 61 * 60 * 1000);
    try {
      const r = await anon.call('POST', '/auth/recovery/confirm', {
        token,
        password: 'another long passphrase 7',
      });
      expect(r.status).toBe(400);
    } finally {
      h.clock.now = new Date();
    }
  });

  it('rate limits auth endpoints per client', async () => {
    const c = new Client(h.app);
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const r = await c.call('POST', '/auth/login', {
        email: 'rl@example.test',
        password: 'whatever whatever 1',
      });
      if (r.status === 429) {
        limited++;
        expect(r.body.error.code).toBe('RATE_LIMITED');
      }
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('unknown routes return the structured 404', async () => {
    const r = await new Client(h.app).call('GET', '/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(typeof r.body.error.requestId).toBe('string');
  });
});
