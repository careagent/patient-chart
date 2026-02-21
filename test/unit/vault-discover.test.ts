import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverVaults } from '../../src/vault/discover.js';
import { createVault } from '../../src/vault/create.js';

describe('discoverVaults', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `patient-chart-discover-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty array for empty searchPaths', () => {
    expect(discoverVaults([])).toEqual([]);
  });

  it('returns empty array when no vault.json exists', () => {
    expect(discoverVaults([testDir])).toEqual([]);
  });

  it('returns empty array for nonexistent path without throwing', () => {
    expect(() => discoverVaults(['/tmp/definitely-does-not-exist-12345'])).not.toThrow();
    expect(discoverVaults(['/tmp/definitely-does-not-exist-12345'])).toEqual([]);
  });

  it('discovers a vault created at the search path', () => {
    const vaultPath = join(testDir, 'vault1');
    const metadata = createVault(vaultPath);
    const found = discoverVaults([vaultPath]);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(metadata);
  });

  it('discovers multiple vaults across multiple search paths', () => {
    const vault1 = join(testDir, 'vault1');
    const vault2 = join(testDir, 'vault2');
    createVault(vault1);
    createVault(vault2);
    const found = discoverVaults([vault1, vault2]);
    expect(found).toHaveLength(2);
  });

  it('skips directories with invalid JSON in vault.json without throwing', () => {
    const vaultPath = join(testDir, 'corrupt');
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, 'vault.json'), '{invalid json}');
    expect(() => discoverVaults([vaultPath])).not.toThrow();
    expect(discoverVaults([vaultPath])).toEqual([]);
  });

  it('skips vault.json that does not match VaultMetadata schema', () => {
    const vaultPath = join(testDir, 'invalid-schema');
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, 'vault.json'), JSON.stringify({ not_a_vault: true }));
    expect(discoverVaults([vaultPath])).toEqual([]);
  });

  it('is non-recursive — does not find vaults in subdirectories', () => {
    const parentPath = join(testDir, 'parent');
    const vaultPath = join(parentPath, 'nested-vault');
    createVault(vaultPath);
    // Only searching parent, not nested-vault
    const found = discoverVaults([parentPath]);
    expect(found).toEqual([]);
  });
});
