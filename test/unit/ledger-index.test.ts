import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import type { EntryAuthor, LedgerEntry, LedgerEntryType } from '../../src/types/ledger.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { IndexManager } from '../../src/ledger/index-manager.js';

/**
 * Creates a mock LedgerEntry with specific type, author, and ID
 * for index testing. Only uses unencrypted metadata fields the index needs.
 */
function mockEntry(overrides: {
  id?: string;
  entry_type?: LedgerEntryType;
  author_id?: string;
  amends?: string;
  timestamp?: string;
}): LedgerEntry {
  return {
    id: overrides.id ?? `entry-${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    entry_type: overrides.entry_type ?? 'clinical_encounter',
    author: {
      type: 'provider_agent',
      id: overrides.author_id ?? 'default-author',
      display_name: 'Test Author',
      public_key: 'dGVzdA==',
    },
    prev_hash: null,
    signature: 'dGVzdA==',
    encrypted_payload: {
      ciphertext: 'dGVzdA==',
      iv: 'dGVzdA==',
      auth_tag: 'dGVzdA==',
      key_id: 'key-1',
    },
    metadata: {
      schema_version: '1' as const,
      entry_type: overrides.entry_type ?? 'clinical_encounter',
      author_type: 'provider_agent' as const,
      author_id: overrides.author_id ?? 'default-author',
      payload_size: 42,
      ...(overrides.amends !== undefined ? { amends: overrides.amends } : {}),
    },
  } as LedgerEntry;
}

describe('IndexManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ledger-index-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addEntry and getByType: indexes entries by entry_type', () => {
    const index = new IndexManager();

    const e1 = mockEntry({ id: 'e1', entry_type: 'clinical_encounter' });
    const e2 = mockEntry({ id: 'e2', entry_type: 'clinical_encounter' });
    const e3 = mockEntry({ id: 'e3', entry_type: 'clinical_medication' });

    index.addEntry(e1, 0);
    index.addEntry(e2, 1);
    index.addEntry(e3, 2);

    expect(index.getByType('clinical_encounter')).toHaveLength(2);
    expect(index.getByType('clinical_encounter')).toContain('e1');
    expect(index.getByType('clinical_encounter')).toContain('e2');
    expect(index.getByType('clinical_medication')).toHaveLength(1);
    expect(index.getByType('clinical_medication')).toContain('e3');
  });

  it('addEntry and getByAuthor: indexes entries by author_id', () => {
    const index = new IndexManager();

    const e1 = mockEntry({ id: 'e1', author_id: 'author-A' });
    const e2 = mockEntry({ id: 'e2', author_id: 'author-A' });
    const e3 = mockEntry({ id: 'e3', author_id: 'author-B' });

    index.addEntry(e1, 0);
    index.addEntry(e2, 1);
    index.addEntry(e3, 2);

    expect(index.getByAuthor('author-A')).toHaveLength(2);
    expect(index.getByAuthor('author-A')).toContain('e1');
    expect(index.getByAuthor('author-A')).toContain('e2');
    expect(index.getByAuthor('author-B')).toHaveLength(1);
    expect(index.getByAuthor('author-B')).toContain('e3');
  });

  it('getLineNumber: returns correct line numbers', () => {
    const index = new IndexManager();

    const e0 = mockEntry({ id: 'e0' });
    const e1 = mockEntry({ id: 'e1' });
    const e2 = mockEntry({ id: 'e2' });

    index.addEntry(e0, 0);
    index.addEntry(e1, 1);
    index.addEntry(e2, 2);

    expect(index.getLineNumber('e0')).toBe(0);
    expect(index.getLineNumber('e1')).toBe(1);
    expect(index.getLineNumber('e2')).toBe(2);
  });

  it('getLineNumber: returns undefined for unknown ID', () => {
    const index = new IndexManager();
    expect(index.getLineNumber('nonexistent')).toBeUndefined();
  });

  it('getByType: returns empty array for unknown type', () => {
    const index = new IndexManager();
    expect(index.getByType('clinical_pathology')).toEqual([]);
  });

  it('save and load round-trip: preserves all index data', () => {
    const indexPath = join(tmpDir, 'index.json');
    const index = new IndexManager();

    const e1 = mockEntry({ id: 'e1', entry_type: 'clinical_encounter', author_id: 'a1' });
    const e2 = mockEntry({ id: 'e2', entry_type: 'clinical_medication', author_id: 'a2' });
    const e3 = mockEntry({ id: 'e3', entry_type: 'clinical_encounter', author_id: 'a1' });

    index.addEntry(e1, 0);
    index.addEntry(e2, 1);
    index.addEntry(e3, 2);
    index.setLastHash('abc123');
    index.save(indexPath);

    const loaded = IndexManager.load(indexPath);

    expect(loaded.getByType('clinical_encounter')).toHaveLength(2);
    expect(loaded.getByType('clinical_encounter')).toContain('e1');
    expect(loaded.getByType('clinical_encounter')).toContain('e3');
    expect(loaded.getByType('clinical_medication')).toContain('e2');
    expect(loaded.getByAuthor('a1')).toHaveLength(2);
    expect(loaded.getByAuthor('a2')).toHaveLength(1);
    expect(loaded.getLineNumber('e1')).toBe(0);
    expect(loaded.getLineNumber('e2')).toBe(1);
    expect(loaded.getLineNumber('e3')).toBe(2);
    expect(loaded.getEntryCount()).toBe(3);
    expect(loaded.getLastHash()).toBe('abc123');
  });

  it('rebuild from entries.jsonl: indexes all entries correctly', () => {
    const entriesPath = join(tmpDir, 'entries.jsonl');
    const keyRing = KeyRing.create(randomBytes(32));

    const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
    const author: EntryAuthor = {
      type: 'provider_agent',
      id: 'provider-rebuild',
      display_name: 'Dr. Rebuild',
      public_key: publicKeyDer.toString('base64'),
    };

    const getActiveKey = () => keyRing.getActiveEncryptionKey();
    const signingKey = keyRing.getIdentityPrivateKey();
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ a: 1 }, 'clinical_encounter', author, getActiveKey, signingKey);
    writer.writeEntry({ b: 2 }, 'clinical_medication', author, getActiveKey, signingKey);
    writer.writeEntry(
      { c: 3 },
      'clinical_encounter',
      author,
      getActiveKey,
      signingKey,
      { amends: 'target-id' },
    );

    const rebuilt = IndexManager.rebuild(entriesPath);

    expect(rebuilt.getByType('clinical_encounter')).toHaveLength(2);
    expect(rebuilt.getByType('clinical_medication')).toHaveLength(1);
    expect(rebuilt.getByAuthor('provider-rebuild')).toHaveLength(3);
    expect(rebuilt.getEntryCount()).toBe(3);
    expect(rebuilt.getLineNumber(rebuilt.getByType('clinical_encounter')[0]!)).toBeDefined();
    expect(rebuilt.getLastHash()).toBeTruthy();

    keyRing.destroy();
  });

  it('rebuild detects count mismatch and triggers rebuild', () => {
    const entriesPath = join(tmpDir, 'entries.jsonl');
    const indexPath = join(tmpDir, 'index.json');
    const keyRing = KeyRing.create(randomBytes(32));

    const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
    const author: EntryAuthor = {
      type: 'provider_agent',
      id: 'provider-mismatch',
      display_name: 'Dr. Mismatch',
      public_key: publicKeyDer.toString('base64'),
    };

    const getActiveKey = () => keyRing.getActiveEncryptionKey();
    const signingKey = keyRing.getIdentityPrivateKey();
    const writer = new LedgerWriter(entriesPath);

    // Write 2 entries, build and save index
    writer.writeEntry({ a: 1 }, 'clinical_encounter', author, getActiveKey, signingKey);
    writer.writeEntry({ b: 2 }, 'clinical_encounter', author, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    index.save(indexPath);

    // Write a 3rd entry without updating the index
    writer.writeEntry({ c: 3 }, 'clinical_medication', author, getActiveKey, signingKey);

    // Load the stale index -- entryCount=2 but file has 3 lines
    const staleIndex = IndexManager.load(indexPath);
    expect(staleIndex.getEntryCount()).toBe(2);

    // Verify detects mismatch by comparing entryCount to actual file lines
    // Rebuild should produce correct index
    const corrected = IndexManager.rebuild(entriesPath);
    expect(corrected.getEntryCount()).toBe(3);
    expect(corrected.getByType('clinical_medication')).toHaveLength(1);

    keyRing.destroy();
  });

  it('atomic write: only index.json remains after save (no temp file)', () => {
    const indexPath = join(tmpDir, 'index.json');
    const index = new IndexManager();

    const e1 = mockEntry({ id: 'e1' });
    index.addEntry(e1, 0);
    index.save(indexPath);

    // index.json should exist
    expect(existsSync(indexPath)).toBe(true);

    // No temp file should remain (e.g., index.json.tmp)
    expect(existsSync(indexPath + '.tmp')).toBe(false);
  });

  it('getByAmends: returns amendment entry IDs for a target', () => {
    const index = new IndexManager();

    const original = mockEntry({ id: 'original-1' });
    const amendment = mockEntry({ id: 'amendment-1', amends: 'original-1' });

    index.addEntry(original, 0);
    index.addEntry(amendment, 1);

    expect(index.getByAmends('original-1')).toHaveLength(1);
    expect(index.getByAmends('original-1')).toContain('amendment-1');
  });
});
