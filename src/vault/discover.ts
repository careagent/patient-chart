import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import type { VaultMetadata } from '../types/vault.js';
import { VaultMetadataSchema } from './schema.js';

/**
 * Scans the provided directory paths for valid vault.json files.
 *
 * Non-recursive -- checks only the exact paths provided, not subdirectories.
 * Never throws -- invalid paths, missing files, corrupt JSON, and schema
 * mismatches are all silently skipped.
 *
 * Enables caller-driven vault discovery (e.g., patient-core scans mounted
 * drives) without this library assuming any default storage location.
 *
 * @param searchPaths - Absolute paths to directories to scan
 * @returns Array of VaultMetadata for each discovered valid vault
 */
export function discoverVaults(searchPaths: string[]): VaultMetadata[] {
  const discovered: VaultMetadata[] = [];

  for (const searchPath of searchPaths) {
    try {
      const vaultJsonPath = join(searchPath, 'vault.json');
      if (!existsSync(vaultJsonPath)) continue;

      const raw = readFileSync(vaultJsonPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (!Value.Check(VaultMetadataSchema, parsed)) continue;

      discovered.push(parsed);
    } catch {
      // Silently skip: nonexistent path, permission denied, invalid JSON
      continue;
    }
  }

  return discovered;
}
