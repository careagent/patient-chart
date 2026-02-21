import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateUUIDv7 } from '../util/uuidv7.js';
import type { VaultMetadata } from '../types/vault.js';
import { VAULT_SUBDIRS } from './schema.js';

/**
 * Initializes a new patient vault at the given path.
 *
 * Creates all required subdirectories and writes vault.json with a fresh
 * UUIDv7 identifier, schema version, and creation timestamp.
 *
 * Path is always provided by the caller -- this library never creates a
 * default storage location (CONTEXT.md decision).
 *
 * @param vaultPath - Absolute path to the vault directory (will be created if absent)
 * @returns VaultMetadata written to vault.json
 * @throws Error if vault.json already exists at vaultPath
 */
export function createVault(vaultPath: string): VaultMetadata {
  if (existsSync(join(vaultPath, 'vault.json'))) {
    throw new Error(`Vault already exists at ${vaultPath}`);
  }

  // Create vault root and all subdirectories
  for (const subdir of VAULT_SUBDIRS) {
    mkdirSync(join(vaultPath, subdir), { recursive: true });
  }

  const metadata: VaultMetadata = {
    vault_id: generateUUIDv7(),
    schema_version: '1',
    created_at: new Date().toISOString(),
  };

  // Pretty-print for human readability on disk
  writeFileSync(join(vaultPath, 'vault.json'), JSON.stringify(metadata, null, 2));
  return metadata;
}
