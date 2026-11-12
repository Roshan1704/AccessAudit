import argon2 from 'argon2';
import type { PasswordHasher } from './password.js';

export interface Argon2Params {
  memoryCost: number; // KiB
  timeCost: number;
  parallelism: number;
}

/** OWASP minimum-class argon2id parameters (19 MiB, t=2, p=1). Tests may pass cheaper params. */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly params: Argon2Params = DEFAULT_ARGON2_PARAMS) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password.normalize('NFKC'), { type: argon2.argon2id, ...this.params });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password.normalize('NFKC'));
    } catch {
      return false;
    }
  }
}
