export type { VaultEventType, AuditActor, VaultAuditEntry } from './audit.js';
export { VaultEventTypeSchema, AuditActorSchema, VaultAuditEntrySchema } from './audit.js';
export type { VaultMetadata } from './vault.js';
export { VaultMetadataSchema } from './vault.js';
export type { EncryptedPayload, KdfParams, KeyRecord, KeyRingData } from './encryption.js';
export {
  EncryptedPayloadSchema,
  KdfParamsSchema,
  KeyRecordSchema,
  KeyRingDataSchema,
} from './encryption.js';

// Knowledge graph types
export type { KnowledgeNoteMeta, ClinicalStatus, VerificationStatus, NoteType } from './knowledge.js';
export {
  KnowledgeNoteMetaSchema,
  ClinicalStatusSchema,
  VerificationStatusSchema,
  NoteTypeSchema,
} from './knowledge.js';
