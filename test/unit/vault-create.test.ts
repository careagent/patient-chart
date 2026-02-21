import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../../src/vault/create.js';
import { VaultAuditPipeline } from '../../src/audit/writer.js';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO8601_MS_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('createVault', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `patient-chart-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates all six required subdirectories', () => {
    const vaultPath = join(testDir, 'vault');
    createVault(vaultPath);
    for (const subdir of ['ledger', 'audit', 'keys', 'sync', 'backup', 'emergency']) {
      expect(existsSync(join(vaultPath, subdir))).toBe(true);
    }
  });

  it('writes vault.json to the vault path', () => {
    const vaultPath = join(testDir, 'vault');
    createVault(vaultPath);
    expect(existsSync(join(vaultPath, 'vault.json'))).toBe(true);
  });

  it('returns VaultMetadata with valid UUIDv7 vault_id', () => {
    const vaultPath = join(testDir, 'vault');
    const metadata = createVault(vaultPath);
    expect(metadata.vault_id).toMatch(UUID_V7_REGEX);
  });

  it('returns VaultMetadata with schema_version "1"', () => {
    const vaultPath = join(testDir, 'vault');
    const metadata = createVault(vaultPath);
    expect(metadata.schema_version).toBe('1');
  });

  it('returns VaultMetadata with ISO 8601 ms-precision created_at', () => {
    const vaultPath = join(testDir, 'vault');
    const metadata = createVault(vaultPath);
    expect(metadata.created_at).toMatch(ISO8601_MS_REGEX);
  });

  it('vault.json content matches returned VaultMetadata', () => {
    const vaultPath = join(testDir, 'vault');
    const metadata = createVault(vaultPath);
    const onDisk = JSON.parse(readFileSync(join(vaultPath, 'vault.json'), 'utf-8'));
    expect(onDisk).toEqual(metadata);
  });

  it('throws if vault.json already exists at path', () => {
    const vaultPath = join(testDir, 'vault');
    createVault(vaultPath);
    expect(() => createVault(vaultPath)).toThrow(/already exists/);
  });
});

describe('createVault audit integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `patient-chart-audit-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('emits vault_created audit event when pipeline is provided', () => {
    const vaultPath = join(testDir, 'vault');
    const auditLogPath = join(testDir, 'audit.jsonl');
    const pipeline = new VaultAuditPipeline(auditLogPath);

    createVault(vaultPath, pipeline);

    const line = readFileSync(auditLogPath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.event_type).toBe('vault_created');
    expect(entry.outcome).toBe('success');
    expect(entry.details.vault_id).toBeDefined();
  });

  it('does not require a pipeline -- works without audit (pipeline is optional)', () => {
    const vaultPath = join(testDir, 'vault');
    expect(() => createVault(vaultPath)).not.toThrow();
  });
});
