import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IndexManager } from '../ledger/index-manager.js';
import { queryEntries } from '../ledger/query.js';
import { readEntry } from '../ledger/reader.js';
import { verifyLedgerChain, verifyLedgerIntegrity } from '../ledger/integrity.js';
import { computeAclState } from '../acl/manager.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { ENTRIES_FILENAME, INDEX_FILENAME } from '../ledger/schema.js';
import type { LedgerEntry, LedgerEntryType } from '../types/ledger.js';
import type {
  ChartQueryParams,
  ChartQueryResult,
  ChartEntryResult,
  ChartIntegrityResult,
  KnowledgeReadResult,
} from '../types/chart-read.js';
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from '../types/chart-read.js';

/**
 * Permission mapping: maps entry type categories to required ACL permissions.
 *
 * ACL permissions use `read:{resource}` format. Each ledger entry type maps
 * to a resource category. If a requester lacks the corresponding permission,
 * entries of that type are silently excluded (deny-by-default, no leakage).
 */
const ENTRY_TYPE_PERMISSIONS: Record<LedgerEntryType, string> = {
  // Clinical (10)
  clinical_encounter: 'read:encounters',
  clinical_medication: 'read:medications',
  clinical_allergy: 'read:allergies',
  clinical_diagnosis: 'read:diagnoses',
  clinical_problem_list: 'read:problem_list',
  clinical_lab_result: 'read:lab_results',
  clinical_imaging_result: 'read:imaging_results',
  clinical_pathology: 'read:pathology',
  clinical_procedure: 'read:procedures',
  clinical_amendment: 'read:amendments',
  // Care network (3)
  care_relationship_established: 'read:relationships',
  care_relationship_terminated: 'read:relationships',
  care_relationship_suspended: 'read:relationships',
  // Access control (4)
  access_grant_created: 'read:access_control',
  access_grant_modified: 'read:access_control',
  access_grant_revoked: 'read:access_control',
  access_grant_expired: 'read:access_control',
  // Emergency (3)
  emergency_config_set: 'read:emergency',
  emergency_access_triggered: 'read:emergency',
  emergency_access_ended: 'read:emergency',
  // Patient-authored (3)
  patient_note: 'read:patient_notes',
  patient_directive: 'read:directives',
  patient_preference: 'read:preferences',
  // System (3)
  vault_initialized: 'read:system',
  key_rotation: 'read:system',
  sync_record: 'read:system',
};

/**
 * Configuration options for creating a ChartReader.
 */
export interface ChartReaderOptions {
  /** Absolute path to the vault root directory. */
  vaultPath: string;
  /** Function returning the active encryption key and ID. */
  getActiveKey: () => { keyId: string; key: Buffer };
  /** Function returning a decrypted key by its ID (supports rotated keys). */
  getKeyById: (keyId: string) => Buffer;
}

/**
 * ChartReader — the ACL-enforced read API for patient chart vaults.
 *
 * Every read operation checks the requester's permissions against the ACL
 * state computed from the ledger. Unauthorized reads return empty results
 * (deny-by-default, no information leakage). All entries are decrypted
 * and signature-verified before being returned.
 *
 * Usage:
 * ```typescript
 * const reader = createChartReader({ vaultPath, getActiveKey, getKeyById });
 * const results = reader.query({ requester_id: 'provider-123', entry_types: ['clinical_medication'] });
 * ```
 */
export class ChartReader {
  private readonly entriesPath: string;
  private readonly indexPath: string;
  private readonly vaultPath: string;
  private readonly getActiveKey: () => { keyId: string; key: Buffer };
  private readonly getKeyById: (keyId: string) => Buffer;

  constructor(opts: ChartReaderOptions) {
    this.vaultPath = opts.vaultPath;
    this.entriesPath = join(opts.vaultPath, 'ledger', ENTRIES_FILENAME);
    this.indexPath = join(opts.vaultPath, 'ledger', INDEX_FILENAME);
    this.getActiveKey = opts.getActiveKey;
    this.getKeyById = opts.getKeyById;
  }

