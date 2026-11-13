import { describe, expect, it } from 'vitest';
import { EnvKeyProvider } from './key-provider.js';
import { openSecret, sealSecret } from './secret-box.js';

const keys = new EnvKeyProvider('k1', Buffer.alloc(32, 1).toString('base64'));

describe('secret box', () => {
  it('round-trips and never contains the plaintext', () => {
    const sealed = sealSecret(keys, 'hunter2-password', 'p1:password');
    expect(sealed).not.toContain('hunter2');
    expect(openSecret(keys, sealed, 'p1:password')).toBe('hunter2-password');
  });

  it('uses a fresh IV each time', () => {
    expect(sealSecret(keys, 'x', 'c')).not.toBe(sealSecret(keys, 'x', 'c'));
  });

  it('rejects a different context, tampering and malformed input', () => {
    const sealed = sealSecret(keys, 'secret', 'p1:password');
    expect(() => openSecret(keys, sealed, 'p2:password')).toThrow();
    const parts = sealed.split('.');
    parts[4] = Buffer.from('tampered-bytes').toString('base64url');
    expect(() => openSecret(keys, parts.join('.'), 'p1:password')).toThrow();
    expect(() => openSecret(keys, 'garbage', 'p1:password')).toThrow('Malformed sealed secret');
  });
});

describe('secret box key rotation', () => {
  const k1 = Buffer.alloc(32, 1);
  const k2 = Buffer.alloc(32, 2);
  const ring = (current: string) => ({
    keyId: current,
    getKey(id: string = current): Buffer {
      if (id === 'k1') return k1;
      if (id === 'k2') return k2;
      throw new Error(`Unknown key id: ${id}`);
    },
  });

  it('opens old ciphertext after the current key changes; new ciphertext uses the new key', () => {
    const old = sealSecret(ring('k1'), 'pw', 'c');
    expect(openSecret(ring('k2'), old, 'c')).toBe('pw');
    const fresh = sealSecret(ring('k2'), 'pw', 'c');
    expect(fresh.split('.')[1]).toBe('k2');
    expect(() => openSecret({ keyId: 'k1', getKey: () => k1 }, fresh, 'c')).toThrow();
  });
});
