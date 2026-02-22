import { randomBytes, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';

import { encrypt, decrypt } from './aes.js';
import {
  generateEd25519KeyPair,
  exportEd25519PublicKey,
  exportEd25519PrivateKey,
  importEd25519PublicKey,
  importEd25519PrivateKey,
} from './ed25519.js';
import { generateUUIDv7 } from '../util/uuidv7.js';
import { KeyRingDataSchema, type KeyRingData, type KeyRecord } from '../types/encryption.js';
import {
  VaultAuthenticationError,
  KeyRingCorruptedError,
  KeyNotFoundError,
  CryptoError,
} from './errors.js';

/** Internal key-wrapping key ID used for encrypting keys at rest. */
const KWK_KEY_ID = 'kwk';

/**
 * The KeyRing manages the lifecycle of encryption keys and the Ed25519
 * identity key pair for a patient vault.
 *
 * It is instantiated via static factory methods (`create` or `load`), never
 * via the constructor directly. The key-wrapping key is stored internally
 * so that `save()` and `rotate()` can re-encrypt keys with fresh IVs
 * without requiring the key-wrapping key as a parameter.
 *
 * All raw key material (key-wrapping key, encryption keys, identity private
 * key DER) is held in Buffers that can be zeroed via `destroy()`.
 */
export class KeyRing {
  /** Decrypted encryption keys indexed by key ID. */
  private readonly decryptedKeys: Map<string, Buffer>;

  /** Currently active key ID. */
  private activeKeyId: string;

  /** Key creation timestamps indexed by key ID. */
  private readonly createdAtMap: Map<string, string>;

  /** Key rotation timestamps indexed by key ID (null if still active). */
  private readonly rotatedAtMap: Map<string, string | null>;

  /** Ed25519 identity key pair. */
  private identityPublicKey: KeyObject;
  private identityPrivateKey: KeyObject;

  /** DER-encoded identity keys (for serialization and zeroing). */
  private identityPublicDer: Buffer;
  private identityPrivateDer: Buffer;

  /** Key-wrapping key stored for save/rotate operations. */
  private keyWrappingKey: Buffer;

  private constructor(
    decryptedKeys: Map<string, Buffer>,
    activeKeyId: string,
    createdAtMap: Map<string, string>,
    rotatedAtMap: Map<string, string | null>,
    identityPublicKey: KeyObject,
    identityPrivateKey: KeyObject,
    identityPublicDer: Buffer,
    identityPrivateDer: Buffer,
    keyWrappingKey: Buffer,
  ) {
    this.decryptedKeys = decryptedKeys;
    this.activeKeyId = activeKeyId;
    this.createdAtMap = createdAtMap;
    this.rotatedAtMap = rotatedAtMap;
    this.identityPublicKey = identityPublicKey;
    this.identityPrivateKey = identityPrivateKey;
    this.identityPublicDer = identityPublicDer;
    this.identityPrivateDer = identityPrivateDer;
    this.keyWrappingKey = keyWrappingKey;
  }

  /**
   * Create a new KeyRing with a fresh encryption key and Ed25519 identity
   * key pair, all encrypted by the provided key-wrapping key.
   *
   * @param keyWrappingKey - 32-byte key derived from the patient passphrase
   *   via kdf.ts. The caller is responsible for derivation.
   * @returns A new KeyRing instance ready for use.
   */
  static create(keyWrappingKey: Buffer): KeyRing {
    // Generate initial encryption key
    const encryptionKey = randomBytes(32);
    const keyId = generateUUIDv7();
    const now = new Date().toISOString();

    const decryptedKeys = new Map<string, Buffer>();
    decryptedKeys.set(keyId, encryptionKey);

    const createdAtMap = new Map<string, string>();
    createdAtMap.set(keyId, now);

    const rotatedAtMap = new Map<string, string | null>();
    rotatedAtMap.set(keyId, null);

    // Generate Ed25519 identity key pair
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const publicDer = exportEd25519PublicKey(publicKey);
    const privateDer = exportEd25519PrivateKey(privateKey);

    return new KeyRing(
      decryptedKeys,
      keyId,
      createdAtMap,
      rotatedAtMap,
      publicKey,
      privateKey,
      publicDer,
      privateDer,
      keyWrappingKey,
    );
  }

  /**
   * Load a KeyRing from a JSON file, decrypting all keys with the provided
   * key-wrapping key.
   *
   * @param filePath - Path to the keyring.json file.
   * @param keyWrappingKey - 32-byte key-wrapping key. If wrong, throws
   *   VaultAuthenticationError (GCM auth tag mismatch).
   * @returns A loaded KeyRing instance.
   * @throws {VaultAuthenticationError} If the key-wrapping key is wrong.
   * @throws {KeyRingCorruptedError} If the file is malformed or fails schema validation.
   */
  static load(filePath: string, keyWrappingKey: Buffer): KeyRing {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      throw new KeyRingCorruptedError();
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new KeyRingCorruptedError();
    }

    if (!Value.Check(KeyRingDataSchema, data)) {
      throw new KeyRingCorruptedError();
    }

    const ringData = data as KeyRingData;

    // Decrypt all key records
    const decryptedKeys = new Map<string, Buffer>();
    const createdAtMap = new Map<string, string>();
    const rotatedAtMap = new Map<string, string | null>();

    for (const [keyId, record] of Object.entries(ringData.keys)) {
      try {
        const rawKey = decrypt(record.encrypted_key, keyWrappingKey);
        decryptedKeys.set(keyId, rawKey);
      } catch (error) {
        if (error instanceof CryptoError) {
          throw new VaultAuthenticationError();
        }
        throw error;
      }
      createdAtMap.set(keyId, record.created_at);
      rotatedAtMap.set(keyId, record.rotated_at);
    }

    // Decrypt identity private key
    let identityPrivateDer: Buffer;
    try {
      identityPrivateDer = decrypt(ringData.identity.encrypted_private_key, keyWrappingKey);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw new VaultAuthenticationError();
      }
      throw error;
    }

    const identityPublicDer = Buffer.from(ringData.identity.public_key, 'base64');
    const identityPublicKey = importEd25519PublicKey(identityPublicDer);
    const identityPrivateKey = importEd25519PrivateKey(identityPrivateDer);

    return new KeyRing(
      decryptedKeys,
      ringData.active_key_id,
      createdAtMap,
      rotatedAtMap,
      identityPublicKey,
      identityPrivateKey,
      identityPublicDer,
      identityPrivateDer,
      keyWrappingKey,
    );
  }

  /**
   * Save the key ring to disk as encrypted JSON using write-then-rename
   * for atomic writes.
   *
   * All keys are re-encrypted with the key-wrapping key using fresh IVs.
   *
   * @param filePath - Destination path for keyring.json.
   */
  save(filePath: string): void {
    const keys: Record<string, KeyRecord> = {};

    for (const [keyId, rawKey] of this.decryptedKeys) {
      keys[keyId] = {
        key_id: keyId,
        encrypted_key: encrypt(rawKey, this.keyWrappingKey, KWK_KEY_ID),
        created_at: this.createdAtMap.get(keyId)!,
        rotated_at: this.rotatedAtMap.get(keyId) ?? null,
      };
    }

    const encryptedPrivateKey = encrypt(
      this.identityPrivateDer,
      this.keyWrappingKey,
      KWK_KEY_ID,
    );

    const data: KeyRingData = {
      active_key_id: this.activeKeyId,
      keys,
      identity: {
        public_key: this.identityPublicDer.toString('base64'),
        encrypted_private_key: encryptedPrivateKey,
      },
    };

    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}.tmp`;

    writeFileSync(tmpPath, json, 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /**
   * Get the active encryption key ID.
   */
  getActiveKeyId(): string {
    return this.activeKeyId;
  }

  /**
   * Get a decrypted encryption key by its ID.
   *
   * @param keyId - The key ID to look up.
   * @returns The 32-byte decrypted encryption key.
   * @throws {KeyNotFoundError} If the key ID is not in the ring.
   */
  getEncryptionKey(keyId: string): Buffer {
    const key = this.decryptedKeys.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId);
    }
    return key;
  }

  /**
   * Get the active encryption key and its ID.
   *
   * @returns Object with keyId and 32-byte key Buffer.
   */
  getActiveEncryptionKey(): { keyId: string; key: Buffer } {
    return {
      keyId: this.activeKeyId,
      key: this.getEncryptionKey(this.activeKeyId),
    };
  }

  /**
   * Rotate the encryption key. Generates a new 32-byte key, sets it as
   * active, and marks the previous active key with a `rotated_at` timestamp.
   * Old keys remain in the ring for historical decryption.
   *
   * @returns The new active key ID.
   */
  rotate(): string {
    const newKey = randomBytes(32);
    const newKeyId = generateUUIDv7();
    const now = new Date().toISOString();

    // Mark current active key as rotated
    this.rotatedAtMap.set(this.activeKeyId, now);

    // Add new key
    this.decryptedKeys.set(newKeyId, newKey);
    this.createdAtMap.set(newKeyId, now);
    this.rotatedAtMap.set(newKeyId, null);

    // Update active key
    this.activeKeyId = newKeyId;

    return newKeyId;
  }

  /**
   * Get the Ed25519 identity public key.
   */
  getIdentityPublicKey(): KeyObject {
    return this.identityPublicKey;
  }

  /**
   * Get the Ed25519 identity private key.
   */
  getIdentityPrivateKey(): KeyObject {
    return this.identityPrivateKey;
  }

  /**
   * Get the Ed25519 identity public key in DER SPKI format.
   */
  getIdentityPublicKeyDer(): Buffer {
    return this.identityPublicDer;
  }

  /**
   * Zero all key material in memory. Best-effort cleanup -- after calling
   * destroy, the KeyRing instance should not be used.
   */
  destroy(): void {
    // Zero key-wrapping key
    this.keyWrappingKey.fill(0);

    // Zero all decrypted encryption keys
    for (const key of this.decryptedKeys.values()) {
      key.fill(0);
    }

    // Zero identity private key DER
    this.identityPrivateDer.fill(0);
  }
}
