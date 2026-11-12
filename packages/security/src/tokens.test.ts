import { describe, expect, it } from 'vitest';
import { EnvKeyProvider } from './key-provider.js';
import { generateToken, hashToken, safeEqualHex } from './tokens.js';

describe('tokens', () => {
  it('generates distinct url-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes deterministically and never returns the token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares hashes in constant time and rejects mismatches and bad input', () => {
    const h = hashToken('x');
    expect(safeEqualHex(h, hashToken('x'))).toBe(true);
    expect(safeEqualHex(h, hashToken('y'))).toBe(false);
    expect(safeEqualHex(h, 'abcd')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });
});

describe('EnvKeyProvider', () => {
  it('rejects keys that are not 32 bytes', () => {
    expect(() => new EnvKeyProvider('k1', Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('returns the key by id and rejects unknown ids', () => {
    const p = new EnvKeyProvider('k1', Buffer.alloc(32, 7).toString('base64'));
    expect(p.getKey().length).toBe(32);
    expect(() => p.getKey('nope')).toThrow();
  });
});
