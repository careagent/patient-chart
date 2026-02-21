export const AUDIT_LOG_FILENAME = 'audit.jsonl' as const;

// Re-export types for audit module consumers
export type { VaultAuditEntry, VaultEventType, AuditActor } from '../types/audit.js';
export { VaultAuditEntrySchema, VaultEventTypeSchema, AuditActorSchema } from '../types/audit.js';
