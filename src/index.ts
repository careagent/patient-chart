// Vault operations
export { createVault } from './vault/create.js';
export { discoverVaults } from './vault/discover.js';

// Audit pipeline
export { AuditWriter, VaultAuditPipeline } from './audit/writer.js';
export type { VaultAuditPipelineOptions } from './audit/writer.js';
export { verifyChain } from './audit/integrity.js';
export type { ChainVerificationResult } from './audit/integrity.js';

// Public types
export type { VaultMetadata } from './types/vault.js';
export type { VaultAuditEntry, VaultEventType, AuditActor } from './types/audit.js';

// Schemas (TypeBox, re-exported for validation consumers)
export { VaultMetadataSchema } from './types/vault.js';
export { VaultEventTypeSchema, AuditActorSchema, VaultAuditEntrySchema } from './types/audit.js';

// Utilities (exported for consumer use -- patient-core needs UUIDv7 for entry IDs)
export { generateUUIDv7 } from './util/uuidv7.js';
