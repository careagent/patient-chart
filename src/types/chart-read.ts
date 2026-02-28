import { Type, type Static } from '@sinclair/typebox';
import { LedgerEntryTypeSchema } from './ledger.js';

/**
 * Query parameters for the Chart Read API.
 * All fields except requesterId are optional. Multiple filters are ANDed.
 */
export const ChartQueryParamsSchema = Type.Object({
  /** Entity ID of the requester — checked against ACL before returning data. */
  requester_id: Type.String({ description: 'Entity ID of the requester (for ACL check)' }),
  /** Filter by one or more of the 26 ledger entry types. */
  entry_types: Type.Optional(Type.Array(LedgerEntryTypeSchema, {
    description: 'Filter by entry type(s)',
  })),
  /** ISO 8601 start date (inclusive). */
  from_date: Type.Optional(Type.String({ description: 'ISO 8601 start date (inclusive)' })),
  /** ISO 8601 end date (inclusive). */
  to_date: Type.Optional(Type.String({ description: 'ISO 8601 end date (inclusive)' })),
  /** Filter by author ID. */
  author_id: Type.Optional(Type.String({ description: 'Filter by author ID' })),
  /** Filter for amendments to a specific entry. */
  amends: Type.Optional(Type.String({ description: 'Filter for amendments to entry ID' })),
  /** Custom predicate applied after other filters (not serializable). */
  predicate: Type.Optional(Type.Unsafe<(entry: unknown, plaintext: unknown) => boolean>({
    description: 'Custom predicate function applied after other filters',
  })),
  /** Cursor-based pagination: opaque cursor string from a previous result. */
  cursor: Type.Optional(Type.String({ description: 'Pagination cursor from previous result' })),
  /** Maximum entries to return (default: 50, max: 500). */
  limit: Type.Optional(Type.Number({
    description: 'Max entries to return (default: 50)',
    minimum: 1,
    maximum: 500,
  })),
});

export type ChartQueryParams = Static<typeof ChartQueryParamsSchema>;

/**
 * A single decrypted ledger entry returned by the read API.
 * Contains the entry metadata and the decrypted payload.
 */
export const ChartEntryResultSchema = Type.Object({
  /** UUIDv7 entry identifier. */
  id: Type.String(),
  /** ISO 8601 timestamp. */
  timestamp: Type.String(),
  /** Entry type. */
  entry_type: LedgerEntryTypeSchema,
  /** Author ID. */
  author_id: Type.String(),
  /** Author display name. */
  author_display_name: Type.String(),
  /** Decrypted payload. */
  payload: Type.Unknown({ description: 'Decrypted entry payload' }),
});

export type ChartEntryResult = Static<typeof ChartEntryResultSchema>;

/**
 * Paginated query result from the Chart Read API.
 */
export const ChartQueryResultSchema = Type.Object({
  /** Array of matching entries (decrypted). */
  entries: Type.Array(ChartEntryResultSchema),
  /** Total number of entries matching the query (before pagination). */
  total: Type.Number({ description: 'Total matching entries before pagination' }),
  /** Cursor for the next page, or null if this is the last page. */
  next_cursor: Type.Union([Type.String(), Type.Null()], {
    description: 'Cursor for next page, null if last page',
  }),
  /** Whether there are more entries beyond this page. */
  has_more: Type.Boolean(),
});

export type ChartQueryResult = Static<typeof ChartQueryResultSchema>;

/**
 * Result from verifying ledger integrity.
 */
export const ChartIntegrityResultSchema = Type.Object({
  valid: Type.Boolean(),
  entries: Type.Number(),
  broken_at: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
  error_type: Type.Optional(Type.Union([
    Type.Literal('chain'),
    Type.Literal('signature'),
    Type.Literal('decryption'),
    Type.Literal('schema'),
    Type.Literal('json'),
  ])),
});

export type ChartIntegrityResult = Static<typeof ChartIntegrityResultSchema>;

/**
 * Result from a knowledge note read.
 */
export const KnowledgeReadResultSchema = Type.Object({
  /** The relative path of the note. */
  path: Type.String(),
  /** Decrypted note content. */
  content: Type.String(),
});

export type KnowledgeReadResult = Static<typeof KnowledgeReadResultSchema>;

/**
 * Default and max limits for pagination.
 */
export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 500;
