import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-provider.js';

const VERSION = 'v1';

/**
 * AES-256-GCM envelope for stored credentials (ADR-010, ADR-031). The output is
 * `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts). The key id is bound as additional
 * authenticated data together with a caller-supplied context, so a ciphertext cannot be moved to
 * another record or field and still decrypt.
 */
export function sealSecret(keys: KeyProvider, plaintext: string, context: string): string {
  const keyId = keys.keyId;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.getKey(keyId), iv);
  cipher.setAAD(Buffer.from(`${keyId}|${context}`));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [VERSION, keyId, iv, cipher.getAuthTag(), ct].map((p) =>
    typeof p === 'string' ? p : p.toString('base64url'),
  );
  return parts.join('.');
}

export function openSecret(keys: KeyProvider, sealed: string, context: string): string {
  const [version, keyId, iv, tag, ct] = sealed.split('.');
  if (version !== VERSION || !keyId || !iv || !tag || ct === undefined)
    throw new Error('Malformed sealed secret');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keys.getKey(keyId),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(`${keyId}|${context}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}
