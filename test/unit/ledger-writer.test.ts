import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import { decrypt } from '../../src/encryption/aes.js';
import type { EntryAuthor, LedgerEntry } from '../../src/types/ledger.js';
import { LedgerWriter } from '../../src/ledger/writer.js';

/**
 * Shared test helper: creates a temp directory, KeyRing, author, and
 * key accessor functions for LedgerWriter tests.
 */
function createTestFixtures() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ledger-writer-'));
  const entriesPath = join(tmpDir, 'entries.jsonl');
  const keyRing = KeyRing.create(randomBytes(32));

  const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
  const author: EntryAuthor = {
    type: 'provider_agent',
    id: 'provider-test-1',
    display_name: 'Dr. Test',
    public_key: publicKeyDer.toString('base64'),
  };

  const getActiveKey = () => keyRing.getActiveEncryptionKey();
  const getKeyById = (id: string) => keyRing.getEncryptionKey(id);
  const signingKey = keyRing.getIdentityPrivateKey();

  return { tmpDir, entriesPath, keyRing, author, getActiveKey, getKeyById, signingKey };
}

describe('LedgerWriter', () => {
  let fixtures: ReturnType<typeof createTestFixtures>;

  beforeEach(() => {
    fixtures = createTestFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  it('writes genesis entry with prev_hash null', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry(
      { diagnosis: 'Healthy' },
      'clinical_encounter',
      author,
      getActiveKey,
      signingKey,
    );

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;
    expect(entry.prev_hash).toBeNull();
  });

  it('hash-chains second entry to first via SHA-256 of raw JSON line', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ a: 1 }, 'clinical_encounter', author, getActiveKey, signingKey);
    writer.writeEntry({ a: 2 }, 'clinical_encounter', author, getActiveKey, signingKey);

    const lines = readFileSync(entriesPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const firstLineHash = createHash('sha256').update(lines[0]!).digest('hex');
    const secondEntry = JSON.parse(lines[1]!) as LedgerEntry;
    expect(secondEntry.prev_hash).toBe(firstLineHash);
  });

  it('produces encrypted payload with ciphertext, iv, auth_tag, key_id', () => {
    const { entriesPath, keyRing, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ data: 'secret' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    expect(entry.encrypted_payload).toHaveProperty('ciphertext');
    expect(entry.encrypted_payload).toHaveProperty('iv');
    expect(entry.encrypted_payload).toHaveProperty('auth_tag');
    expect(entry.encrypted_payload).toHaveProperty('key_id');
    expect(entry.encrypted_payload.key_id).toBe(keyRing.getActiveKeyId());
  });

  it('produces a valid Ed25519 signature (non-empty base64, 64 bytes decoded)', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ data: 'signed' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    expect(entry.signature).toBeTruthy();
    expect(typeof entry.signature).toBe('string');
    const sigBytes = Buffer.from(entry.signature, 'base64');
    expect(sigBytes.length).toBe(64);
  });

  it('includes all required fields in the written entry', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ check: true }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    // UUIDv7 format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // ISO 8601 with millisecond precision
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry.entry_type).toBe('clinical_encounter');
    expect(entry.author).toEqual(author);
    expect(entry).toHaveProperty('prev_hash');
    expect(entry).toHaveProperty('signature');
    expect(entry).toHaveProperty('encrypted_payload');
    expect(entry).toHaveProperty('metadata');
  });

  it('populates metadata correctly', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ test: 'meta' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    expect(entry.metadata.schema_version).toBe('1');
    expect(entry.metadata.entry_type).toBe('clinical_encounter');
    expect(entry.metadata.author_type).toBe(author.type);
    expect(entry.metadata.author_id).toBe(author.id);
    expect(entry.metadata.payload_size).toBeGreaterThan(0);
  });

  it('stores amendment with metadata.amends referencing the original entry', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    const original = writer.writeEntry(
      { original: true },
      'clinical_encounter',
      author,
      getActiveKey,
      signingKey,
    );

    const amendment = writer.writeEntry(
      { amended: true },
      'clinical_amendment',
      author,
      getActiveKey,
      signingKey,
      { amends: original.id },
    );

    expect(amendment.metadata.amends).toBe(original.id);
  });

  it('recovers last hash after crash (skipping corrupted trailing line)', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;

    const writer1 = new LedgerWriter(entriesPath);
    writer1.writeEntry({ first: true }, 'clinical_encounter', author, getActiveKey, signingKey);

    // Read the valid first line and compute its hash
    const firstLine = readFileSync(entriesPath, 'utf-8').trim().split('\n')[0]!;
    const firstLineHash = createHash('sha256').update(firstLine).digest('hex');

    // Simulate crash: append a corrupted line
    appendFileSync(entriesPath, '{"broken json line\n');

    // New writer should recover and chain from the valid first entry
    const writer2 = new LedgerWriter(entriesPath);
    writer2.writeEntry({ second: true }, 'clinical_encounter', author, getActiveKey, signingKey);

    const lines = readFileSync(entriesPath, 'utf-8').trim().split('\n');
    // Should be: valid entry, corrupted line, new valid entry
    expect(lines.length).toBe(3);

    const lastEntry = JSON.parse(lines[2]!) as LedgerEntry;
    expect(lastEntry.prev_hash).toBe(firstLineHash);
  });

  it('stores author public_key as base64-encoded DER SPKI (44 bytes decoded)', () => {
    const { entriesPath, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ pk: true }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    const decoded = Buffer.from(entry.author.public_key, 'base64');
    expect(decoded.length).toBe(44);
  });

  it('detects AAD metadata tampering on decrypt (CryptoError)', () => {
    const { entriesPath, keyRing, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ secret: 'aad-test' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const raw = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(raw) as LedgerEntry;

    // Tamper with metadata author_id
    const tamperedMeta = { ...entry.metadata, author_id: 'tampered-id' };
    const tamperedAad = Buffer.from(JSON.stringify(tamperedMeta), 'utf-8');

    const key = keyRing.getEncryptionKey(entry.encrypted_payload.key_id);

    // Attempt to decrypt with tampered AAD should fail
    expect(() => decrypt(entry.encrypted_payload, key, tamperedAad)).toThrow();
  });
});
