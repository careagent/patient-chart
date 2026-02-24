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

// Encryption primitives
export { encrypt, decrypt } from './encryption/aes.js';
export { generateEd25519KeyPair, sign, verifySignature, exportEd25519PublicKey, exportEd25519PrivateKey, importEd25519PublicKey, importEd25519PrivateKey } from './encryption/ed25519.js';
export { generateX25519KeyPair, computeSharedSecret, exportX25519PublicKey, exportX25519PrivateKey, importX25519PublicKey, importX25519PrivateKey } from './encryption/x25519.js';
export { deriveMasterKey, deriveSubKey, generateSalt, DEFAULT_KDF_PARAMS } from './encryption/kdf.js';
export { KeyRing } from './encryption/keyring.js';

// Encryption errors
export { CryptoError, VaultAuthenticationError, KeyRingCorruptedError, KeyNotFoundError } from './encryption/errors.js';

// Encryption types (type-only exports for isolatedModules)
export type { EncryptedPayload, KdfParams, KeyRecord, KeyRingData } from './types/encryption.js';

// Encryption schemas (value exports for runtime validation)
export { EncryptedPayloadSchema, KdfParamsSchema, KeyRecordSchema, KeyRingDataSchema } from './types/encryption.js';

// Knowledge graph
export { KnowledgeStore } from './knowledge/store.js';

// Knowledge graph constants
export { KNOWLEDGE_SUBDIRS } from './knowledge/schema.js';
export type { KnowledgeSubdir } from './knowledge/schema.js';

// Knowledge graph errors
export { KnowledgeStoreError, NoteNotFoundError, NoteCorruptedError, PathTraversalError } from './knowledge/errors.js';

// Knowledge graph types (type-only exports for isolatedModules)
export type { KnowledgeNoteMeta, ClinicalStatus, VerificationStatus, NoteType } from './types/knowledge.js';

// Knowledge graph schemas (value exports for runtime validation)
export { KnowledgeNoteMetaSchema, ClinicalStatusSchema, VerificationStatusSchema, NoteTypeSchema } from './types/knowledge.js';
