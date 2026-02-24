import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { decrypt } from '../encryption/aes.js';
import { verifySignature, importEd25519PublicKey } from '../encryption/ed25519.js';
import { canonicalize } from './canonicalize.js';
import { LedgerEntrySchema } from '../types/ledger.js';
import { SignatureVerificationError, LedgerCorruptedError } from './errors.js';
import type { LedgerEntry, SignableContent } from '../types/ledger.js';

/**
 * Read and verify a single ledger entry from a raw JSONL line.
 *
 * Pipeline:
 *   1. Parse JSON and validate against LedgerEntrySchema
 *   2. Reconstruct AAD from entry.metadata
 *   3. Look up decryption key via key_id from encrypted_payload
 *   4. Decrypt payload using AES-256-GCM with AAD
 *   5. Reconstruct SignableContent from decrypted plaintext + entry fields
 *   6. Canonicalize and verify Ed25519 signature
 *   7. Return { entry, plaintext }
 *
 * @param line - A single raw JSON line from entries.jsonl.
 * @param getKeyById - Function to look up a decryption key by its ID.
 * @returns The parsed entry and decrypted plaintext object.
 * @throws {LedgerCorruptedError} If the line is not valid JSON or fails schema validation.
 * @throws {SignatureVerificationError} If Ed25519 signature verification fails.
 * @throws {CryptoError} If decryption fails (wrong key, AAD mismatch, corrupted data).
 */
export function readEntry(
  line: string,
  getKeyById: (keyId: string) => Buffer,
): { entry: LedgerEntry; plaintext: unknown } {
  // 1. Parse and validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new LedgerCorruptedError();
  }

  if (!Value.Check(LedgerEntrySchema, parsed)) {
    throw new LedgerCorruptedError();
  }

  const entry = parsed as LedgerEntry;

  // 2. Reconstruct AAD from metadata
  const aad = Buffer.from(JSON.stringify(entry.metadata), 'utf-8');

  // 3. Look up decryption key
  const key = getKeyById(entry.encrypted_payload.key_id);

  // 4. Decrypt
  const decrypted = decrypt(entry.encrypted_payload, key, aad);
  const plaintextStr = decrypted.toString('utf-8');
  const plaintext: unknown = JSON.parse(plaintextStr);

  // 5. Reconstruct SignableContent
  const signable: SignableContent = {
    id: entry.id,
    timestamp: entry.timestamp,
    entry_type: entry.entry_type,
    author: entry.author,
    payload: plaintextStr,
    metadata: entry.metadata,
  };

  // 6. Canonicalize and verify signature
  const canonical = canonicalize(signable);
  const signatureBuffer = Buffer.from(entry.signature, 'base64');
  const authorPublicKey = importEd25519PublicKey(
    Buffer.from(entry.author.public_key, 'base64'),
  );

  const valid = verifySignature(canonical, signatureBuffer, authorPublicKey);

  // 7. Throw on invalid signature
  if (!valid) {
    throw new SignatureVerificationError(entry.id);
  }

  return { entry, plaintext };
}

/**
 * Read and verify all entries from a JSONL ledger file.
 *
 * @param entriesPath - Path to the entries.jsonl file.
 * @param getKeyById - Function to look up a decryption key by its ID.
 * @returns Array of { entry, plaintext } for each valid line.
 * @throws Propagates errors from readEntry for any malformed/invalid entry.
 */
export function readAllEntries(
  entriesPath: string,
  getKeyById: (keyId: string) => Buffer,
): Array<{ entry: LedgerEntry; plaintext: unknown }> {
  const content = readFileSync(entriesPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  return lines.map((line) => readEntry(line, getKeyById));
}
