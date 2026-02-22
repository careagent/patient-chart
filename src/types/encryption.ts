import { Type, type Static } from '@sinclair/typebox';

/**
 * Canonical encrypted data envelope produced by AES-256-GCM encryption.
 * Used for ledger entry payloads, key-at-rest storage in the key ring,
 * and any other encrypted artifact in the vault.
 */
export const EncryptedPayloadSchema = Type.Object({
  ciphertext: Type.String({ description: 'Base64-encoded ciphertext' }),
  iv: Type.String({ description: 'Base64-encoded 12-byte initialization vector' }),
  auth_tag: Type.String({ description: 'Base64-encoded 16-byte GCM authentication tag' }),
  key_id: Type.String({ description: 'Key identifier used for encryption — lookup key in the key ring' }),
});

export type EncryptedPayload = Static<typeof EncryptedPayloadSchema>;

/**
 * Key derivation function parameters stored in vault.json for future upgradeability.
 * All fields are required — the salt is generated per vault and stored alongside.
 */
export const KdfParamsSchema = Type.Object({
  algorithm: Type.Literal('scrypt', { description: 'KDF algorithm — currently only scrypt is supported' }),
  N: Type.Number({ description: 'CPU/memory cost parameter — minimum 2^17 (131072)' }),
  r: Type.Number({ description: 'Block size parameter' }),
  p: Type.Number({ description: 'Parallelization parameter' }),
  salt: Type.String({ description: 'Base64-encoded salt bytes' }),
  key_length: Type.Number({ description: 'Derived key length in bytes' }),
});

export type KdfParams = Static<typeof KdfParamsSchema>;

/**
 * A single encryption key record in the key ring.
 * The encrypted_key field holds the raw AES-256 key encrypted by the
 * master-derived key-wrapping key. rotated_at is null for the active key.
 */
export const KeyRecordSchema = Type.Object({
  key_id: Type.String({ description: 'UUIDv7 key identifier' }),
  encrypted_key: EncryptedPayloadSchema,
  created_at: Type.String({ description: 'ISO 8601 timestamp of key creation' }),
  rotated_at: Type.Union([Type.String(), Type.Null()], {
    description: 'ISO 8601 timestamp when key was rotated out, or null if active',
  }),
});

export type KeyRecord = Static<typeof KeyRecordSchema>;

/**
 * The full key ring as persisted to keys/keyring.json.
 * Contains the active encryption key, all historical (rotated) keys,
 * and the vault identity key pair (Ed25519).
 */
export const KeyRingDataSchema = Type.Object({
  active_key_id: Type.String({ description: 'Key ID of the currently active encryption key' }),
  keys: Type.Record(Type.String(), KeyRecordSchema, {
    description: 'Map of key_id to KeyRecord — includes active and all rotated keys',
  }),
  identity: Type.Object({
    public_key: Type.String({ description: 'Base64-encoded DER (SPKI) Ed25519 public key' }),
    encrypted_private_key: EncryptedPayloadSchema,
  }, { description: 'Vault identity key pair — public key in the clear, private key encrypted' }),
});

export type KeyRingData = Static<typeof KeyRingDataSchema>;
