import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, Client, type Harness } from './test-harness.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

function leadingZeroBits(h: Buffer): number {
  let bits = 0;
  for (const b of h) {
    if (b === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(b) - 24;
    break;
  }
  return bits;
}

function solve(challenge: string, bits: number): string {
  for (let i = 0; ; i++) {
    const nonce = String(i);
    if (leadingZeroBits(createHash('sha256').update(`${challenge}:${nonce}`).digest()) >= bits)
      return nonce;
  }
}

suite('anonymous quick check (integration)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(url as string);
  });
  afterAll(async () => {
    await h.close();
  });

  async function attempt(
    c: Client,
    target = 'https://example.com/',
    tamper?: (ch: string) => string,
  ) {
    const ch = await c.call('GET', '/quick-check/challenge');
    let challenge = ch.body.challenge as string;
    const nonce = solve(challenge, ch.body.bits as number);
    if (tamper) challenge = tamper(challenge);
    return c.call('POST', '/quick-check', { url: target, challenge, nonce });
  }

  it('accepts a valid proof of work and queues one job without touching PostgreSQL', async () => {
    const c = new Client(h.app);
    const r = await attempt(c);
    expect(r.status).toBe(202);
    expect(h.quick.submitted).toContain('https://example.com/');
    const s = await c.call('GET', `/quick-check/${r.body.id as string}`);
    expect(s.body.state).toBe('pending');
  });

  it('rejects a bad nonce, a forged challenge and a replayed challenge', async () => {
    const c = new Client(h.app);
    const ch = await c.call('GET', '/quick-check/challenge');
    const challenge = ch.body.challenge as string;
    let bad = 0;
    while (
      leadingZeroBits(
        createHash('sha256')
          .update(`${challenge}:bad${String(bad)}`)
          .digest(),
      ) >= 8
    )
      bad++;
    const wrong = await c.call('POST', '/quick-check', {
      url: 'https://example.com/',
      challenge,
      nonce: `bad${String(bad)}`,
    });
    expect(wrong.status).toBe(400);

    const forged = await attempt(c, 'https://example.com/', (x) =>
      x.replace(/.$/, (d) => (d === '0' ? '1' : '0')),
    );
    expect(forged.status).toBe(400);

    const nonce = solve(challenge, ch.body.bits as number);
    const ok = await c.call('POST', '/quick-check', {
      url: 'https://example.com/',
      challenge,
      nonce,
    });
    expect(ok.status).toBe(202);
    const replay = await c.call('POST', '/quick-check', {
      url: 'https://example.com/',
      challenge,
      nonce,
    });
    expect(replay.status).toBe(400);
  });

  it('refuses private targets and cross-origin posts', async () => {
    const c = new Client(h.app);
    for (const target of ['http://127.0.0.1/', 'https://169.254.169.254/', 'https://localhost/']) {
      const r = await attempt(c, target);
      expect(r.status, target).toBe(422);
    }
    const ch = await c.call('GET', '/quick-check/challenge');
    const r = await c.call(
      'POST',
      '/quick-check',
      { url: 'https://example.com/', challenge: ch.body.challenge, nonce: '0' },
      { origin: 'https://evil.example' },
    );
    expect(r.status).toBe(403);
  });

  it('enforces the per-IP limit and the busy gate', async () => {
    const c = new Client(h.app);
    h.quick.limit = 1;
    expect((await attempt(c)).status).toBe(202);
    expect((await attempt(c)).status).toBe(429);
    h.quick.limit = 5;
    h.quick.busy = true;
    const other = new Client(h.app);
    const r = await attempt(other);
    expect(r.status).toBe(429);
    h.quick.busy = false;
  });

  it('returns 404 for unknown job ids', async () => {
    const c = new Client(h.app);
    const r = await c.call('GET', `/quick-check/${crypto.randomUUID()}`);
    expect(r.status).toBe(404);
  });
});
