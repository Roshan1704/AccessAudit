import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './password.js';

const hasher = new ScryptPasswordHasher({ N: 1024, r: 8, p: 1 });

describe('ScryptPasswordHasher', () => {
  it('verifies the correct password', async () => {
    const h = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(h, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const h = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(h, 'wrong password here')).toBe(false);
  });

  it('salts: same password yields different hashes', async () => {
    const a = await hasher.hash('same-password-123');
    const b = await hasher.hash('same-password-123');
    expect(a).not.toBe(b);
  });

  it('never contains the plaintext', async () => {
    const h = await hasher.hash('plaintext-secret-xyz');
    expect(h).not.toContain('plaintext-secret-xyz');
  });

  it('rejects malformed or out-of-bounds hashes without throwing', async () => {
    expect(await hasher.verify('', 'x')).toBe(false);
    expect(await hasher.verify('scrypt$1$1$1$a$b', 'x')).toBe(false);
    expect(await hasher.verify('bcrypt$1024$8$1$AA==$AA==', 'x')).toBe(false);
    expect(await hasher.verify('scrypt$99999999$8$1$AA==$AA==', 'x')).toBe(false);
  });
});
