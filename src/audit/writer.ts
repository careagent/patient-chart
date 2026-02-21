import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateUUIDv7 } from '../util/uuidv7.js';
import type { VaultAuditEntry, AuditActor } from '../types/audit.js';

/**
 * Low-level hash-chained JSONL audit writer.
 *
 * Maintains lastHash in memory to avoid reading the file on every append.
 * Hashes the exact raw JSON string written to disk — NOT the re-serialized
 * object — to avoid key-order non-determinism breaking the chain.
 *
 * CRITICAL: The caller provides a fully-formed VaultAuditEntry (minus prev_hash).
 * prev_hash is injected by this class. Callers must NOT compute prev_hash themselves.
 */
export class AuditWriter {
  private lastHash: string | null = null;

  constructor(private readonly logPath: string) {
    this.lastHash = this.recoverLastHash();
  }

  /**
   * Recovers the last hash from an existing JSONL file.
   * Handles crash recovery: skips malformed trailing lines.
   */
  private recoverLastHash(): string | null {
    if (!existsSync(this.logPath)) return null;

    const content = readFileSync(this.logPath, 'utf-8').trimEnd();
    if (!content) return null;

    const lines = content.split('\n').filter((l) => l.trim());
    // Walk from end, find last valid (parseable) line
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        JSON.parse(lines[i]!); // validate parseable
        return createHash('sha256').update(lines[i]!).digest('hex');
      } catch {
        // Malformed last line (crash during write) — try the line before
        continue;
      }
    }
    return null;
  }

  /**
   * Appends a hash-chained entry to the JSONL log.
   * Injects prev_hash from lastHash, computes new lastHash from the written line.
   *
   * @throws if the underlying appendFileSync fails (caller must handle)
   */
  append(entry: Omit<VaultAuditEntry, 'prev_hash'>): void {
    const enriched: VaultAuditEntry = {
      ...entry,
      prev_hash: this.lastHash,
    };
    const line = JSON.stringify(enriched);
    appendFileSync(this.logPath, line + '\n', { flag: 'a' });
    this.lastHash = createHash('sha256').update(line).digest('hex');
  }

  /** Returns the SHA-256 hash of the last written line, or null if no entries written yet. */
  getLastHash(): string | null {
    return this.lastHash;
  }
}

/** Options for VaultAuditPipeline */
export interface VaultAuditPipelineOptions {
  /** Called when an audit entry is dropped after two failed write attempts. Never throws. */
  onAuditError?: (error: Error) => void;
}

/**
 * Non-blocking audit pipeline wrapping AuditWriter.
 *
 * Implements the failure semantics from CONTEXT.md:
 * 1. Try to append entry
 * 2. On failure: retry once
 * 3. On second failure: drop entry, insert audit_gap marker, call onAuditError
 * 4. Never throws to the caller — audit failures must not block vault operations
 *
 * Callers provide event_type, actor, outcome, and details.
 * This class generates id (UUIDv7) and timestamp (ISO 8601 ms precision).
 */
export class VaultAuditPipeline {
  private readonly writer: AuditWriter;
  private readonly onAuditError?: (error: Error) => void;

  constructor(logPath: string, options?: VaultAuditPipelineOptions) {
    this.writer = new AuditWriter(logPath);
    this.onAuditError = options?.onAuditError;
  }

  /**
   * Writes an audit event to the chain.
   * Never throws. Failures are handled internally per CONTEXT.md semantics.
   */
  write(entry: Omit<VaultAuditEntry, 'prev_hash' | 'id' | 'timestamp'>): void {
    const enriched: Omit<VaultAuditEntry, 'prev_hash'> = {
      id: generateUUIDv7(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      this.writer.append(enriched);
      return;
    } catch {
      // First attempt failed — retry once
    }

    try {
      this.writer.append(enriched);
      return;
    } catch (secondError) {
      // Second attempt failed — drop entry and insert gap marker
      const gapEntry: Omit<VaultAuditEntry, 'prev_hash'> = {
        id: generateUUIDv7(),
        timestamp: new Date().toISOString(),
        event_type: 'audit_gap',
        actor: { type: 'system', id: 'system', display_name: 'System' } satisfies AuditActor,
        outcome: 'error',
        details: {
          dropped_event_type: enriched.event_type,
          dropped_timestamp: enriched.timestamp,
          error: secondError instanceof Error ? secondError.message : String(secondError),
        },
      };

      try {
        this.writer.append(gapEntry);
      } catch {
        // Gap marker also failed — silently swallow, chain is broken here
        // The optional onAuditError callback notifies the caller
      }

      this.onAuditError?.(
        secondError instanceof Error ? secondError : new Error(String(secondError)),
      );
    }
  }
}
