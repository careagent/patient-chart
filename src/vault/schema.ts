export const VAULT_SUBDIRS = ['ledger', 'audit', 'keys', 'sync', 'backup', 'emergency'] as const;
export type VaultSubdir = typeof VAULT_SUBDIRS[number];

// Re-export from types for vault module consumers
export { VaultMetadataSchema } from '../types/vault.js';
export type { VaultMetadata } from '../types/vault.js';
