import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readEntry } from './reader.js';
import { SignatureVerificationError, LedgerCorruptedError } from './errors.js';
import { CryptoError } from '../encryption/errors.js';

/**
 * Result of a chain-only verification (fast, no decryption).
 */
export interface LedgerChainResult {
  valid: boolean;
  entries: number;
  brokenAt?: number;
  error?: string;
}

/**
 * Result of a full integrity verification (chain + signatures + decryption).
 */
export interface LedgerIntegrityResult {
  valid: boolean;
  entries: number;
  brokenAt?: number;
  error?: string;
  errorType?: 'chain' | 'signature' | 'decryption' | 'schema' | 'json';
}

/**
 * Verifies the hash chain integrity of a JSONL ledger file.
 *
 * Chain-only verification: fast, requires no decryption or key ring.
 * Walks each line, re-computes SHA-256 of each raw line string, and checks
 * that the next entry's prev_hash matches. Detects:
 * - Inserted entries (prev_hash mismatch)
 * - Modified entries (prev_hash of successor mismatches)
 * - Deleted entries (prev_hash mismatch after gap)
 * - Malformed JSON lines
 * - Genesis entry with non-null prev_hash
 *
 * CRITICAL: Hashes the raw line string (not re-serialized JSON) to match
 * what LedgerWriter wrote. Key-order changes from re-serialization would
 * produce incorrect hashes.
 *
 * @param entriesPath - Absolute path to the entries.jsonl file.
 */
export function verifyLedgerChain(entriesPath: string): LedgerChainResult {
  if (!existsSync(entriesPath)) {
    return { valid: true, entries: 0 };
  }

  const content = readFileSync(entriesPath, 'utf-8').trimEnd();
  if (!content) {
    return { valid: true, entries: 0 };
  }

  const lines = content.split('\n').filter((l) => l.trim());
  let expectedPrevHash: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let parsed: { prev_hash: string | null; [key: string]: unknown };

    try {
      parsed = JSON.parse(line) as { prev_hash: string | null; [key: string]: unknown };
    } catch {
      return {
        valid: false,
        entries: i,
        brokenAt: i,
        error: `Malformed JSON at line ${i + 1}`,
      };
    }

    if (parsed.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        entries: i,
        brokenAt: i,
        error: `Chain broken at entry ${i}: expected prev_hash ${String(expectedPrevHash)}, got ${String(parsed.prev_hash)}`,
      };
    }

    // Update expected hash for next iteration using the RAW LINE STRING
    expectedPrevHash = createHash('sha256').update(line).digest('hex');
  }

  return { valid: true, entries: lines.length };
}

/**
 * Verifies the full integrity of a JSONL ledger file: hash chain,
 * decryption, and Ed25519 signature verification for every entry.
 *
 * Full verification: expensive but comprehensive. Requires key access
 * for decryption and signature checking.
 *
 * Detects everything verifyLedgerChain detects, plus:
 * - Signature failures (tampered signable content)
 * - Decryption failures (wrong key, tampered ciphertext/AAD)
 * - Schema validation failures (corrupted entry structure)
 *
 * @param entriesPath - Absolute path to the entries.jsonl file.
 * @param getKeyById - Function to look up a decryption key by its ID.
 */
export function verifyLedgerIntegrity(
  entriesPath: string,
  getKeyById: (keyId: string) => Buffer,
): LedgerIntegrityResult {
  if (!existsSync(entriesPath)) {
    return { valid: true, entries: 0 };
  }

  const content = readFileSync(entriesPath, 'utf-8').trimEnd();
  if (!content) {
    return { valid: true, entries: 0 };
  }

  const lines = content.split('\n').filter((l) => l.trim());
  let expectedPrevHash: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Step 1: Parse JSON
    let parsed: { prev_hash: string | null; [key: string]: unknown };
    try {
      parsed = JSON.parse(line) as { prev_hash: string | null; [key: string]: unknown };
    } catch {
      return {
        valid: false,
        entries: i,
        brokenAt: i,
        error: `Malformed JSON at line ${i + 1}`,
        errorType: 'json',
      };
    }

    // Step 2: Verify hash chain
    if (parsed.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        entries: i,
        brokenAt: i,
        error: `Chain broken at entry ${i}: expected prev_hash ${String(expectedPrevHash)}, got ${String(parsed.prev_hash)}`,
        errorType: 'chain',
      };
    }

    // Step 3: Decrypt and verify signature via readEntry
    try {
      readEntry(line, getKeyById);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        return {
          valid: false,
          entries: i,
          brokenAt: i,
          error: (err as Error).message,
          errorType: 'signature',
        };
      }
      if (err instanceof LedgerCorruptedError) {
        return {
          valid: false,
          entries: i,
          brokenAt: i,
          error: (err as Error).message,
          errorType: 'schema',
        };
      }
      if (err instanceof CryptoError) {
        return {
          valid: false,
          entries: i,
          brokenAt: i,
          error: (err as Error).message,
          errorType: 'decryption',
        };
      }
      // Unknown error -- surface it
      return {
        valid: false,
        entries: i,
        brokenAt: i,
        error: (err as Error).message,
        errorType: 'json',
      };
    }

    // Update expected hash for next iteration using the RAW LINE STRING
    expectedPrevHash = createHash('sha256').update(line).digest('hex');
  }

  return { valid: true, entries: lines.length };
}
