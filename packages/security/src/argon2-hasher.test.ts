import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-hasher.js';

const hasher = new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 2, parallelism: 1 });

describe('Argon2PasswordHasher', () => {
  it('produces an argon2id hash that verifies', async () => {
    const h = await hasher.hash('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(h, 'correct horse battery staple')).toBe(true);
  });

  it('rejects wrong password and malformed hashes without throwing', async () => {
    const h = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(h, 'wrong password here')).toBe(false);
    expect(await hasher.verify('garbage', 'x')).toBe(false);
    expect(await hasher.verify('', 'x')).toBe(false);
  });

  it('salts: same password yields different hashes', async () => {
    expect(await hasher.hash('same-password-123')).not.toBe(await hasher.hash('same-password-123'));
  });
});
