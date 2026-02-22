/**
 * Base error class for all cryptographic operation failures.
 * Subclasses provide specific failure modes for caller-friendly error handling.
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Thrown when vault authentication fails — wrong passphrase causes
 * AES-256-GCM auth tag mismatch during key ring decryption.
 * Never includes the passphrase or key material in the error message.
 */
export class VaultAuthenticationError extends CryptoError {
  constructor() {
    super('Vault authentication failed');
    this.name = 'VaultAuthenticationError';
  }
}

/**
 * Thrown when the key ring file is malformed, corrupted, or has been tampered with.
 * The vault should fail hard — no silent degradation or recovery attempts.
 */
export class KeyRingCorruptedError extends CryptoError {
  constructor() {
    super('Key ring file is corrupted or has been tampered with');
    this.name = 'KeyRingCorruptedError';
  }
}

/**
 * Thrown when a requested key_id is not found in the key ring.
 * Typically occurs when decrypting a historical entry whose key was
 * somehow removed (should never happen with the retention-forever policy).
 */
export class KeyNotFoundError extends CryptoError {
  constructor(keyId: string) {
    super(`Key not found in key ring: ${keyId}`);
    this.name = 'KeyNotFoundError';
  }
}
