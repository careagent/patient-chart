import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface ChainVerificationResult {
  valid: boolean;
  entries: number;
  brokenAt?: number;
  error?: string;
}

/**
 * Verifies the hash chain integrity of a JSONL audit log.
 *
 * Walks each line, re-computes SHA-256 of each raw line string, and checks
 * that the next entry's prev_hash matches. Detects:
 * - Inserted entries (prev_hash mismatch)
 * - Modified entries (prev_hash of successor mismatches)
 * - Deleted entries (prev_hash mismatch after gap)
 * - Malformed JSON lines
 * - Genesis entry with non-null prev_hash
 *
 * CRITICAL: Hashes the raw line string (not re-serialized JSON) to match
 * what AuditWriter wrote. Key-order changes from re-serialization would
 * produce incorrect hashes.
 *
 * @param logPath - Absolute path to the JSONL audit log file
 */
export function verifyChain(logPath: string): ChainVerificationResult {
  if (!existsSync(logPath)) {
    return { valid: true, entries: 0 };
  }

  const content = readFileSync(logPath, 'utf-8').trimEnd();
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
