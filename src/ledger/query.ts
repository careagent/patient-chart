import { readFileSync } from 'node:fs';
import { readEntry } from './reader.js';
import { IndexManager } from './index-manager.js';
import type { LedgerEntry, LedgerEntryType } from '../types/ledger.js';

/**
 * Filter criteria for querying ledger entries.
 *
 * All fields are optional. When multiple fields are specified, they are ANDed
 * (intersection). Index-backed fields (entry_type, author_id, amends) reduce
 * the candidate set to O(1) before applying remaining filters.
 */
export interface LedgerQuery {
  /** Filter by entry type. Single type or array of types (union). */
  entry_type?: LedgerEntryType | LedgerEntryType[];
  /** Filter by author ID. */
  author_id?: string;
  /** Filter by ISO 8601 date range. String comparison (ISO sorts chronologically). */
  date_range?: { from?: string; to?: string };
  /** Filter for amendments that amend the given entry ID. */
  amends?: string;
  /** Maximum number of results to return. */
  limit?: number;
  /** Number of results to skip before returning. */
  offset?: number;
}

/**
 * Query ledger entries using index-backed candidate reduction and
 * additional filtering on date range.
 *
 * Strategy:
 * 1. Use index to get candidate IDs (O(1) per filter dimension)
 * 2. Intersect candidate sets for combined filters
 * 3. Read file once as array of lines, access by line number
 * 4. Apply date_range filter on candidates
 * 5. Decrypt and verify each matching entry via readEntry()
 * 6. Apply limit/offset on results
 *
 * @param entriesPath - Path to the entries.jsonl file.
 * @param index - An IndexManager with the current index state.
 * @param query - Filter criteria.
 * @param getKeyById - Function to look up a decryption key by its ID.
 * @returns Array of { entry, plaintext } for each matching entry.
 */
export function queryEntries(
  entriesPath: string,
  index: IndexManager,
  query: LedgerQuery,
  getKeyById: (keyId: string) => Buffer,
): Array<{ entry: LedgerEntry; plaintext: unknown }> {
  // Step 1: Collect candidate sets from index filters
  const candidateSets: Set<string>[] = [];

  if (query.entry_type !== undefined) {
    const types = Array.isArray(query.entry_type) ? query.entry_type : [query.entry_type];
    // Union of all matching types
    const typeSet = new Set<string>();
    for (const type of types) {
      for (const id of index.getByType(type)) {
        typeSet.add(id);
      }
    }
    candidateSets.push(typeSet);
  }

  if (query.author_id !== undefined) {
    candidateSets.push(new Set(index.getByAuthor(query.author_id)));
  }

  if (query.amends !== undefined) {
    candidateSets.push(new Set(index.getByAmends(query.amends)));
  }

  // Step 2: Intersect all candidate sets (or use all IDs if no index filters)
  let candidateIds: Set<string>;
  if (candidateSets.length === 0) {
    candidateIds = new Set(index.getAllIds());
  } else {
    // Start with the smallest set for efficiency
    candidateSets.sort((a, b) => a.size - b.size);
    candidateIds = new Set(candidateSets[0]!);
    for (let i = 1; i < candidateSets.length; i++) {
      const nextSet = candidateSets[i]!;
      for (const id of candidateIds) {
        if (!nextSet.has(id)) {
          candidateIds.delete(id);
        }
      }
    }
  }

  // Early return if no candidates
  if (candidateIds.size === 0) {
    return [];
  }

  // Step 3: Get line numbers and sort them for sequential access
  const lineEntries: Array<{ id: string; lineNumber: number }> = [];
  for (const id of candidateIds) {
    const lineNumber = index.getLineNumber(id);
    if (lineNumber !== undefined) {
      lineEntries.push({ id, lineNumber });
    }
  }
  lineEntries.sort((a, b) => a.lineNumber - b.lineNumber);

  // Read file once as array of lines
  const content = readFileSync(entriesPath, 'utf-8').trimEnd();
  const lines = content.split('\n');

  // Step 4 & 5: Read entries at candidate line numbers, apply date_range filter, decrypt
  const results: Array<{ entry: LedgerEntry; plaintext: unknown }> = [];

  for (const { lineNumber } of lineEntries) {
    const line = lines[lineNumber];
    if (!line || !line.trim()) continue;

    // Parse entry metadata for date_range check before decryption
    // (avoid expensive decryption if date is out of range)
    if (query.date_range) {
      let parsed: LedgerEntry;
      try {
        parsed = JSON.parse(line) as LedgerEntry;
      } catch {
        continue;
      }

      if (query.date_range.from && parsed.timestamp < query.date_range.from) {
        continue;
      }
      if (query.date_range.to && parsed.timestamp > query.date_range.to) {
        continue;
      }
    }

    // Decrypt and verify
    const result = readEntry(line, getKeyById);
    results.push(result);
  }

  // Step 6: Apply offset and limit
  const offset = query.offset ?? 0;
  const sliced = query.limit !== undefined
    ? results.slice(offset, offset + query.limit)
    : results.slice(offset);

  return sliced;
}
