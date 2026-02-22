import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../../src/encryption/aes.js';
import { CryptoError } from '../../src/encryption/errors.js';
import type { EncryptedPayload } from '../../src/types/encryption.js';

describe('AES-256-GCM encrypt/decrypt', () => {
  const key = randomBytes(32);
  const keyId = 'test-key-001';
  const plaintext = Buffer.from('sensitive patient data');

  // 1. encrypt returns an EncryptedPayload with ciphertext, iv, auth_tag (all base64), and key_id
  it('encrypt returns an EncryptedPayload with base64-encoded fields and key_id', () => {
    const payload = encrypt(plaintext, key, keyId);

    expect(payload).toHaveProperty('ciphertext');
    expect(payload).toHaveProperty('iv');
    expect(payload).toHaveProperty('auth_tag');
    expect(payload).toHaveProperty('key_id');
    expect(payload.key_id).toBe(keyId);

    // Verify all fields are valid base64
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    expect(payload.ciphertext).toMatch(base64Regex);
    expect(payload.iv).toMatch(base64Regex);
    expect(payload.auth_tag).toMatch(base64Regex);

    // IV should be 12 bytes (16 chars in base64)
    expect(Buffer.from(payload.iv, 'base64').length).toBe(12);
    // Auth tag should be 16 bytes
    expect(Buffer.from(payload.auth_tag, 'base64').length).toBe(16);
  });

  // 2. encrypt + decrypt round-trip produces identical plaintext
  it('encrypt + decrypt round-trip produces identical plaintext', () => {
    const payload = encrypt(plaintext, key, keyId);
    const decrypted = decrypt(payload, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  // 3. Each encrypt call produces a different IV
  it('each encrypt call produces a different IV', () => {
    const payload1 = encrypt(plaintext, key, keyId);
    const payload2 = encrypt(plaintext, key, keyId);
    expect(payload1.iv).not.toBe(payload2.iv);
  });

  // 4. decrypt with wrong key throws (auth tag mismatch)
  it('decrypt with wrong key throws CryptoError', () => {
    const payload = encrypt(plaintext, key, keyId);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(payload, wrongKey)).toThrow(CryptoError);
  });

  // 5. decrypt with tampered ciphertext throws
  it('decrypt with tampered ciphertext throws CryptoError', () => {
    const payload = encrypt(plaintext, key, keyId);
    const tamperedCiphertext = Buffer.from(payload.ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...payload,
      ciphertext: tamperedCiphertext.toString('base64'),
    };
    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  // 6. decrypt with tampered auth_tag throws
  it('decrypt with tampered auth_tag throws CryptoError', () => {
    const payload = encrypt(plaintext, key, keyId);
    const tamperedTag = Buffer.from(payload.auth_tag, 'base64');
    tamperedTag[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...payload,
      auth_tag: tamperedTag.toString('base64'),
    };
    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  // 7. decrypt with tampered IV throws (produces wrong plaintext, auth tag fails)
  it('decrypt with tampered IV throws CryptoError', () => {
    const payload = encrypt(plaintext, key, keyId);
    const tamperedIv = Buffer.from(payload.iv, 'base64');
    tamperedIv[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...payload,
      iv: tamperedIv.toString('base64'),
    };
    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  // 8. encrypt with AAD + decrypt with same AAD succeeds
  it('encrypt with AAD + decrypt with same AAD succeeds', () => {
    const aad = Buffer.from('patient-id:abc-123');
    const payload = encrypt(plaintext, key, keyId, aad);
    const decrypted = decrypt(payload, key, aad);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  // 9. encrypt with AAD + decrypt with different AAD throws
  it('encrypt with AAD + decrypt with different AAD throws CryptoError', () => {
    const aad = Buffer.from('patient-id:abc-123');
    const differentAad = Buffer.from('patient-id:xyz-789');
    const payload = encrypt(plaintext, key, keyId, aad);
    expect(() => decrypt(payload, key, differentAad)).toThrow(CryptoError);
  });

  // 10. encrypt with AAD + decrypt without AAD throws
  it('encrypt with AAD + decrypt without AAD throws CryptoError', () => {
    const aad = Buffer.from('patient-id:abc-123');
    const payload = encrypt(plaintext, key, keyId, aad);
    expect(() => decrypt(payload, key)).toThrow(CryptoError);
  });

  // 11. encrypt without AAD + decrypt with AAD throws
  it('encrypt without AAD + decrypt with AAD throws CryptoError', () => {
    const aad = Buffer.from('patient-id:abc-123');
    const payload = encrypt(plaintext, key, keyId);
    expect(() => decrypt(payload, key, aad)).toThrow(CryptoError);
  });

  // 12. key must be exactly 32 bytes -- encrypt with 16-byte key throws CryptoError
  it('encrypt with 16-byte key throws CryptoError', () => {
    const shortKey = randomBytes(16);
    expect(() => encrypt(plaintext, shortKey, keyId)).toThrow(CryptoError);
    expect(() => encrypt(plaintext, shortKey, keyId)).toThrow(
      /key must be exactly 32 bytes/,
    );
  });

  // 13. encrypt handles empty plaintext without error
  it('encrypt handles empty plaintext (Buffer.alloc(0)) without error', () => {
    const empty = Buffer.alloc(0);
    const payload = encrypt(empty, key, keyId);
    const decrypted = decrypt(payload, key);
    expect(decrypted.length).toBe(0);
    expect(decrypted.equals(empty)).toBe(true);
  });

  // 14. encrypt handles large plaintext (1MB) without error
  it('encrypt handles large plaintext (1MB) without error', () => {
    const large = randomBytes(1024 * 1024); // 1MB
    const payload = encrypt(large, key, keyId);
    const decrypted = decrypt(payload, key);
    expect(decrypted.equals(large)).toBe(true);
  });
});
