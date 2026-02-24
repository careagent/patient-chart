import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import type { EntryAuthor } from '../../src/types/ledger.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { IndexManager } from '../../src/ledger/index-manager.js';
import { queryEntries } from '../../src/ledger/query.js';

/**
 * Test helper: creates a temp directory, KeyRing, LedgerWriter, and
 * utility functions for end-to-end query testing.
 */
function createQueryFixtures() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ledger-query-'));
  const entriesPath = join(tmpDir, 'entries.jsonl');
  const keyRing = KeyRing.create(randomBytes(32));

  const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
  const authorA: EntryAuthor = {
    type: 'provider_agent',
    id: 'author-A',
    display_name: 'Dr. Alpha',
    public_key: publicKeyDer.toString('base64'),
  };

  const authorB: EntryAuthor = {
    type: 'provider_agent',
    id: 'author-B',
    display_name: 'Dr. Beta',
    public_key: publicKeyDer.toString('base64'),
  };

  const getActiveKey = () => keyRing.getActiveEncryptionKey();
  const getKeyById = (id: string) => keyRing.getEncryptionKey(id);
  const signingKey = keyRing.getIdentityPrivateKey();
  const writer = new LedgerWriter(entriesPath);

  return { tmpDir, entriesPath, keyRing, authorA, authorB, getActiveKey, getKeyById, signingKey, writer };
}

describe('queryEntries', () => {
  let fixtures: ReturnType<typeof createQueryFixtures>;

  beforeEach(() => {
    fixtures = createQueryFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  it('filter by single entry_type: returns matching entries only', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'encounter1' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'encounter2' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(entriesPath, index, { entry_type: 'clinical_encounter' }, getKeyById);

    expect(results).toHaveLength(2);
    expect(results[0]!.entry.entry_type).toBe('clinical_encounter');
    expect(results[1]!.entry.entry_type).toBe('clinical_encounter');
  });

  it('filter by multiple entry_types: returns union of matching entries', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'encounter' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', authorA, getActiveKey, signingKey);
    writer.writeEntry({ allergy: 'peanuts' }, 'clinical_allergy', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { entry_type: ['clinical_encounter', 'clinical_medication'] },
      getKeyById,
    );

    expect(results).toHaveLength(2);
    const types = results.map((r) => r.entry.entry_type);
    expect(types).toContain('clinical_encounter');
    expect(types).toContain('clinical_medication');
  });

  it('filter by author_id: returns entries by that author only', () => {
    const { entriesPath, authorA, authorB, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'a1' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'a2' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'b1' }, 'clinical_encounter', authorB, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(entriesPath, index, { author_id: 'author-A' }, getKeyById);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.entry.author.id === 'author-A')).toBe(true);
  });

  it('filter by date_range (from only): returns entries from that timestamp onward', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    // Write 3 entries -- they'll have increasing timestamps
    writer.writeEntry({ seq: 1 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    // Small delay to ensure distinct timestamps
    const e2 = writer.writeEntry({ seq: 2 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    writer.writeEntry({ seq: 3 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { date_range: { from: e2.timestamp } },
      getKeyById,
    );

    // Should include entries with timestamp >= e2.timestamp
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.entry.timestamp >= e2.timestamp)).toBe(true);
  });

  it('filter by date_range (to only): returns entries up to that timestamp', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    const e1 = writer.writeEntry({ seq: 1 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    writer.writeEntry({ seq: 2 }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ seq: 3 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { date_range: { to: e1.timestamp } },
      getKeyById,
    );

    // Should include only entries with timestamp <= e1.timestamp
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.entry.timestamp <= e1.timestamp)).toBe(true);
  });

  it('filter by date_range (from and to): returns entries within the range', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    const e1 = writer.writeEntry({ seq: 1 }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    const e2 = writer.writeEntry({ seq: 2 }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    const e3 = writer.writeEntry({ seq: 3 }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { date_range: { from: e1.timestamp, to: e2.timestamp } },
      getKeyById,
    );

    // Should include entries within the range [e1.timestamp, e2.timestamp]
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.entry.timestamp >= e1.timestamp && r.entry.timestamp <= e2.timestamp)).toBe(true);
    // e3 should NOT be included
    expect(results.every((r) => r.entry.timestamp <= e3.timestamp || r.entry.id === e3.id)).toBe(true);
  });

  it('filter by amends: returns amendments to the specified entry', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    const original = writer.writeEntry(
      { text: 'original' },
      'clinical_encounter',
      authorA,
      getActiveKey,
      signingKey,
    );

    writer.writeEntry(
      { text: 'amendment' },
      'clinical_amendment',
      authorA,
      getActiveKey,
      signingKey,
      { amends: original.id },
    );

    writer.writeEntry(
      { text: 'unrelated' },
      'clinical_encounter',
      authorA,
      getActiveKey,
      signingKey,
    );

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(entriesPath, index, { amends: original.id }, getKeyById);

    expect(results).toHaveLength(1);
    expect(results[0]!.plaintext).toEqual({ text: 'amendment' });
    expect(results[0]!.entry.metadata.amends).toBe(original.id);
  });

  it('combined filters: entry_type AND author_id returns intersection', () => {
    const { entriesPath, authorA, authorB, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'a-enc' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ med: 'a-med' }, 'clinical_medication', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'b-enc' }, 'clinical_encounter', authorB, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { entry_type: 'clinical_encounter', author_id: 'author-A' },
      getKeyById,
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.entry_type).toBe('clinical_encounter');
    expect(results[0]!.entry.author.id).toBe('author-A');
  });

  it('limit and offset: returns the correct subset', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    for (let i = 0; i < 5; i++) {
      writer.writeEntry({ seq: i }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    }

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { limit: 2, offset: 1 },
      getKeyById,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.plaintext).toEqual({ seq: 1 });
    expect(results[1]!.plaintext).toEqual({ seq: 2 });
  });

  it('empty result: non-matching filter returns empty array', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'encounter' }, 'clinical_encounter', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(
      entriesPath,
      index,
      { entry_type: 'clinical_pathology' },
      getKeyById,
    );

    expect(results).toHaveLength(0);
  });

  it('no filter (all entries): returns all entries', () => {
    const { entriesPath, authorA, getActiveKey, getKeyById, signingKey, writer } = fixtures;

    writer.writeEntry({ note: 'a' }, 'clinical_encounter', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'b' }, 'clinical_medication', authorA, getActiveKey, signingKey);
    writer.writeEntry({ note: 'c' }, 'clinical_allergy', authorA, getActiveKey, signingKey);

    const index = IndexManager.rebuild(entriesPath);
    const results = queryEntries(entriesPath, index, {}, getKeyById);

    expect(results).toHaveLength(3);
  });
});
