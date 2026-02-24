import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import type { EntryAuthor, LedgerEntry } from '../../src/types/ledger.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { readEntry, readAllEntries } from '../../src/ledger/reader.js';
import { SignatureVerificationError } from '../../src/ledger/errors.js';

/**
 * Shared test helper: creates a temp directory, KeyRing, author, and
 * key accessor functions for LedgerReader tests.
 */
function createTestFixtures() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ledger-reader-'));
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

describe('readEntry / readAllEntries', () => {
  let fixtures: ReturnType<typeof createTestFixtures>;

  beforeEach(() => {
    fixtures = createTestFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  it('round-trips write -> read with matching plaintext', () => {
    const { entriesPath, author, getActiveKey, getKeyById, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    const payload = { diagnosis: 'Healthy', notes: 'All clear' };
    writer.writeEntry(payload, 'clinical_encounter', author, getActiveKey, signingKey);

    const line = readFileSync(entriesPath, 'utf-8').trim();
    const result = readEntry(line, getKeyById);

    expect(result.plaintext).toEqual(payload);
  });

  it('throws SignatureVerificationError on tampered signature', () => {
    const { entriesPath, author, getActiveKey, getKeyById, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ data: 'sig-test' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const line = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(line) as LedgerEntry;

    // Tamper with the signature: flip a character
    const sigBytes = Buffer.from(entry.signature, 'base64');
    sigBytes[0] = sigBytes[0]! ^ 0xff;
    entry.signature = sigBytes.toString('base64');

    const tamperedLine = JSON.stringify(entry);

    expect(() => readEntry(tamperedLine, getKeyById)).toThrow(SignatureVerificationError);
  });

  it('uses key_id from EncryptedPayload to look up the correct key', () => {
    const { entriesPath, keyRing, author, getActiveKey, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    writer.writeEntry({ key: 'lookup' }, 'clinical_encounter', author, getActiveKey, signingKey);

    const line = readFileSync(entriesPath, 'utf-8').trim();
    const entry = JSON.parse(line) as LedgerEntry;

    // Verify the key_id in the encrypted payload matches the active key
    expect(entry.encrypted_payload.key_id).toBe(keyRing.getActiveKeyId());

    // The getKeyById function is called with that key_id during read
    let calledWithKeyId: string | undefined;
    const trackingGetKeyById = (id: string) => {
      calledWithKeyId = id;
      return keyRing.getEncryptionKey(id);
    };

    readEntry(line, trackingGetKeyById);
    expect(calledWithKeyId).toBe(entry.encrypted_payload.key_id);
  });

  it('reads all entries from a multi-entry file', () => {
    const { entriesPath, author, getActiveKey, getKeyById, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    const payloads = [
      { seq: 1, note: 'first' },
      { seq: 2, note: 'second' },
      { seq: 3, note: 'third' },
    ];

    for (const p of payloads) {
      writer.writeEntry(p, 'clinical_encounter', author, getActiveKey, signingKey);
    }

    const results = readAllEntries(entriesPath, getKeyById);

    expect(results).toHaveLength(3);
    expect(results[0]!.plaintext).toEqual(payloads[0]);
    expect(results[1]!.plaintext).toEqual(payloads[1]);
    expect(results[2]!.plaintext).toEqual(payloads[2]);
  });

  it('round-trips amendment entries with correct metadata.amends', () => {
    const { entriesPath, author, getActiveKey, getKeyById, signingKey } = fixtures;
    const writer = new LedgerWriter(entriesPath);

    const original = writer.writeEntry(
      { text: 'original' },
      'clinical_encounter',
      author,
      getActiveKey,
      signingKey,
    );

    writer.writeEntry(
      { text: 'amended' },
      'clinical_amendment',
      author,
      getActiveKey,
      signingKey,
      { amends: original.id },
    );

    const results = readAllEntries(entriesPath, getKeyById);

    expect(results).toHaveLength(2);

    // Original round-trips
    expect(results[0]!.plaintext).toEqual({ text: 'original' });
    expect(results[0]!.entry.metadata.amends).toBeUndefined();

    // Amendment round-trips with correct amends reference
    expect(results[1]!.plaintext).toEqual({ text: 'amended' });
    expect(results[1]!.entry.metadata.amends).toBe(original.id);
  });
});
