import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyRing } from '../../src/encryption/keyring.js';
import { sign, verifySignature } from '../../src/encryption/ed25519.js';
import {
  VaultAuthenticationError,
  KeyRingCorruptedError,
  KeyNotFoundError,
} from '../../src/encryption/errors.js';
import { VaultMetadataSchema } from '../../src/types/vault.js';
import { Value } from '@sinclair/typebox/value';
import { writeFileSync } from 'node:fs';

describe('KeyRing', () => {
  const keyWrappingKey = randomBytes(32);

  function createTmpDir(): string {
    return mkdtempSync(join(tmpdir(), 'keyring-test-'));
  }

  // 1. KeyRing.create returns a KeyRing with an active key ID
  it('create returns a KeyRing with an active key ID', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const activeKeyId = ring.getActiveKeyId();
    expect(activeKeyId).toBeTruthy();
    expect(typeof activeKeyId).toBe('string');
    // UUIDv7 format: 8-4-4-4-12
    expect(activeKeyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    ring.destroy();
  });

  // 2. getActiveEncryptionKey returns a 32-byte Buffer and a key ID
  it('getActiveEncryptionKey returns a 32-byte Buffer and a key ID', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const { keyId, key } = ring.getActiveEncryptionKey();
    expect(keyId).toBe(ring.getActiveKeyId());
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    ring.destroy();
  });

  // 3. getEncryptionKey with active key ID returns the same key as getActiveEncryptionKey
  it('getEncryptionKey with active key ID returns same key as getActiveEncryptionKey', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const { keyId, key } = ring.getActiveEncryptionKey();
    const lookedUp = ring.getEncryptionKey(keyId);
    expect(lookedUp.equals(key)).toBe(true);
    ring.destroy();
  });

  // 4. getEncryptionKey with unknown key ID throws KeyNotFoundError
  it('getEncryptionKey with unknown key ID throws KeyNotFoundError', () => {
    const ring = KeyRing.create(keyWrappingKey);
    expect(() => ring.getEncryptionKey('nonexistent-key-id')).toThrow(
      KeyNotFoundError,
    );
    ring.destroy();
  });

  // 5. getIdentityPublicKey returns a KeyObject
  it('getIdentityPublicKey returns a KeyObject', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const pubKey = ring.getIdentityPublicKey();
    expect(pubKey.type).toBe('public');
    expect(pubKey.asymmetricKeyType).toBe('ed25519');
    ring.destroy();
  });

  // 6. getIdentityPrivateKey returns a KeyObject
  it('getIdentityPrivateKey returns a KeyObject', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const privKey = ring.getIdentityPrivateKey();
    expect(privKey.type).toBe('private');
    expect(privKey.asymmetricKeyType).toBe('ed25519');
    ring.destroy();
  });

  // 7. save + load round-trip: active key ID preserved, encryption key identical
  it('save + load round-trip preserves active key ID and encryption key', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    const ring = KeyRing.create(keyWrappingKey);
    const originalKeyId = ring.getActiveKeyId();
    const originalKey = ring.getActiveEncryptionKey().key;
    ring.save(filePath);

    const loaded = KeyRing.load(filePath, keyWrappingKey);
    expect(loaded.getActiveKeyId()).toBe(originalKeyId);
    expect(loaded.getActiveEncryptionKey().key.equals(originalKey)).toBe(true);

    ring.destroy();
    loaded.destroy();
  });

  // 8. save + load round-trip: identity key pair preserved (sign with loaded private, verify with original public)
  it('save + load round-trip preserves identity key pair', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    const ring = KeyRing.create(keyWrappingKey);
    const originalPublicKey = ring.getIdentityPublicKey();
    ring.save(filePath);

    const loaded = KeyRing.load(filePath, keyWrappingKey);

    // Sign with loaded private key, verify with original public key
    const data = Buffer.from('test data for identity verification');
    const signature = sign(data, loaded.getIdentityPrivateKey());
    expect(verifySignature(data, signature, originalPublicKey)).toBe(true);

    ring.destroy();
    loaded.destroy();
  });

  // 9. load with wrong key-wrapping key throws VaultAuthenticationError
  it('load with wrong key-wrapping key throws VaultAuthenticationError', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    const ring = KeyRing.create(keyWrappingKey);
    ring.save(filePath);
    ring.destroy();

    const wrongKey = randomBytes(32);
    expect(() => KeyRing.load(filePath, wrongKey)).toThrow(
      VaultAuthenticationError,
    );
  });

  // 10. load with corrupted JSON throws KeyRingCorruptedError
  it('load with corrupted JSON throws KeyRingCorruptedError', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    writeFileSync(filePath, 'not valid json {{{', 'utf-8');

    expect(() => KeyRing.load(filePath, keyWrappingKey)).toThrow(
      KeyRingCorruptedError,
    );
  });

  // 11. load with invalid schema (missing fields) throws KeyRingCorruptedError
  it('load with invalid schema throws KeyRingCorruptedError', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    writeFileSync(filePath, JSON.stringify({ active_key_id: 'x' }), 'utf-8');

    expect(() => KeyRing.load(filePath, keyWrappingKey)).toThrow(
      KeyRingCorruptedError,
    );
  });

  // 12. rotate returns a new key ID different from the old one
  it('rotate returns a new key ID different from the old one', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const oldKeyId = ring.getActiveKeyId();
    const newKeyId = ring.rotate();
    expect(newKeyId).not.toBe(oldKeyId);
    ring.destroy();
  });

  // 13. After rotate, getActiveEncryptionKey returns the new key
  it('after rotate, getActiveEncryptionKey returns the new key', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const oldKey = ring.getActiveEncryptionKey().key;
    const newKeyId = ring.rotate();
    const { keyId, key } = ring.getActiveEncryptionKey();
    expect(keyId).toBe(newKeyId);
    expect(key.equals(oldKey)).toBe(false);
    ring.destroy();
  });

  // 14. After rotate, old key is still retrievable via getEncryptionKey(oldKeyId)
  it('after rotate, old key is still retrievable', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const oldKeyId = ring.getActiveKeyId();
    const oldKey = Buffer.from(ring.getEncryptionKey(oldKeyId));
    ring.rotate();
    const retrieved = ring.getEncryptionKey(oldKeyId);
    expect(retrieved.equals(oldKey)).toBe(true);
    ring.destroy();
  });

  // 15. After rotate + save + load, both old and new keys are accessible
  it('after rotate + save + load, both old and new keys are accessible', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');

    const ring = KeyRing.create(keyWrappingKey);
    const oldKeyId = ring.getActiveKeyId();
    const oldKey = Buffer.from(ring.getEncryptionKey(oldKeyId));
    const newKeyId = ring.rotate();
    const newKey = Buffer.from(ring.getEncryptionKey(newKeyId));
    ring.save(filePath);

    const loaded = KeyRing.load(filePath, keyWrappingKey);
    expect(loaded.getActiveKeyId()).toBe(newKeyId);
    expect(loaded.getEncryptionKey(oldKeyId).equals(oldKey)).toBe(true);
    expect(loaded.getEncryptionKey(newKeyId).equals(newKey)).toBe(true);

    ring.destroy();
    loaded.destroy();
  });

  // 16. destroy zeros key material
  it('destroy zeros key material (buffer contents are all zeros)', () => {
    const ring = KeyRing.create(keyWrappingKey);
    const { key } = ring.getActiveEncryptionKey();

    // Verify key has non-zero content before destroy
    expect(key.some((b) => b !== 0)).toBe(true);

    ring.destroy();

    // After destroy, the buffer should be zeroed
    expect(key.every((b) => b === 0)).toBe(true);
  });

  // 17. save creates atomic write (keyring.json.tmp does not persist after successful save)
  it('save uses atomic write (tmp file does not persist)', () => {
    const dir = createTmpDir();
    const filePath = join(dir, 'keyring.json');
    const tmpPath = `${filePath}.tmp`;

    const ring = KeyRing.create(keyWrappingKey);
    ring.save(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(tmpPath)).toBe(false);

    // Verify the saved file is valid JSON
    const content = readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();

    ring.destroy();
  });

  // 18. VaultMetadataSchema accepts vault.json with kdf field
  it('VaultMetadataSchema accepts vault.json with kdf field', () => {
    const metadata = {
      vault_id: '01234567-89ab-7cde-8f01-234567890abc',
      schema_version: '1' as const,
      created_at: '2026-02-21T14:30:00.123Z',
      kdf: {
        algorithm: 'scrypt' as const,
        N: 131072,
        r: 8,
        p: 1,
        salt: 'c29tZSBzYWx0IGJ5dGVz',
        key_length: 32,
      },
    };
    expect(Value.Check(VaultMetadataSchema, metadata)).toBe(true);
  });

  // 19. VaultMetadataSchema accepts vault.json without kdf field (backward compatibility)
  it('VaultMetadataSchema accepts vault.json without kdf field', () => {
    const metadata = {
      vault_id: '01234567-89ab-7cde-8f01-234567890abc',
      schema_version: '1' as const,
      created_at: '2026-02-21T14:30:00.123Z',
    };
    expect(Value.Check(VaultMetadataSchema, metadata)).toBe(true);
  });
});
