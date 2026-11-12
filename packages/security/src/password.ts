import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Password hashing abstraction. Implementations must embed their parameters in the hash string. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP-recommended minimum scrypt parameters (N=2^17, r=8, p=1). Tests may pass cheaper params. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 131072, r: 8, p: 1 };

/**
 * Zero-dependency hasher. Format: scrypt$N$r$p$saltB64$hashB64.
 * Fallback until argon2id (ADR) is installed; see decision log.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p } = this.params;
    const key = await scryptAsync(password.normalize('NFKC'), salt, 32, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    });
    return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (N < 2 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
    const salt = Buffer.from(parts[4] as string, 'base64');
    const expected = Buffer.from(parts[5] as string, 'base64');
    if (expected.length === 0) return false;
    try {
      const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
        N,
        r,
        p,
        maxmem: 256 * N * r,
      });
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
