import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { AclManager } from '../../src/acl/manager.js';
import { ChartReader, createChartReader } from '../../src/chart/reader.js';
import { KnowledgeStore } from '../../src/knowledge/store.js';
import type { EntryAuthor } from '../../src/types/ledger.js';

/**
 * Shared test fixtures: creates a vault-like directory structure with
 * a KeyRing, LedgerWriter, AclManager, and ChartReader.
 */
function createChartReaderFixtures() {
  const vaultPath = mkdtempSync(join(tmpdir(), 'chart-reader-'));
  const ledgerDir = join(vaultPath, 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const knowledgeDir = join(vaultPath, 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });

  const entriesPath = join(ledgerDir, 'entries.jsonl');
  const keyRing = KeyRing.create(randomBytes(32));

  const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
  const patientAuthor: EntryAuthor = {
    type: 'patient_agent',
    id: 'patient-001',
    display_name: 'Test Patient',
    public_key: publicKeyDer.toString('base64'),
  };

  const providerAuthor: EntryAuthor = {
    type: 'provider_agent',
    id: 'provider-123',
    display_name: 'Dr. Smith',
    public_key: publicKeyDer.toString('base64'),
  };

  const getActiveKey = () => keyRing.getActiveEncryptionKey();
  const getKeyById = (id: string) => keyRing.getEncryptionKey(id);
  const signingKey = keyRing.getIdentityPrivateKey();

  const writer = new LedgerWriter(entriesPath);
  const acl = new AclManager(
    writer,
    entriesPath,
    patientAuthor,
    getActiveKey,
    getKeyById,
    signingKey,
  );

  const reader = createChartReader({ vaultPath, getActiveKey, getKeyById });

  return {
    vaultPath,
    entriesPath,
    keyRing,
    patientAuthor,
    providerAuthor,
    getActiveKey,
    getKeyById,
    signingKey,
    writer,
    acl,
    reader,
  };
}

