import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedPayload } from '../types/encryption.js';
import { CryptoError } from './errors.js';

/** AES-256-GCM initialization vector length in bytes. */
const IV_LENGTH = 12;

/** Required AES-256 key length in bytes. */
const KEY_LENGTH = 32;

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * A unique 12-byte IV is generated internally via `randomBytes(12)` on every
 * call. The IV is NEVER a parameter -- this is by design to prevent IV reuse.
 *
 * @param plaintext - Raw data to encrypt (Buffer).
 * @param key - 32-byte AES-256 key (Buffer). Throws if not exactly 32 bytes.
 * @param keyId - Key identifier stored in the output payload for key ring lookup.
 * @param aad - Optional additional authenticated data (authenticated but not encrypted).
 * @returns An {@link EncryptedPayload} with base64-encoded ciphertext, iv, auth_tag, and key_id.
 * @throws {CryptoError} If the key is not 32 bytes or encryption fails.
 */
export function encrypt(
  plaintext: Buffer,
  key: Buffer,
  keyId: string,
  aad?: Buffer,
): EncryptedPayload {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(
      `Encryption key must be exactly 32 bytes, got ${key.length}`,
    );
  }

  try {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    if (aad !== undefined) {
      cipher.setAAD(aad);
    }

    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: authTag.toString('base64'),
      key_id: keyId,
    };
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError('Encryption failed');
  }
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 *
 * @param payload - The {@link EncryptedPayload} produced by {@link encrypt}.
 * @param key - 32-byte AES-256 key (Buffer). Must match the key used for encryption.
 * @param aad - Optional additional authenticated data. Must match the AAD used during encryption.
 * @returns The original plaintext as a Buffer.
 * @throws {CryptoError} If the key is wrong, data has been tampered with, or AAD mismatches.
 */
export function decrypt(
  payload: EncryptedPayload,
  key: Buffer,
  aad?: Buffer,
): Buffer {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(
      `Decryption key must be exactly 32 bytes, got ${key.length}`,
    );
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');
    const authTag = Buffer.from(payload.auth_tag, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    if (aad !== undefined) {
      decipher.setAAD(aad);
    }

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError('Decryption failed: authentication tag mismatch or corrupted data');
  }
}
