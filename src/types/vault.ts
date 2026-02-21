import { Type, type Static } from '@sinclair/typebox';

/**
 * Contents of vault.json written to disk during vault creation.
 * Patient identity intentionally omitted — would create an information leak
 * on disk before AES-256-GCM encryption is available (Phase 2).
 */
export const VaultMetadataSchema = Type.Object({
  vault_id: Type.String({ description: 'UUIDv7 vault identifier — time-sortable, embeds creation timestamp' }),
  schema_version: Type.Literal('1'),
  created_at: Type.String({ description: 'ISO 8601 with millisecond precision: 2026-02-21T14:30:00.123Z' }),
});

export type VaultMetadata = Static<typeof VaultMetadataSchema>;