  /**
   * Query ledger entries with ACL enforcement, decryption, and pagination.
   *
   * Flow:
   * 1. Compute ACL state from ledger
   * 2. Determine which permissions the requester holds
   * 3. Filter requested entry types to only those the requester can read
   * 4. Query the ledger with index-backed filtering
   * 5. Apply custom predicate if provided
   * 6. Apply cursor-based pagination
   * 7. Return decrypted results with pagination metadata
   *
   * If the requester has no relevant permissions, returns an empty result
   * set (no error, no information leakage).
   */
  query(params: ChartQueryParams): ChartQueryResult {
    const limit = Math.min(params.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    // Step 1: Compute permitted entry types for this requester
    const permittedTypes = this.getPermittedEntryTypes(params.requester_id);

    // If the requester has no permissions at all, return empty result
    if (permittedTypes.size === 0) {
      return { entries: [], total: 0, next_cursor: null, has_more: false };
    }

    // Step 2: Intersect requested types with permitted types
    let effectiveTypes: LedgerEntryType[];
    if (params.entry_types && params.entry_types.length > 0) {
      effectiveTypes = params.entry_types.filter((t) => permittedTypes.has(t));
      // If none of the requested types are permitted, return empty
      if (effectiveTypes.length === 0) {
        return { entries: [], total: 0, next_cursor: null, has_more: false };
      }
    } else {
      // No type filter: use all permitted types
      effectiveTypes = [...permittedTypes];
    }

    // Step 3: Build index and query
    const index = this.buildIndex();

    const rawResults = queryEntries(
      this.entriesPath,
      index,
      {
        entry_type: effectiveTypes,
        author_id: params.author_id,
        date_range: (params.from_date || params.to_date)
          ? { from: params.from_date, to: params.to_date }
          : undefined,
        amends: params.amends,
      },
      this.getKeyById,
    );

    // Step 4: Apply custom predicate
    let filtered = rawResults;
    if (params.predicate) {
      filtered = rawResults.filter((r) => params.predicate!(r.entry, r.plaintext));
    }

    // Step 5: Cursor-based pagination
    // Cursor format: the entry ID after which to start returning results
    let startIndex = 0;
    if (params.cursor) {
      const cursorIndex = filtered.findIndex((r) => r.entry.id === params.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const total = filtered.length;
    const paged = filtered.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < total;
    const nextCursor = hasMore && paged.length > 0
      ? paged[paged.length - 1]!.entry.id
      : null;

    // Step 6: Map to ChartEntryResult
    const entries = paged.map((r) => this.toEntryResult(r.entry, r.plaintext));

    return { entries, total, next_cursor: nextCursor, has_more: hasMore };
  }

  /**
   * Get a single entry by ID with ACL enforcement.
   *
   * Returns null if the entry doesn't exist or the requester lacks
   * permission to read it (no information leakage about existence).
   */
  getEntry(requesterId: string, entryId: string): ChartEntryResult | null {
    const index = this.buildIndex();
    const lineNumber = index.getLineNumber(entryId);

    if (lineNumber === undefined) {
      return null;
    }

    // Read the raw line
    const content = readFileSync(this.entriesPath, 'utf-8').trimEnd();
    const lines = content.split('\n');
    const line = lines[lineNumber];

    if (!line || !line.trim()) {
      return null;
    }

    // Decrypt and verify
    let result: { entry: LedgerEntry; plaintext: unknown };
    try {
      result = readEntry(line, this.getKeyById);
    } catch {
      return null;
    }

    // ACL check: does this requester have permission for this entry type?
    const permittedTypes = this.getPermittedEntryTypes(requesterId);
    if (!permittedTypes.has(result.entry.entry_type)) {
      return null;
    }

    return this.toEntryResult(result.entry, result.plaintext);
  }

  /**
   * Verify ledger integrity (hash chain + optionally signatures).
   *
   * This is a public utility — no ACL check needed since integrity
   * verification reveals no PHI (only structural validity).
   */
  verifyIntegrity(opts?: { full?: boolean }): ChartIntegrityResult {
    if (opts?.full) {
      const result = verifyLedgerIntegrity(this.entriesPath, this.getKeyById);
      return {
        valid: result.valid,
        entries: result.entries,
        ...(result.brokenAt !== undefined ? { broken_at: result.brokenAt } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.errorType !== undefined ? { error_type: result.errorType } : {}),
      };
    }

    const result = verifyLedgerChain(this.entriesPath);
    return {
      valid: result.valid,
      entries: result.entries,
      ...(result.brokenAt !== undefined ? { broken_at: result.brokenAt } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
  }

  /**
   * Read a knowledge note with ACL enforcement.
   *
   * Requires `read:knowledge` permission for the requester.
   * Returns null if the requester lacks permission (no leakage).
   */
  readKnowledgeNote(requesterId: string, relativePath: string): KnowledgeReadResult | null {
    // ACL check for knowledge access
    if (!this.hasPermission(requesterId, 'read:knowledge')) {
      return null;
    }

    const store = new KnowledgeStore(
      this.vaultPath,
      this.getActiveKey,
      this.getKeyById,
    );

    try {
      const content = store.readNote(relativePath);
      return { path: relativePath, content };
    } catch {
      return null;
    }
  }

  /**
   * List knowledge notes with ACL enforcement.
   *
   * Requires `read:knowledge` permission for the requester.
   * Returns empty array if the requester lacks permission.
   */
  listKnowledgeNotes(requesterId: string, folder?: string): string[] {
    if (!this.hasPermission(requesterId, 'read:knowledge')) {
      return [];
    }

    const store = new KnowledgeStore(
      this.vaultPath,
      this.getActiveKey,
      this.getKeyById,
    );

    try {
      return store.listNotes(folder);
    } catch {
      return [];
    }
  }

  /**
   * Check whether a requester has a specific permission.
   */
  private hasPermission(requesterId: string, permission: string): boolean {
    const aclState = computeAclState(this.entriesPath, this.getKeyById);
    const now = new Date();

    for (const grant of aclState.values()) {
      if (grant.entity_id !== requesterId) continue;
      if (grant.status === 'revoked' || grant.status === 'expired') continue;

      if (grant.expires_at !== undefined) {
        if (now >= new Date(grant.expires_at)) continue;
      }

      if (grant.permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compute which entry types a requester is permitted to read.
   *
   * Replays the ACL state, collects all active permissions for the requester,
   * and maps them back to the set of permitted entry types.
   */
  private getPermittedEntryTypes(requesterId: string): Set<LedgerEntryType> {
    const aclState = computeAclState(this.entriesPath, this.getKeyById);
    const now = new Date();

    // Collect all active permissions for this requester
    const activePermissions = new Set<string>();
    for (const grant of aclState.values()) {
      if (grant.entity_id !== requesterId) continue;
      if (grant.status === 'revoked' || grant.status === 'expired') continue;

      if (grant.expires_at !== undefined) {
        if (now >= new Date(grant.expires_at)) continue;
      }

      for (const perm of grant.permissions) {
        activePermissions.add(perm);
      }
    }

    // Map permissions back to permitted entry types
    const permitted = new Set<LedgerEntryType>();
    for (const [entryType, requiredPerm] of Object.entries(ENTRY_TYPE_PERMISSIONS)) {
      if (activePermissions.has(requiredPerm)) {
        permitted.add(entryType as LedgerEntryType);
      }
    }

    return permitted;
  }

  /**
   * Build or load the index for the current ledger.
   */
  private buildIndex(): IndexManager {
    // Try loading persisted index first
    if (existsSync(this.indexPath)) {
      try {
        return IndexManager.load(this.indexPath);
      } catch {
        // Fall through to rebuild
      }
    }

    // Rebuild from entries file
    return IndexManager.rebuild(this.entriesPath);
  }

  /**
   * Map a raw ledger entry + plaintext to the public ChartEntryResult shape.
   */
  private toEntryResult(entry: LedgerEntry, plaintext: unknown): ChartEntryResult {
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      entry_type: entry.entry_type,
      author_id: entry.author.id,
      author_display_name: entry.author.display_name,
      payload: plaintext,
    };
  }
}

/**
 * Factory function for creating a ChartReader.
 *
 * Usage:
 * ```typescript
 * import { createChartReader } from '@careagent/patient-chart';
 * const reader = createChartReader({ vaultPath, getActiveKey, getKeyById });
 * const results = reader.query({ requester_id: 'provider-123' });
 * ```
 */
export function createChartReader(opts: ChartReaderOptions): ChartReader {
  return new ChartReader(opts);
}