describe('ChartReader', () => {
  let fixtures: ReturnType<typeof createChartReaderFixtures>;

  beforeEach(() => {
    fixtures = createChartReaderFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.vaultPath, { recursive: true, force: true });
  });

  // ===== AC1: Public TypeScript API module exported =====
  describe('factory function', () => {
    it('createChartReader returns a ChartReader instance', () => {
      const { reader } = fixtures;
      expect(reader).toBeInstanceOf(ChartReader);
    });

    it('ChartReader constructor accepts vaultPath, getActiveKey, getKeyById', () => {
      const { vaultPath, getActiveKey, getKeyById } = fixtures;
      const r = new ChartReader({ vaultPath, getActiveKey, getKeyById });
      expect(r).toBeInstanceOf(ChartReader);
    });
  });

  // ===== AC2: Query by entry type =====
  describe('query by entry type', () => {
    it('filters entries by a single entry type', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Grant read:medications permission
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications', 'read:encounters']);

      // Write entries of different types
      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ med: 'ibuprofen' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.entry_type === 'clinical_medication')).toBe(true);
    });

    it('filters entries by multiple entry types (union)', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', [
        'read:medications',
        'read:allergies',
        'read:encounters',
      ]);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ allergy: 'peanuts' }, 'clinical_allergy', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication', 'clinical_allergy'],
      });

      expect(result.entries).toHaveLength(2);
      const types = result.entries.map((e) => e.entry_type);
      expect(types).toContain('clinical_medication');
      expect(types).toContain('clinical_allergy');
    });
  });

  // ===== AC3: Query by date range =====
  describe('query by date range', () => {
    it('filters entries by from_date (inclusive)', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      writer.writeEntry({ seq: 1 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      const e2 = writer.writeEntry({ seq: 2 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ seq: 3 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        from_date: e2.timestamp,
      });

      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      expect(result.entries.every((e) => e.timestamp >= e2.timestamp)).toBe(true);
    });

    it('filters entries by to_date (inclusive)', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      const e1 = writer.writeEntry({ seq: 1 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ seq: 2 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ seq: 3 }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        to_date: e1.timestamp,
      });

      expect(result.entries.length).toBeGreaterThanOrEqual(1);
      expect(result.entries.every((e) => e.timestamp <= e1.timestamp)).toBe(true);
    });
  });

  // ===== AC4: Combined filters =====
  describe('combined filters', () => {
    it('combines entry type + date range filters', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications', 'read:encounters']);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      const enc = writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ med: 'ibuprofen' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
        from_date: enc.timestamp,
      });

      // Should only get medications from enc.timestamp onwards
      expect(result.entries.every((e) => e.entry_type === 'clinical_medication')).toBe(true);
      expect(result.entries.every((e) => e.timestamp >= enc.timestamp)).toBe(true);
    });

    it('applies custom predicate filter', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry({ med: 'aspirin', dose: 100 }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ med: 'ibuprofen', dose: 200 }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ med: 'tylenol', dose: 500 }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
        predicate: (_entry, plaintext) => {
          const p = plaintext as { dose: number };
          return p.dose >= 200;
        },
      });

      expect(result.entries).toHaveLength(2);
    });
  });

  // ===== AC5: Knowledge graph reads =====
  describe('knowledge graph reads', () => {
    it('readKnowledgeNote returns decrypted content for authorized requester', () => {
      const { acl, reader, vaultPath, getActiveKey, getKeyById } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:knowledge']);

      // Write a knowledge note
      const store = new KnowledgeStore(vaultPath, getActiveKey, getKeyById);
      store.writeNote('conditions/diabetes', '# Type 2 Diabetes\n\nDiagnosed 2024.');

      const result = reader.readKnowledgeNote('provider-123', 'conditions/diabetes');

      expect(result).not.toBeNull();
      expect(result!.path).toBe('conditions/diabetes');
      expect(result!.content).toBe('# Type 2 Diabetes\n\nDiagnosed 2024.');
    });

    it('readKnowledgeNote returns null for unauthorized requester', () => {
      const { acl, reader, vaultPath, getActiveKey, getKeyById } = fixtures;

      // Grant something other than read:knowledge
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      const store = new KnowledgeStore(vaultPath, getActiveKey, getKeyById);
      store.writeNote('conditions/diabetes', '# Diabetes');

      const result = reader.readKnowledgeNote('provider-123', 'conditions/diabetes');
      expect(result).toBeNull();
    });

    it('readKnowledgeNote returns null for non-existent note', () => {
      const { acl, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:knowledge']);

      const result = reader.readKnowledgeNote('provider-123', 'conditions/nonexistent');
      expect(result).toBeNull();
    });

    it('listKnowledgeNotes returns note list for authorized requester', () => {
      const { acl, reader, vaultPath, getActiveKey, getKeyById } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:knowledge']);

      const store = new KnowledgeStore(vaultPath, getActiveKey, getKeyById);
      store.writeNote('conditions/diabetes', '# Diabetes');
      store.writeNote('conditions/hypertension', '# Hypertension');

      const notes = reader.listKnowledgeNotes('provider-123', 'conditions');

      expect(notes).toHaveLength(2);
      expect(notes).toContain('diabetes');
      expect(notes).toContain('hypertension');
    });

    it('listKnowledgeNotes returns empty array for unauthorized requester', () => {
      const { acl, reader, vaultPath, getActiveKey, getKeyById } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      const store = new KnowledgeStore(vaultPath, getActiveKey, getKeyById);
      store.writeNote('conditions/diabetes', '# Diabetes');

      const notes = reader.listKnowledgeNotes('provider-123');
      expect(notes).toHaveLength(0);
    });
  });

  // ===== AC6: ACL enforcement on every read =====
  describe('ACL enforcement', () => {
    it('returns empty results for requester with no grants', () => {
      const { writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'unknown-entity',
      });

      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('returns only entries matching granted permissions', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Only grant read:medications
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ allergy: 'peanuts' }, 'clinical_allergy', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({ requester_id: 'provider-123' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.entry_type).toBe('clinical_medication');
    });

    it('returns empty when requesting an unauthorized entry type', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_encounter'],
      });

      expect(result.entries).toHaveLength(0);
    });

    it('denies access after grant revocation', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);
      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      // Should work before revocation
      const before = reader.query({ requester_id: 'provider-123' });
      expect(before.entries).toHaveLength(1);

      // Revoke
      acl.revoke(grant.id, 'provider-123');

      // Should be empty after revocation
      const after = reader.query({ requester_id: 'provider-123' });
      expect(after.entries).toHaveLength(0);
    });

    it('denies access after grant expiration', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Grant with past expiration
      acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:medications'],
        { expiresAt: '2020-01-01T00:00:00.000Z' },
      );

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({ requester_id: 'provider-123' });
      expect(result.entries).toHaveLength(0);
    });
  });

  // ===== AC7: Unauthorized reads return empty result =====
  describe('deny-by-default (no leakage)', () => {
    it('query returns empty result (not error) for unauthorized requester', () => {
      const { writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      writer.writeEntry({ secret: 'data' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({ requester_id: 'unauthorized-entity' });

      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('getEntry returns null (not error) for unauthorized requester', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Grant some permission to a different entity
      acl.grant('other-entity', 'provider', 'Dr. Other', ['read:encounters']);

      const entry = writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      const result = reader.getEntry('unauthorized-entity', entry.id);
      expect(result).toBeNull();
    });

    it('getEntry returns null for non-existent entry ID', () => {
      const { acl, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      const result = reader.getEntry('provider-123', 'nonexistent-id');
      expect(result).toBeNull();
    });
  });

  // ===== AC8: Decryption =====
  describe('decryption', () => {
    it('returns decrypted payload to authorized requester', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry(
        { medication: 'Metformin', dose: '500mg', frequency: 'BID' },
        'clinical_medication',
        patientAuthor,
        getActiveKey,
        signingKey,
      );

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.payload).toEqual({
        medication: 'Metformin',
        dose: '500mg',
        frequency: 'BID',
      });
    });

    it('decrypts entries with rotated keys', () => {
      const { acl, writer, patientAuthor, keyRing, signingKey, reader } = fixtures;
      const getKeyById = (id: string) => keyRing.getEncryptionKey(id);

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      // Write with original key
      const getKey1 = () => keyRing.getActiveEncryptionKey();
      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getKey1, signingKey);

      // Rotate key
      keyRing.rotate();

      // Write with rotated key
      const getKey2 = () => keyRing.getActiveEncryptionKey();
      writer.writeEntry({ med: 'ibuprofen' }, 'clinical_medication', patientAuthor, getKey2, signingKey);

      // Create a new reader that uses the up-to-date keyring
      const freshReader = createChartReader({
        vaultPath: fixtures.vaultPath,
        getActiveKey: getKey2,
        getKeyById,
      });

      const result = freshReader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.payload).toEqual({ med: 'aspirin' });
      expect(result.entries[1]!.payload).toEqual({ med: 'ibuprofen' });
    });
  });

  // ===== AC9: Pagination =====
  describe('pagination', () => {
    it('respects limit parameter', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      for (let i = 0; i < 10; i++) {
        writer.writeEntry({ seq: i }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      }

      const result = reader.query({
        requester_id: 'provider-123',
        limit: 3,
      });

      expect(result.entries).toHaveLength(3);
      expect(result.has_more).toBe(true);
      expect(result.next_cursor).not.toBeNull();
      expect(result.total).toBe(10);
    });

    it('default limit is 50', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      for (let i = 0; i < 60; i++) {
        writer.writeEntry({ seq: i }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      }

      const result = reader.query({ requester_id: 'provider-123' });

      expect(result.entries).toHaveLength(50);
      expect(result.has_more).toBe(true);
    });

    it('cursor-based pagination returns next page', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      for (let i = 0; i < 10; i++) {
        writer.writeEntry({ seq: i }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      }

      // Get first page
      const page1 = reader.query({
        requester_id: 'provider-123',
        limit: 3,
      });

      expect(page1.entries).toHaveLength(3);
      expect(page1.has_more).toBe(true);

      // Get second page using cursor
      const page2 = reader.query({
        requester_id: 'provider-123',
        limit: 3,
        cursor: page1.next_cursor!,
      });

      expect(page2.entries).toHaveLength(3);
      expect(page2.has_more).toBe(true);

      // No overlap between pages
      const page1Ids = page1.entries.map((e) => e.id);
      const page2Ids = page2.entries.map((e) => e.id);
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
    });

    it('last page has has_more=false and next_cursor=null', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      for (let i = 0; i < 5; i++) {
        writer.writeEntry({ seq: i }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      }

      const result = reader.query({
        requester_id: 'provider-123',
        limit: 10,
      });

      expect(result.entries).toHaveLength(5);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('max limit is capped at 500', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:encounters']);

      for (let i = 0; i < 5; i++) {
        writer.writeEntry({ seq: i }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      }

      // Request limit > 500 — should be capped
      const result = reader.query({
        requester_id: 'provider-123',
        limit: 1000,
      });

      // Should still return all 5 (they're within the 500 cap)
      expect(result.entries).toHaveLength(5);
    });
  });

  // ===== AC10: TypeBox schemas =====
  describe('TypeBox schemas', () => {
    it('ChartQueryParamsSchema is importable and valid', async () => {
      const { ChartQueryParamsSchema } = await import('../../src/types/chart-read.js');
      expect(ChartQueryParamsSchema).toBeDefined();
      expect(ChartQueryParamsSchema.type).toBe('object');
    });

    it('ChartEntryResultSchema is importable and valid', async () => {
      const { ChartEntryResultSchema } = await import('../../src/types/chart-read.js');
      expect(ChartEntryResultSchema).toBeDefined();
      expect(ChartEntryResultSchema.type).toBe('object');
    });

    it('ChartQueryResultSchema is importable and valid', async () => {
      const { ChartQueryResultSchema } = await import('../../src/types/chart-read.js');
      expect(ChartQueryResultSchema).toBeDefined();
      expect(ChartQueryResultSchema.type).toBe('object');
    });

    it('ChartIntegrityResultSchema is importable and valid', async () => {
      const { ChartIntegrityResultSchema } = await import('../../src/types/chart-read.js');
      expect(ChartIntegrityResultSchema).toBeDefined();
      expect(ChartIntegrityResultSchema.type).toBe('object');
    });

    it('KnowledgeReadResultSchema is importable and valid', async () => {
      const { KnowledgeReadResultSchema } = await import('../../src/types/chart-read.js');
      expect(KnowledgeReadResultSchema).toBeDefined();
      expect(KnowledgeReadResultSchema.type).toBe('object');
    });

    it('DEFAULT_QUERY_LIMIT and MAX_QUERY_LIMIT are exported', async () => {
      const { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } = await import('../../src/types/chart-read.js');
      expect(DEFAULT_QUERY_LIMIT).toBe(50);
      expect(MAX_QUERY_LIMIT).toBe(500);
    });

    it('schemas validate correct query result data', async () => {
      const { Value } = await import('@sinclair/typebox/value');
      const { ChartQueryResultSchema } = await import('../../src/types/chart-read.js');

      const valid = Value.Check(ChartQueryResultSchema, {
        entries: [{
          id: 'test-id',
          timestamp: '2025-01-01T00:00:00.000Z',
          entry_type: 'clinical_medication',
          author_id: 'provider-123',
          author_display_name: 'Dr. Smith',
          payload: { med: 'aspirin' },
        }],
        total: 1,
        next_cursor: null,
        has_more: false,
      });

      expect(valid).toBe(true);
    });
  });

  // ===== getEntry =====
  describe('getEntry', () => {
    it('returns decrypted entry by ID for authorized requester', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      const entry = writer.writeEntry(
        { medication: 'Aspirin', dose: '81mg' },
        'clinical_medication',
        patientAuthor,
        getActiveKey,
        signingKey,
      );

      const result = reader.getEntry('provider-123', entry.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(entry.id);
      expect(result!.entry_type).toBe('clinical_medication');
      expect(result!.payload).toEqual({ medication: 'Aspirin', dose: '81mg' });
    });

    it('returns null for unauthorized requester (no leakage)', () => {
      const { writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      const entry = writer.writeEntry(
        { medication: 'Aspirin' },
        'clinical_medication',
        patientAuthor,
        getActiveKey,
        signingKey,
      );

      const result = reader.getEntry('unauthorized-entity', entry.id);
      expect(result).toBeNull();
    });
  });

  // ===== verifyIntegrity =====
  describe('verifyIntegrity', () => {
    it('chain-only verification returns valid for good ledger', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);
      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.entries).toBeGreaterThanOrEqual(2);
    });

    it('full verification returns valid for good ledger', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);
      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.verifyIntegrity({ full: true });
      expect(result.valid).toBe(true);
    });

    it('returns valid for empty/nonexistent ledger', () => {
      const { vaultPath, getActiveKey, getKeyById } = fixtures;
      const emptyVault = mkdtempSync(join(tmpdir(), 'empty-vault-'));
      mkdirSync(join(emptyVault, 'ledger'), { recursive: true });

      const emptyReader = createChartReader({
        vaultPath: emptyVault,
        getActiveKey,
        getKeyById,
      });

      const result = emptyReader.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(0);

      rmSync(emptyVault, { recursive: true, force: true });
    });
  });

  // ===== Multiple permissions =====
  describe('multiple permissions', () => {
    it('returns entries across multiple permitted types', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', [
        'read:medications',
        'read:allergies',
        'read:encounters',
      ]);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ allergy: 'peanuts' }, 'clinical_allergy', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ enc: 'visit' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);
      writer.writeEntry({ diag: 'flu' }, 'clinical_diagnosis', patientAuthor, getActiveKey, signingKey);

      // Query without type filter — should get all permitted types (3 types)
      const result = reader.query({ requester_id: 'provider-123' });

      // Should include medication, allergy, encounter — NOT diagnosis
      expect(result.entries).toHaveLength(3);
      const types = result.entries.map((e) => e.entry_type);
      expect(types).not.toContain('clinical_diagnosis');
    });
  });

  // ===== Entry result shape =====
  describe('entry result shape', () => {
    it('ChartEntryResult contains expected fields', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry(
        { medication: 'Aspirin' },
        'clinical_medication',
        patientAuthor,
        getActiveKey,
        signingKey,
      );

      const result = reader.query({
        requester_id: 'provider-123',
        entry_types: ['clinical_medication'],
      });

      const entry = result.entries[0]!;
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.entry_type).toBe('clinical_medication');
      expect(entry.author_id).toBe('patient-001');
      expect(entry.author_display_name).toBe('Test Patient');
      expect(entry.payload).toEqual({ medication: 'Aspirin' });
    });
  });

  // ===== ACL entries filtered correctly =====
  describe('ACL entry type filtering', () => {
    it('ACL entries are only returned if requester has read:access_control', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Grant both medication access and ACL access
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications', 'read:access_control']);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({ requester_id: 'provider-123' });

      // Should see medications + ACL entries (the grant itself)
      const types = new Set(result.entries.map((e) => e.entry_type));
      expect(types.has('clinical_medication')).toBe(true);
      expect(types.has('access_grant_created')).toBe(true);
    });

    it('ACL entries are hidden if requester only has clinical permissions', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, reader } = fixtures;

      // Grant only medication access
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:medications']);

      writer.writeEntry({ med: 'aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      const result = reader.query({ requester_id: 'provider-123' });

      // Should only see medications — NOT the ACL grant entry
      expect(result.entries.every((e) => e.entry_type === 'clinical_medication')).toBe(true);
    });
  });

  // ===== Barrel exports =====
  describe('barrel exports', () => {
    it('createChartReader is importable from index', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.createChartReader).toBeDefined();
      expect(typeof mod.createChartReader).toBe('function');
    });

    it('ChartReader is importable from index', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.ChartReader).toBeDefined();
    });

    it('ChartQueryParamsSchema is importable from index', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.ChartQueryParamsSchema).toBeDefined();
    });

    it('DEFAULT_QUERY_LIMIT is importable from index', async () => {
      const mod = await import('../../src/index.js');
      expect(mod.DEFAULT_QUERY_LIMIT).toBe(50);
    });
  });
});
