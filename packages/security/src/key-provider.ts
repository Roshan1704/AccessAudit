export interface KeyProvider {
  readonly keyId: string;
  getKey(keyId?: string): Buffer;
}

/** Dev/test implementation reading a base64 key from configuration (ADR-010). Production uses a KMS-backed provider. */
export class EnvKeyProvider implements KeyProvider {
  readonly keyId: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(keyId: string, base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
    this.keyId = keyId;
    this.keys.set(keyId, key);
  }

  getKey(keyId: string = this.keyId): Buffer {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown key id: ${keyId}`);
    return key;
  }
}
