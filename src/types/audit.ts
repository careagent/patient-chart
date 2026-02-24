import { Type, type Static } from '@sinclair/typebox';

/**
 * All vault event types. 38 PRD-defined types + audit_gap + 3 knowledge graph events (42 total).
 * audit_gap added per CONTEXT.md non-blocking audit design to mark dropped entries while
 * keeping chain intact. Knowledge events added for Phase 9 knowledge graph layer.
 */
export const VaultEventTypeSchema = Type.Union([
  // Vault lifecycle
  Type.Literal('vault_created'),
  Type.Literal('vault_opened'),
  Type.Literal('vault_closed'),
  Type.Literal('vault_integrity_checked'),
  Type.Literal('vault_integrity_failed'),
  // Ledger operations
  Type.Literal('ledger_entry_written'),
  Type.Literal('ledger_entry_read'),
  Type.Literal('ledger_entry_amended'),
  Type.Literal('ledger_integrity_checked'),
  Type.Literal('ledger_integrity_failed'),
  // Access control
  Type.Literal('access_grant_created'),
  Type.Literal('access_grant_modified'),
  Type.Literal('access_grant_revoked'),
  Type.Literal('access_grant_expired'),
  // Write gate
  Type.Literal('write_gate_allowed'),
  Type.Literal('write_gate_denied'),
  // Read gate
  Type.Literal('read_gate_allowed'),
  Type.Literal('read_gate_denied'),
  // Sync
  Type.Literal('sync_triggered'),
  Type.Literal('sync_delivered'),
  Type.Literal('sync_failed'),
  Type.Literal('sync_retried'),
  Type.Literal('sync_stopped'),
  // Emergency access
  Type.Literal('emergency_triggered'),
  Type.Literal('emergency_auth_success'),
  Type.Literal('emergency_auth_failed'),
  Type.Literal('emergency_session_started'),
  Type.Literal('emergency_session_ended'),
  Type.Literal('emergency_cooldown_started'),
  // Key management
  Type.Literal('key_generated'),
  Type.Literal('key_rotated'),
  Type.Literal('key_ring_loaded'),
  // Backup
  Type.Literal('backup_started'),
  Type.Literal('backup_completed'),
  Type.Literal('backup_failed'),
  Type.Literal('backup_retention_enforced'),
  // Discovery
  Type.Literal('vault_discovered'),
  Type.Literal('vault_discovery_failed'),
  // Knowledge graph
  Type.Literal('knowledge_note_created'),
  Type.Literal('knowledge_note_updated'),
  Type.Literal('knowledge_note_read'),
  // Gap marker — 42nd type, marks a dropped audit entry while preserving chain
  Type.Literal('audit_gap'),
]);

export type VaultEventType = Static<typeof VaultEventTypeSchema>;

/**
 * Actor performing a vault operation. All 5 actor types defined from day one
 * for forward compatibility; Phase 1 exercises only 'system'.
 */
export const AuditActorSchema = Type.Object({
  type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('emergency_party'),
    Type.Literal('application'),
    Type.Literal('system'),
  ]),
  id: Type.String(),
  display_name: Type.String(),
});

export type AuditActor = Static<typeof AuditActorSchema>;

/**
 * A single entry in the hash-chained JSONL audit log.
 * prev_hash is null only for the genesis entry.
 * details uses Record<string, unknown> matching provider-core pattern.
 */
export const VaultAuditEntrySchema = Type.Object({
  id: Type.String({ description: 'UUIDv7 entry identifier' }),
  timestamp: Type.String({ description: 'ISO 8601 with millisecond precision' }),
  event_type: VaultEventTypeSchema,
  actor: AuditActorSchema,
  outcome: Type.Union([Type.Literal('success'), Type.Literal('error'), Type.Literal('info')]),
  prev_hash: Type.Union([Type.String(), Type.Null()]),
  details: Type.Record(Type.String(), Type.Unknown()),
});

export type VaultAuditEntry = Static<typeof VaultAuditEntrySchema>;
