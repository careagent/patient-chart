/** Filename for the append-only JSONL ledger entries file */
export const ENTRIES_FILENAME = 'entries.jsonl';

/** Filename for the ledger index (accelerates queries) */
export const INDEX_FILENAME = 'index.json';

// Re-export schemas and types from the canonical type definitions
export {
  LedgerEntrySchema,
  LedgerEntryTypeSchema,
  EntryAuthorSchema,
  EntryMetadataSchema,
  SignableContentSchema,
} from '../types/ledger.js';

export type {
  LedgerEntry,
  LedgerEntryType,
  EntryAuthor,
  EntryMetadata,
  SignableContent,
} from '../types/ledger.js';
