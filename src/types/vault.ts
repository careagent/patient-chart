import { Type, type Static } from '@sinclair/typebox';
import { KdfParamsSchema } from './encryption.js';

/**
 * Contents of vault.json written to disk during vault creation.
 * Patient identity intentionally omitted — would create an information leak
 * on disk before AES-256-GCM encryption is available (Phase 2).
 *
 * The optional `kdf` field stores scrypt parameters for future upgradeability.
 * It is optional for backward compatibility with existing Phase 1 vault.json
 * files (which have no kdf field).
 */
export const VaultMetadataSchema = Type.Object({
  vault_id: Type.String({ description: 'UUIDv7 vault identifier — time-sortable, embeds creation timestamp' }),
  schema_version: Type.Literal('1'),
  created_at: Type.String({ description: 'ISO 8601 with millisecond precision: 2026-02-21T14:30:00.123Z' }),
  kdf: Type.Optional(KdfParamsSchema),
});

export type VaultMetadata = Static<typeof VaultMetadataSchema>;
