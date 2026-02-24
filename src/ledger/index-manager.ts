import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LedgerCorruptedError } from './errors.js';
import type { LedgerEntry, LedgerEntryType } from '../types/ledger.js';

/**
 * Serialized format of the index written to disk as index.json.
 */
interface SerializedIndex {
  byType: Record<string, string[]>;
  byAuthor: Record<string, string[]>;
  byAmends: Record<string, string[]>;
  byId: Record<string, number>;
  entryCount: number;
  lastHash: string | null;
}

/**
 * In-memory index over ledger entries providing O(1) lookups by
 * entry_type, author_id, amends target, and entry ID -> line number.
 *
 * The index is:
 * - Incrementally updated via addEntry() during writes
 * - Persisted to index.json via atomic write-then-rename
 * - Rebuildable from entries.jsonl if corrupted or missing
 */
export class IndexManager {
  private byType = new Map<string, Set<string>>();
  private byAuthor = new Map<string, Set<string>>();
  private byAmends = new Map<string, Set<string>>();
  private byId = new Map<string, number>();
  private lastHash: string | null = null;

  /**
   * Index a ledger entry by its type, author, amends target, and ID -> line number.
   *
   * @param entry - The full LedgerEntry (only unencrypted metadata fields are used).
   * @param lineNumber - The zero-based line number of this entry in entries.jsonl.
   */
  addEntry(entry: LedgerEntry, lineNumber: number): void {
    // Index by entry_type
    const typeKey = entry.entry_type;
    if (!this.byType.has(typeKey)) {
      this.byType.set(typeKey, new Set());
    }
    this.byType.get(typeKey)!.add(entry.id);

    // Index by author_id
    const authorKey = entry.metadata.author_id;
    if (!this.byAuthor.has(authorKey)) {
      this.byAuthor.set(authorKey, new Set());
    }
    this.byAuthor.get(authorKey)!.add(entry.id);

    // Index by amends target (if present)
    if (entry.metadata.amends !== undefined) {
      const amendsKey = entry.metadata.amends;
      if (!this.byAmends.has(amendsKey)) {
        this.byAmends.set(amendsKey, new Set());
      }
      this.byAmends.get(amendsKey)!.add(entry.id);
    }

    // Map entry ID -> line number for direct access
    this.byId.set(entry.id, lineNumber);
  }

  /**
   * Get all entry IDs matching the given entry type.
   * @returns Array of entry IDs, or empty array if no matches.
   */
  getByType(type: LedgerEntryType): string[] {
    const set = this.byType.get(type);
    return set ? [...set] : [];
  }

  /**
   * Get all entry IDs matching the given author ID.
   * @returns Array of entry IDs, or empty array if no matches.
   */
  getByAuthor(authorId: string): string[] {
    const set = this.byAuthor.get(authorId);
    return set ? [...set] : [];
  }

  /**
   * Get all amendment entry IDs that amend the given target entry.
   * @returns Array of amendment entry IDs, or empty array if no matches.
   */
  getByAmends(targetId: string): string[] {
    const set = this.byAmends.get(targetId);
    return set ? [...set] : [];
  }

  /**
   * Get the zero-based line number for the given entry ID.
   * @returns Line number, or undefined if the ID is not indexed.
   */
  getLineNumber(id: string): number | undefined {
    return this.byId.get(id);
  }

  /**
   * Get the number of entries in the index.
   */
  getEntryCount(): number {
    return this.byId.size;
  }

  /**
   * Get the SHA-256 hash of the last indexed entry's raw JSON line.
   */
  getLastHash(): string | null {
    return this.lastHash;
  }

  /**
   * Update the last hash (used during incremental indexing).
   */
  setLastHash(hash: string | null): void {
    this.lastHash = hash;
  }

  /**
   * Get all indexed entry IDs.
   * @returns Array of all entry IDs in the index.
   */
  getAllIds(): string[] {
    return [...this.byId.keys()];
  }

  /**
   * Persist the index to disk using atomic write-then-rename.
   * Writes to a temp file first, then renames to avoid partial writes.
   *
   * @param indexPath - Path to the index.json file.
   */
  save(indexPath: string): void {
    const serialized: SerializedIndex = {
      byType: this.mapOfSetsToRecord(this.byType),
      byAuthor: this.mapOfSetsToRecord(this.byAuthor),
      byAmends: this.mapOfSetsToRecord(this.byAmends),
      byId: Object.fromEntries(this.byId),
      entryCount: this.byId.size,
      lastHash: this.lastHash,
    };

    const json = JSON.stringify(serialized, null, 2);
    const tmpPath = indexPath + '.tmp';

    writeFileSync(tmpPath, json, 'utf-8');
    renameSync(tmpPath, indexPath);
  }

  /**
   * Load an index from a persisted index.json file.
   *
   * @param indexPath - Path to the index.json file.
   * @returns A populated IndexManager, or an empty one if the file doesn't exist.
   * @throws {LedgerCorruptedError} If the file exists but contains malformed JSON.
   */
  static load(indexPath: string): IndexManager {
    if (!existsSync(indexPath)) {
      return new IndexManager();
    }

    let parsed: SerializedIndex;
    try {
      const raw = readFileSync(indexPath, 'utf-8');
      parsed = JSON.parse(raw) as SerializedIndex;
    } catch {
      throw new LedgerCorruptedError();
    }

    const manager = new IndexManager();

    // Restore byType
    for (const [type, ids] of Object.entries(parsed.byType)) {
      manager.byType.set(type, new Set(ids));
    }

    // Restore byAuthor
    for (const [author, ids] of Object.entries(parsed.byAuthor)) {
      manager.byAuthor.set(author, new Set(ids));
    }

    // Restore byAmends
    for (const [target, ids] of Object.entries(parsed.byAmends)) {
      manager.byAmends.set(target, new Set(ids));
    }

    // Restore byId
    for (const [id, lineNum] of Object.entries(parsed.byId)) {
      manager.byId.set(id, lineNum);
    }

    manager.lastHash = parsed.lastHash;

    return manager;
  }

  /**
   * Rebuild the index from scratch by reading entries.jsonl line by line.
   * Used when the index is missing, corrupted, or detected as stale.
   *
   * @param entriesPath - Path to the entries.jsonl file.
   * @returns A fully populated IndexManager.
   */
  static rebuild(entriesPath: string): IndexManager {
    const manager = new IndexManager();

    if (!existsSync(entriesPath)) {
      return manager;
    }

    const content = readFileSync(entriesPath, 'utf-8').trimEnd();
    if (!content) {
      return manager;
    }

    const lines = content.split('\n').filter((l) => l.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let entry: LedgerEntry;
      try {
        entry = JSON.parse(line) as LedgerEntry;
      } catch {
        // Skip malformed lines (crash recovery)
        continue;
      }

      manager.addEntry(entry, i);

      // Track last hash from the raw line
      if (i === lines.length - 1) {
        manager.lastHash = createHash('sha256').update(line).digest('hex');
      }
    }

    return manager;
  }

  /**
   * Convert a Map<string, Set<string>> to a Record<string, string[]> for serialization.
   */
  private mapOfSetsToRecord(map: Map<string, Set<string>>): Record<string, string[]> {
    const record: Record<string, string[]> = {};
    for (const [key, set] of map) {
      record[key] = [...set];
    }
    return record;
  }
}
