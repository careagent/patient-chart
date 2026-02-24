import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import type { EntryAuthor, LedgerEntry } from '../../src/types/ledger.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { verifyLedgerChain, verifyLedgerIntegrity } from '../../src/ledger/integrity.js';

/**
 * Shared test helper: creates a temp directory, KeyRing, author, and
 * key accessor functions for ledger integrity tests.
 */
function createTestFixtures() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ledger-integrity-'));
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

/** Write N entries to disk via LedgerWriter and return the writer */
function writeEntries(
  entriesPath: string,
  count: number,
  fixtures: ReturnType<typeof createTestFixtures>,
): LedgerWriter {
  const writer = new LedgerWriter(entriesPath);
  for (let i = 0; i < count; i++) {
    writer.writeEntry(
      { seq: i + 1, note: `entry-${i + 1}` },
      'clinical_encounter',
      fixtures.author,
      fixtures.getActiveKey,
      fixtures.signingKey,
    );
  }
  return writer;
}

describe('verifyLedgerChain', () => {
  let fixtures: ReturnType<typeof createTestFixtures>;

  beforeEach(() => {
    fixtures = createTestFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  it('valid chain: 3 entries returns valid true with correct count', () => {
    writeEntries(fixtures.entriesPath, 3, fixtures);

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
    expect(result.brokenAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('missing file: returns valid true with 0 entries', () => {
    const result = verifyLedgerChain(join(fixtures.tmpDir, 'nonexistent.jsonl'));

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('empty file: returns valid true with 0 entries', () => {
    writeFileSync(fixtures.entriesPath, '', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('tampered entry (chain break): detects modification of second entry', () => {
    writeEntries(fixtures.entriesPath, 3, fixtures);

    // Tamper with the second entry's content
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    const entry = JSON.parse(lines[1]!) as LedgerEntry;
    // Modify a field -- this changes the raw JSON line but keeps prev_hash intact
    // However the THIRD entry's prev_hash won't match the new hash of line 2
    (entry as Record<string, unknown>).timestamp = '2020-01-01T00:00:00.000Z';
    lines[1] = JSON.stringify(entry);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.error).toContain('Chain broken');
  });

  it('inserted entry: detects a fake entry injected between valid entries', () => {
    writeEntries(fixtures.entriesPath, 2, fixtures);

    // Insert a fake entry between line 0 and line 1
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    const fakeEntry = JSON.stringify({
      id: 'fake-id',
      timestamp: '2025-01-01T00:00:00.000Z',
      entry_type: 'clinical_encounter',
      prev_hash: 'fake-hash',
      signature: 'fake-sig',
      encrypted_payload: {},
      metadata: {},
    });
    lines.splice(1, 0, fakeEntry);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(false);
    // The fake entry at index 1 has wrong prev_hash
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain('Chain broken');
  });

  it('deleted entry: detects removal of the second entry from a 3-entry chain', () => {
    writeEntries(fixtures.entriesPath, 3, fixtures);

    // Remove the second entry (index 1)
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    lines.splice(1, 1);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(false);
    // Entry at index 1 (originally index 2) expects prev_hash of deleted entry
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain('Chain broken');
  });

  it('malformed JSON: detects unparseable line', () => {
    writeEntries(fixtures.entriesPath, 2, fixtures);

    // Append a malformed line
    const content = readFileSync(fixtures.entriesPath, 'utf-8');
    writeFileSync(fixtures.entriesPath, content + '{not valid json\n', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.error).toContain('Malformed JSON');
  });

  it('genesis with non-null prev_hash: detects invalid genesis entry', () => {
    writeEntries(fixtures.entriesPath, 1, fixtures);

    // Modify the genesis entry's prev_hash to a non-null value
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    const entry = JSON.parse(lines[0]!) as LedgerEntry;
    (entry as Record<string, unknown>).prev_hash = 'not-null-hash';
    lines[0] = JSON.stringify(entry);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerChain(fixtures.entriesPath);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.error).toContain('Chain broken at entry 0');
  });
});

describe('verifyLedgerIntegrity', () => {
  let fixtures: ReturnType<typeof createTestFixtures>;

  beforeEach(() => {
    fixtures = createTestFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  it('full integrity - valid: 3 entries pass full chain + signature verification', () => {
    writeEntries(fixtures.entriesPath, 3, fixtures);

    const result = verifyLedgerIntegrity(fixtures.entriesPath, fixtures.getKeyById);

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
    expect(result.brokenAt).toBeUndefined();
    expect(result.errorType).toBeUndefined();
  });

  it('full integrity - signature tamper: detects tampered signature field', () => {
    writeEntries(fixtures.entriesPath, 1, fixtures);

    // Tamper with the signature in the raw file
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    const entry = JSON.parse(lines[0]!) as LedgerEntry;

    // Flip bytes in the signature
    const sigBytes = Buffer.from(entry.signature, 'base64');
    sigBytes[0] = sigBytes[0]! ^ 0xff;
    entry.signature = sigBytes.toString('base64');

    // Must preserve prev_hash and rewrite exactly
    lines[0] = JSON.stringify(entry);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerIntegrity(fixtures.entriesPath, fixtures.getKeyById);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.errorType).toBe('signature');
  });

  it('full integrity - payload tamper: detects tampered encrypted ciphertext', () => {
    writeEntries(fixtures.entriesPath, 1, fixtures);

    // Tamper with the encrypted_payload ciphertext
    const lines = readFileSync(fixtures.entriesPath, 'utf-8').trimEnd().split('\n');
    const entry = JSON.parse(lines[0]!) as LedgerEntry;

    // Flip bytes in the ciphertext to cause decryption failure
    const ctBytes = Buffer.from(entry.encrypted_payload.ciphertext, 'base64');
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    entry.encrypted_payload.ciphertext = ctBytes.toString('base64');

    lines[0] = JSON.stringify(entry);
    writeFileSync(fixtures.entriesPath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLedgerIntegrity(fixtures.entriesPath, fixtures.getKeyById);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.errorType).toBe('decryption');
  });
});
