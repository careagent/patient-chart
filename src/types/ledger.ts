import { Type, type Static } from '@sinclair/typebox';
import { EncryptedPayloadSchema } from './encryption.js';

/**
 * All 26 ledger entry types covering the full clinical record domain.
 * Organized into 6 categories: clinical, care network, access control,
 * emergency, patient-authored, and system.
 */
export const LedgerEntryTypeSchema = Type.Union([
  // Clinical (10)
  Type.Literal('clinical_encounter'),
  Type.Literal('clinical_medication'),
  Type.Literal('clinical_allergy'),
  Type.Literal('clinical_diagnosis'),
  Type.Literal('clinical_problem_list'),
  Type.Literal('clinical_lab_result'),
  Type.Literal('clinical_imaging_result'),
  Type.Literal('clinical_pathology'),
  Type.Literal('clinical_procedure'),
  Type.Literal('clinical_amendment'),
  // Care network (3)
  Type.Literal('care_relationship_established'),
  Type.Literal('care_relationship_terminated'),
  Type.Literal('care_relationship_suspended'),
  // Access control (4)
  Type.Literal('access_grant_created'),
  Type.Literal('access_grant_modified'),
  Type.Literal('access_grant_revoked'),
  Type.Literal('access_grant_expired'),
  // Emergency (3)
  Type.Literal('emergency_config_set'),
  Type.Literal('emergency_access_triggered'),
  Type.Literal('emergency_access_ended'),
  // Patient-authored (3)
  Type.Literal('patient_note'),
  Type.Literal('patient_directive'),
  Type.Literal('patient_preference'),
  // System (3)
  Type.Literal('vault_initialized'),
  Type.Literal('key_rotation'),
  Type.Literal('sync_record'),
]);

export type LedgerEntryType = Static<typeof LedgerEntryTypeSchema>;

/**
 * Author of a ledger entry. Captures the identity and signing key
 * of the agent that created the entry.
 */
export const EntryAuthorSchema = Type.Object({
  type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('system'),
  ]),
  id: Type.String(),
  display_name: Type.String(),
  public_key: Type.String({ description: 'Base64-encoded DER (SPKI) Ed25519 public key' }),
});

export type EntryAuthor = Static<typeof EntryAuthorSchema>;

/**
 * Unencrypted metadata envelope stored alongside the encrypted payload.
 * Enables indexing and querying without decryption.
 */
export const EntryMetadataSchema = Type.Object({
  schema_version: Type.Literal('1'),
  entry_type: LedgerEntryTypeSchema,
  author_type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('system'),
  ]),
  author_id: Type.String(),
  amends: Type.Optional(Type.String({ description: 'UUID of entry being amended' })),
  synced_entry: Type.Optional(Type.String({ description: 'UUID of synced entry' })),
  payload_size: Type.Number({ description: 'Byte size of plaintext payload' }),
});

export type EntryMetadata = Static<typeof EntryMetadataSchema>;

/**
 * The exact fields covered by the Ed25519 signature.
 * Serialized via canonicalize() before signing.
 */
export const SignableContentSchema = Type.Object({
  id: Type.String(),
  timestamp: Type.String(),
  entry_type: LedgerEntryTypeSchema,
  author: EntryAuthorSchema,
  payload: Type.String({ description: 'Plaintext payload as JSON string' }),
  metadata: EntryMetadataSchema,
});

export type SignableContent = Static<typeof SignableContentSchema>;

/**
 * The on-disk format for a single ledger entry.
 * One JSON line per entry in entries.jsonl.
 * Separates unencrypted metadata envelope from encrypted payload.
 */
export const LedgerEntrySchema = Type.Object({
  id: Type.String({ description: 'UUIDv7 entry identifier' }),
  timestamp: Type.String({ description: 'ISO 8601 with millisecond precision' }),
  entry_type: LedgerEntryTypeSchema,
  author: EntryAuthorSchema,
  prev_hash: Type.Union([Type.String(), Type.Null()], {
    description: 'SHA-256 hash of previous line, or null for genesis entry',
  }),
  signature: Type.String({ description: 'Base64-encoded Ed25519 signature over SignableContent' }),
  encrypted_payload: EncryptedPayloadSchema,
  metadata: EntryMetadataSchema,
});

export type LedgerEntry = Static<typeof LedgerEntrySchema>;
