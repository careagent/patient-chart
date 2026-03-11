# Phase 3: Immutable Ledger - Research

**Researched:** 2026-02-24
**Domain:** Hash-chained, encrypted, signed JSONL ledger with write pipeline, read pipeline, query engine, entry index, integrity verification, and amendment model
**Confidence:** HIGH

## Summary

Phase 3 builds the core immutable ledger -- the heart of the patient vault. It composes Phase 1's hash-chained JSONL append pattern with Phase 2's AES-256-GCM encryption, Ed25519 signing, and KeyRing key management into a complete write pipeline (construct -> sign -> encrypt -> chain -> append) and read pipeline (load -> chain-verify -> decrypt -> signature-verify -> return). The technical domain is well-understood because the audit writer (`src/audit/writer.ts`) already implements the hash-chain JSONL pattern, and all cryptographic primitives are proven in `src/encryption/`. The novel work is the composition layer: defining the `LedgerEntry` on-disk format with its unencrypted metadata envelope, the `SignableContent` canonical serialization for deterministic signing, the entry index for O(1) lookups, and the query engine for filtering.

The PRD (section 3.1-3.5) defines complete TypeScript interfaces for `LedgerEntry`, `LedgerEntryType` (26 types), `EntryAuthor`, `EncryptedPayload` (already implemented), and `EntryMetadata`. The architecture research (`.planning/research/ARCHITECTURE.md`) documents the exact write path and read path data flows. The ledger depends on encryption (payload encrypt/decrypt, sign/verify) and audit (logging operations), but nothing depends on the ledger yet -- Phase 4 (Access Control) is the first consumer.

A critical design decision for this phase is the signing scope: the Ed25519 signature covers a well-defined `SignableContent` structure (pre-encryption plaintext content) that includes the entry's id, timestamp, entry_type, author, plaintext payload, and metadata. A `canonicalize()` function serializes this to a deterministic Buffer used by both the sign and verify paths. The hash chain operates on the serialized JSON line (including the encrypted payload), so chain verification does NOT require decryption, while signature verification DOES require decryption -- this is by design per the architecture research.

**Primary recommendation:** Build five focused modules (`src/ledger/writer.ts`, `reader.ts`, `query.ts`, `index-manager.ts`, `integrity.ts`) plus TypeBox schemas in `src/types/ledger.ts`. Reuse the existing `AuditWriter` pattern for hash-chaining but extend it with encrypt-then-chain and sign-before-encrypt semantics. Define the `SignableContent` type with a deterministic `canonicalize()` function. Use an in-memory Map-based index persisted as `ledger/index.json` with rebuild-from-entries capability.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:crypto | Built-in (Node.js 22) | SHA-256 hash chaining, AES-256-GCM (via src/encryption/aes.ts), Ed25519 (via src/encryption/ed25519.ts) | Zero deps; all primitives already proven in Phase 2 |
| node:fs | Built-in | JSONL append (appendFileSync), index persistence (writeFileSync/readFileSync), entries.jsonl reads | Zero deps; synchronous API matches Phase 1 audit writer pattern |
| @sinclair/typebox | ~0.34.x | TypeBox schemas for LedgerEntry, LedgerEntryType, EntryAuthor, EntryMetadata, SignableContent | devDependency only; matches Phase 1/2 pattern |
| src/encryption/* | Phase 2 | AES-256-GCM encrypt/decrypt, Ed25519 sign/verify, KeyRing for key lookup | Internal dependency; proven and tested |
| src/audit/writer.ts | Phase 1 | VaultAuditPipeline for logging ledger operations to audit trail | Internal dependency; non-blocking audit pattern |
| src/util/uuidv7.ts | Phase 1 | UUIDv7 generation for entry IDs | Internal dependency; time-sortable unique identifiers |

### Supporting (devDependencies, already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ~4.0.x | Test runner for ledger round-trip tests | `pnpm test` |
| @vitest/coverage-v8 | ~4.0.x | Coverage enforcement (80% thresholds) | `pnpm test` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map index persisted as JSON | SQLite or LevelDB | Would add a runtime dependency; violates zero-deps constraint. JSON index file is simple, rebuildable from entries.jsonl, and sufficient for v1 vault sizes (<100K entries). |
| Single entries.jsonl file | Date-partitioned JSONL files | Single file is simpler for v1. The PRD defers partitioning to v2 (LDGR-10). |
| Linear JSONL scan for queries | B-tree or trie index | Over-engineering for v1 vault sizes. The entry index provides O(1) by entry_type and author; date-range queries use linear scan with early termination. |
| JSON.stringify for canonical signing | RFC 8785 (JCS) | JCS is the standard for deterministic JSON, but for a single-implementation system where both sign and verify paths use the same function, a simpler sorted-keys JSON.stringify with a custom replacer is sufficient. The critical requirement is that `canonicalize()` is used by BOTH paths. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed from Phase 1/2
```

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)
```
src/
├── ledger/
│   ├── writer.ts          # Sign -> encrypt -> chain -> append pipeline
│   ├── reader.ts          # Load -> chain-verify -> decrypt -> verify-sig pipeline
│   ├── query.ts           # Query engine (filter by type, author, date, amends)
│   ├── index-manager.ts   # Entry index for O(1) lookups by type/author
│   ├── integrity.ts       # Full chain + signature verification
│   └── schema.ts          # Module-level constants and re-exports
├── types/
│   └── ledger.ts          # LedgerEntry, LedgerEntryType, EntryAuthor, EntryMetadata, SignableContent
└── index.ts               # Updated with Phase 3 exports
test/
├── unit/
│   ├── ledger-writer.test.ts
│   ├── ledger-reader.test.ts
│   ├── ledger-query.test.ts
│   ├── ledger-index.test.ts
│   ├── ledger-integrity.test.ts
│   └── ledger-roundtrip.test.ts   # Full write -> read -> verify round-trip
```

### Pattern 1: LedgerEntry On-Disk Format
**What:** Each JSONL line in `entries.jsonl` is a serialized `LedgerEntry` object. The entry has both unencrypted fields (id, timestamp, entry_type, author identity, prev_hash, signature, metadata) and an encrypted field (encrypted_payload containing the clinical/operational content). The unencrypted metadata enables indexing and chain verification without decryption.
**When to use:** Every ledger write produces one JSONL line in this format.
**Example:**
```typescript
// On-disk format (one JSON line in entries.jsonl)
interface LedgerEntry {
  id: string;                          // UUIDv7
  timestamp: string;                   // ISO 8601 ms precision
  entry_type: LedgerEntryType;         // One of 26 types
  author: EntryAuthor;                 // Who wrote it (type, id, display_name, public_key)
  prev_hash: string | null;            // SHA-256 of previous line's raw JSON string
  signature: string;                   // Base64-encoded Ed25519 signature over SignableContent
  encrypted_payload: EncryptedPayload; // AES-256-GCM encrypted clinical content
  metadata: EntryMetadata;             // Unencrypted indexing metadata
}
```

### Pattern 2: Write Pipeline (Sign -> Encrypt -> Chain -> Append)
**What:** The write pipeline takes plaintext content and author identity, constructs the SignableContent, signs it with Ed25519, encrypts the payload with AES-256-GCM, chains to the previous entry with SHA-256, and appends the serialized entry to entries.jsonl.
**When to use:** Every `writeEntry()` and `amendEntry()` call.
**Example:**
```typescript
// Source: Architecture research write path + Phase 2 primitives
function writeEntry(
  content: unknown,               // Plaintext payload (clinical data, grant, etc.)
  entryType: LedgerEntryType,
  author: EntryAuthor,
  keyRing: KeyRing,
  opts?: { amends?: string },     // For amendments
): LedgerEntry {
  const id = generateUUIDv7();
  const timestamp = new Date().toISOString();
  const metadata: EntryMetadata = {
    schema_version: '1',
    entry_type: entryType,
    author_type: author.type,
    author_id: author.id,
    amends: opts?.amends,
    payload_size: 0, // filled after encryption
  };

  // 1. Construct SignableContent and sign (pre-encryption)
  const plaintext = JSON.stringify(content);
  const signable: SignableContent = {
    id, timestamp, entry_type: entryType, author, payload: plaintext, metadata,
  };
  const canonical = canonicalize(signable);
  const signature = sign(canonical, keyRing.getIdentityPrivateKey());

  // 2. Encrypt payload with active key
  const { keyId, key } = keyRing.getActiveEncryptionKey();
  const encrypted = encrypt(Buffer.from(plaintext), key, keyId);
  metadata.payload_size = Buffer.byteLength(encrypted.ciphertext, 'base64');

  // 3. Build the LedgerEntry (prev_hash injected by chaining layer)
  const entry: Omit<LedgerEntry, 'prev_hash'> = {
    id, timestamp, entry_type: entryType, author,
    signature: signature.toString('base64'),
    encrypted_payload: encrypted,
    metadata,
  };

  // 4. Chain and append (same pattern as AuditWriter)
  // prev_hash = SHA-256 of previous line; append as JSON line
  return chainAndAppend(entry);
}
```

### Pattern 3: Read Pipeline (Load -> Verify -> Decrypt -> Verify Signature)
**What:** Reading an entry loads the raw JSONL line, optionally verifies the hash chain link, decrypts the payload using the key_id from the EncryptedPayload, and verifies the Ed25519 signature against the author's public key over the reconstructed SignableContent.
**When to use:** Every `readEntry()` call.
**Example:**
```typescript
// Read path
function readEntry(
  line: string,              // Raw JSONL line from disk
  keyRing: KeyRing,
): { entry: LedgerEntry; plaintext: unknown } {
  const entry = JSON.parse(line) as LedgerEntry;

  // 1. Decrypt payload using key_id from EncryptedPayload
  const key = keyRing.getEncryptionKey(entry.encrypted_payload.key_id);
  const plaintext = decrypt(entry.encrypted_payload, key);

  // 2. Reconstruct SignableContent and verify signature
  const signable: SignableContent = {
    id: entry.id,
    timestamp: entry.timestamp,
    entry_type: entry.entry_type,
    author: entry.author,
    payload: plaintext.toString('utf-8'),
    metadata: entry.metadata,
  };
  const canonical = canonicalize(signable);
  const sigBuffer = Buffer.from(entry.signature, 'base64');
  const authorPubKey = importEd25519PublicKey(
    Buffer.from(entry.author.public_key, 'base64')
  );
  const valid = verifySignature(canonical, sigBuffer, authorPubKey);
  if (!valid) {
    throw new LedgerError(`Signature verification failed for entry ${entry.id}`);
  }

  return { entry, plaintext: JSON.parse(plaintext.toString('utf-8')) };
}
```

### Pattern 4: SignableContent and Canonical Serialization
**What:** A well-defined type specifying exactly which fields the Ed25519 signature covers. A `canonicalize()` function produces a deterministic Buffer from this type, used by both the sign and verify paths.
**When to use:** Every sign and verify operation in the write and read pipelines.
**Example:**
```typescript
interface SignableContent {
  id: string;
  timestamp: string;
  entry_type: LedgerEntryType;
  author: EntryAuthor;
  payload: string;          // Plaintext payload as JSON string
  metadata: EntryMetadata;
}

// Deterministic serialization -- keys sorted, no whitespace
function canonicalize(signable: SignableContent): Buffer {
  const ordered = JSON.stringify(signable, Object.keys(signable).sort());
  return Buffer.from(ordered, 'utf-8');
}
```

### Pattern 5: Entry Index for O(1) Lookups
**What:** An in-memory index mapping `entry_type -> Set<entryId>` and `author_id -> Set<entryId>`, plus `entryId -> lineOffset` for O(1) line retrieval. Persisted as `ledger/index.json` for fast startup. Rebuildable from entries.jsonl if corrupted.
**When to use:** Every query operation, entry-by-ID lookup.
**Example:**
```typescript
interface EntryIndex {
  byType: Record<string, string[]>;       // entry_type -> entry IDs
  byAuthor: Record<string, string[]>;     // author_id -> entry IDs
  byId: Record<string, number>;           // entry ID -> line number (0-based)
  entryCount: number;
  lastHash: string | null;
}

class IndexManager {
  private byType = new Map<string, Set<string>>();
  private byAuthor = new Map<string, Set<string>>();
  private byId = new Map<string, number>();

  addEntry(entry: LedgerEntry, lineNumber: number): void { ... }
  getByType(type: LedgerEntryType): string[] { ... }
  getByAuthor(authorId: string): string[] { ... }
  getLineNumber(id: string): number | undefined { ... }

  save(path: string): void { ... }    // Persist to index.json
  static load(path: string): IndexManager { ... }  // Load from index.json
  static rebuild(entriesPath: string): IndexManager { ... } // Rebuild from JSONL
}
```

### Pattern 6: Query Engine with Filters
**What:** A query engine that accepts filter criteria (entry_type, author, date range, amends) and returns matching entries. Uses the entry index for O(1) type/author lookups, then applies date range and amends filters on the candidate set.
**When to use:** Every `queryEntries()` call.
**Example:**
```typescript
interface LedgerQuery {
  entry_type?: LedgerEntryType | LedgerEntryType[];
  author_id?: string;
  date_range?: { from?: string; to?: string };
  amends?: string;       // Find amendments to a specific entry ID
  limit?: number;
  offset?: number;
}
```

### Anti-Patterns to Avoid
- **Signing the encrypted payload instead of the plaintext:** The signature must cover the pre-encryption content (SignableContent). Signing the ciphertext is meaningless because anyone with the encryption key could re-encrypt different content under a valid chain. Sign plaintext, then encrypt.
- **Hashing a re-serialized object for chain verification:** The hash chain must use the exact raw JSONL line bytes, not a parsed-then-re-serialized object. Key order differences from re-serialization break the chain. This is established in Phase 1 decision [01-03].
- **Using the active key to decrypt all entries:** Historical entries are encrypted with rotated keys. Always read `key_id` from `EncryptedPayload.key_id` and look up the corresponding key in the KeyRing. The active key is for NEW encryptions only.
- **Building the index only in memory without persistence:** The index must be persisted to `ledger/index.json` for fast vault startup. If the index file is corrupted or missing, rebuild from entries.jsonl. Test the index through close/reopen cycles.
- **Accepting caller-provided prev_hash:** The writer must compute prev_hash internally from its tracked last-hash state. Callers should never supply prev_hash. This matches the AuditWriter pattern from Phase 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hash chaining | Custom chain logic | Extend the AuditWriter pattern from `src/audit/writer.ts` | Proven pattern with crash recovery, raw-line hashing, and genesis handling already implemented |
| AES-256-GCM encryption | Custom cipher logic | `src/encryption/aes.ts` encrypt/decrypt | Phase 2 implementation with internal IV generation, CryptoError wrapping |
| Ed25519 signing | Custom signing logic | `src/encryption/ed25519.ts` sign/verifySignature | Phase 2 implementation with null algorithm per RFC 8032 |
| Key lookup by ID | Custom key storage | `src/encryption/keyring.ts` KeyRing.getEncryptionKey(keyId) | Phase 2 implementation with retention-forever policy for historical decryption |
| UUIDv7 generation | Custom ID generator | `src/util/uuidv7.ts` generateUUIDv7() | Phase 1 implementation, RFC 9562 compliant |
| TypeBox schema validation | Custom validators | `@sinclair/typebox` Value.Check() | Established pattern from Phase 1/2, devDependency only |

**Key insight:** Phase 3 is almost entirely a composition phase. The hash-chain pattern exists in `AuditWriter`, all crypto primitives exist in `src/encryption/`, and UUIDs exist in `src/util/`. The novel work is: (1) the LedgerEntry type with its encrypted/unencrypted split, (2) the SignableContent canonical serialization, (3) the entry index, and (4) the query engine. No new cryptographic implementations are needed.

## Common Pitfalls

### Pitfall 1: Signature Scope Mismatch Between Write and Read Paths
**What goes wrong:** The write path signs a different set of fields or uses a different serialization order than the read path when reconstructing SignableContent for verification. Signatures fail on legitimate entries.
**Why it happens:** The entry goes through multiple transformations (construct -> sign -> encrypt -> add metadata -> chain -> serialize). If the "what gets signed" contract is ambiguous, the write and verify paths diverge.
**How to avoid:** Define a single `SignableContent` type and a single `canonicalize()` function used by BOTH the sign path (in writer.ts) and the verify path (in reader.ts and integrity.ts). Write a round-trip test: construct entry -> sign -> encrypt -> serialize to JSONL -> read raw line -> parse -> decrypt -> reconstruct SignableContent -> verify signature.
**Warning signs:** Signature verification passes with in-memory objects but fails with entries read from disk.

### Pitfall 2: payload_size Computed Before Encryption
**What goes wrong:** The `metadata.payload_size` field is set to the plaintext size before encryption, but the SignableContent includes metadata with this value. After encryption, the actual ciphertext size differs. If you then update payload_size after encryption, the SignableContent used for signing differs from the one reconstructed during verification.
**How to avoid:** Include payload_size in EntryMetadata but compute it consistently. Option A: set payload_size to the plaintext byte length (before encryption) and document this clearly. Option B: exclude payload_size from SignableContent (set it after signing). Recommendation: set payload_size = Buffer.byteLength of the plaintext JSON string, include it in SignableContent. The read path reconstructs the same value from the decrypted plaintext.
**Warning signs:** Signature verification fails after changing the payload_size computation.

### Pitfall 3: Index Inconsistency After Crash During Write
**What goes wrong:** A new entry is appended to entries.jsonl but the index.json update crashes before completing. On next open, the index is missing the last entry. Queries miss the entry; lookups by ID fail.
**How to avoid:** The index must be rebuildable from entries.jsonl. On vault open, verify the index's `entryCount` matches the number of lines in entries.jsonl. If they disagree, rebuild the index from the JSONL file. The index is a derived artifact, not a source of truth.
**Warning signs:** Entry written successfully but not found by query after vault close/reopen.

### Pitfall 4: Non-Deterministic JSON.stringify Key Order in Canonicalization
**What goes wrong:** `JSON.stringify()` preserves insertion order. If SignableContent is constructed with different key insertion orders on the write vs. read path, the canonical bytes differ and the signature fails.
**How to avoid:** The `canonicalize()` function must explicitly sort keys. Use `JSON.stringify(obj, Object.keys(obj).sort())` or a recursive sorted-keys serializer. Test with objects constructed in different key orders to verify deterministic output.
**Warning signs:** Signature passes in unit tests (same construction order) but fails in integration tests (different construction paths).

### Pitfall 5: Amendments Not Independently Queryable
**What goes wrong:** Amendments are stored correctly but the query engine only returns the latest amendment, not the original entry, or vice versa. Both the original and all amendments must be independently discoverable.
**How to avoid:** The `amends` field in EntryMetadata links an amendment to its original. The query engine should support querying by `amends` (find all amendments to entry X) AND by entry_type (find all clinical_amendment entries). The index should index the `amends` field for O(1) lookups.
**Warning signs:** Cannot find all amendments to a specific original entry without scanning the entire ledger.

### Pitfall 6: Author Public Key Storage Format
**What goes wrong:** The `EntryAuthor.public_key` field stores the Ed25519 public key, but the format (base64 DER vs raw hex) is inconsistent between the writer and reader, causing key import to fail during signature verification.
**How to avoid:** Standardize on base64-encoded DER SPKI format (44 bytes DER -> base64 string) for `EntryAuthor.public_key`. This matches the KeyRing's `getIdentityPublicKeyDer()` output. Use `importEd25519PublicKey(Buffer.from(author.public_key, 'base64'))` for verification.
**Warning signs:** Signature verification fails with "Invalid key" errors even though the correct key pair was used.

### Pitfall 7: Hash Chain Includes Signature and Encrypted Payload
**What goes wrong:** A developer chains on a subset of the entry fields (e.g., only unencrypted fields) thinking this is cleaner. But the PRD specifies chain verification must detect ANY tampering including ciphertext modification.
**How to avoid:** The hash chain operates on the COMPLETE serialized JSON line, including signature, encrypted_payload, and all metadata. This is the same as the audit writer pattern: `createHash('sha256').update(rawLine).digest('hex')`. Chain verification never requires decryption -- it hashes raw bytes.
**Warning signs:** Chain verification passes even when encrypted_payload is tampered with.

## Code Examples

Verified patterns from the existing codebase:

### LedgerEntry TypeBox Schema
```typescript
// Source: PRD section 3.1-3.5, adapted for TypeBox
import { Type, type Static } from '@sinclair/typebox';
import { EncryptedPayloadSchema } from './encryption.js';

export const LedgerEntryTypeSchema = Type.Union([
  // Clinical entries (10)
  Type.Literal('clinical_encounter'),
  Type.Literal('clinical_medication'),
  Type.Literal('clinical_allergy'),
  Type.Literal('clinical_diagnosis'),
  Type.Literal('clinical_problem_list'),
  Type.Literal('clinical_lab_result'),
  Type.Literal('clinical_imaging_result'),
  Type.Literal('clinical_pathology'),
  Type.Literal('clinical_procedure'),
  Type.Literal('clinical_amendment'),
  // Care network entries (3)
  Type.Literal('care_relationship_established'),
  Type.Literal('care_relationship_terminated'),
  Type.Literal('care_relationship_suspended'),
  // Access control entries (4)
  Type.Literal('access_grant_created'),
  Type.Literal('access_grant_modified'),
  Type.Literal('access_grant_revoked'),
  Type.Literal('access_grant_expired'),
  // Emergency access entries (3)
  Type.Literal('emergency_config_set'),
  Type.Literal('emergency_access_triggered'),
  Type.Literal('emergency_access_ended'),
  // Patient-authored entries (3)
  Type.Literal('patient_note'),
  Type.Literal('patient_directive'),
  Type.Literal('patient_preference'),
  // System entries (3)
  Type.Literal('vault_initialized'),
  Type.Literal('key_rotation'),
  Type.Literal('sync_record'),
  // Note: backup_record is the 26th type but is listed as a system type
]);

export type LedgerEntryType = Static<typeof LedgerEntryTypeSchema>;
```

### EntryAuthor Schema (includes public_key for signature verification)
```typescript
// Source: PRD section 3.3
export const EntryAuthorSchema = Type.Object({
  type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('system'),
  ]),
  id: Type.String(),
  display_name: Type.String(),
  public_key: Type.String({ description: 'Base64-encoded DER (SPKI) Ed25519 public key' }),
});

export type EntryAuthor = Static<typeof EntryAuthorSchema>;
```

### EntryMetadata Schema (unencrypted, for indexing)
```typescript
// Source: PRD section 3.5
export const EntryMetadataSchema = Type.Object({
  schema_version: Type.Literal('1'),
  entry_type: LedgerEntryTypeSchema,
  author_type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('system'),
  ]),
  author_id: Type.String(),
  amends: Type.Optional(Type.String({ description: 'UUID of the entry being amended' })),
  synced_entry: Type.Optional(Type.String({ description: 'UUID of the entry that was synced' })),
  payload_size: Type.Number({ description: 'Byte size of the plaintext payload' }),
});

export type EntryMetadata = Static<typeof EntryMetadataSchema>;
```

### Full LedgerEntry Schema
```typescript
export const LedgerEntrySchema = Type.Object({
  id: Type.String({ description: 'UUIDv7 entry identifier' }),
  timestamp: Type.String({ description: 'ISO 8601 with millisecond precision' }),
  entry_type: LedgerEntryTypeSchema,
  author: EntryAuthorSchema,
  prev_hash: Type.Union([Type.String(), Type.Null()]),
  signature: Type.String({ description: 'Base64-encoded Ed25519 signature over SignableContent' }),
  encrypted_payload: EncryptedPayloadSchema,
  metadata: EntryMetadataSchema,
});

export type LedgerEntry = Static<typeof LedgerEntrySchema>;
```

### Canonicalize Function for Deterministic Signing
```typescript
// Deterministic serialization with sorted keys at all levels
function canonicalize(signable: SignableContent): Buffer {
  // Deep sorted-keys serialization to ensure determinism
  const json = JSON.stringify(signable, (_key, value) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
  return Buffer.from(json, 'utf-8');
}
```

### LedgerWriter (extends AuditWriter hash-chain pattern)
```typescript
// Source: Adapted from src/audit/writer.ts pattern
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export class LedgerWriter {
  private lastHash: string | null = null;

  constructor(private readonly entriesPath: string) {
    this.lastHash = this.recoverLastHash(); // Same crash recovery as AuditWriter
  }

  append(entry: Omit<LedgerEntry, 'prev_hash'>): LedgerEntry {
    const enriched: LedgerEntry = {
      ...entry,
      prev_hash: this.lastHash,
    };
    const line = JSON.stringify(enriched);
    appendFileSync(this.entriesPath, line + '\n', { flag: 'a' });
    this.lastHash = createHash('sha256').update(line).digest('hex');
    return enriched;
  }
}
```

### Index Manager Persistence
```typescript
// Source: Architecture research - ledger/index.json
class IndexManager {
  save(indexPath: string): void {
    const data = {
      byType: Object.fromEntries(
        [...this.byType].map(([k, v]) => [k, [...v]])
      ),
      byAuthor: Object.fromEntries(
        [...this.byAuthor].map(([k, v]) => [k, [...v]])
      ),
      byId: Object.fromEntries(this.byId),
      entryCount: this.byId.size,
      lastHash: this.lastHash,
    };
    const tmpPath = `${indexPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
    renameSync(tmpPath, indexPath);
  }

  static rebuild(entriesPath: string): IndexManager {
    const manager = new IndexManager();
    if (!existsSync(entriesPath)) return manager;
    const content = readFileSync(entriesPath, 'utf-8').trimEnd();
    if (!content) return manager;
    const lines = content.split('\n').filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]!) as LedgerEntry;
      manager.addEntry(entry, i);
    }
    return manager;
  }
}
```

## Discretion Recommendations

Since no CONTEXT.md exists for this phase, all implementation choices are at Claude's discretion. The following recommendations are informed by the existing codebase patterns, PRD specifications, and architecture research.

### 1. LedgerEntryType Count: 26 Types
**Recommendation:** The PRD section 3.2 lists exactly 26 types. The PRD text says `'backup_record'` is the last type. However, counting the PRD list yields 26 types (10 clinical + 3 care network + 4 access control + 3 emergency + 3 patient-authored + 3 system). Define all 26 upfront as a TypeBox Union, matching the Phase 1 pattern of defining all VaultEventTypes upfront.

### 2. SignableContent Definition
**Recommendation:** The SignableContent type should include: `id`, `timestamp`, `entry_type`, `author` (full EntryAuthor including public_key), `payload` (plaintext JSON string), and `metadata` (full EntryMetadata). This ensures the signature covers both the content and the indexing metadata, preventing metadata tampering without invalidating the signature. The `payload_size` in metadata should be the byte length of the plaintext (before encryption), computed before signing.

### 3. Canonical Serialization Approach
**Recommendation:** Use a recursive sorted-keys JSON.stringify replacer function. This produces deterministic output regardless of object construction order. Simpler and more maintainable than a full RFC 8785 implementation. The key constraint is that BOTH the sign path and verify path use the same `canonicalize()` function -- export it from a shared module.

### 4. Index Persistence Strategy
**Recommendation:** Write-then-rename (atomic) for index.json, matching the KeyRing save pattern from Phase 2. On vault open, verify index.entryCount matches JSONL line count. If mismatch, rebuild from entries.jsonl. The index is a performance optimization, not a source of truth.

### 5. Entry File Name
**Recommendation:** Use `ledger/entries.jsonl` per the PRD section 12.1 and architecture research. Single file for v1.

### 6. Error Classes
**Recommendation:** Create a `LedgerError` base class following the CryptoError pattern from Phase 2. Subclasses: `LedgerCorruptedError` (malformed JSONL or schema validation failure), `SignatureVerificationError` (Ed25519 signature mismatch), `ChainVerificationError` (hash chain break). This matches the error hierarchy pattern established in `src/encryption/errors.ts`.

### 7. Provider Write Locality
**Recommendation:** Confirm LOCAL writes only for Phase 3. The STATE.md blocker says "Provider write locality assumption (local writes only) should be confirmed during Phase 3 planning." For the ledger writer, the design assumes the calling code (patient-core or provider-core) runs locally and provides the author's Ed25519 private key for signing. The write pipeline signs with the provided private key and encrypts with the vault's active encryption key. Remote write is a transport concern for Phase 5 (Sync Engine). Phase 3's ledger writer operates locally -- the provider's agent must be present on the machine to write. This is the correct assumption because: (a) the private key must be available for signing, (b) the vault's encryption key must be available for encryption, and (c) both of these are local-only resources.

### 8. Ledger Writer: Synchronous vs Async
**Recommendation:** Synchronous writes (`appendFileSync`), matching the AuditWriter pattern from Phase 1. Rationale: (a) hash chain integrity requires sequential writes (no interleaving), (b) the PRD's scoping notes about async are for the PatientChart facade (Phase 5), not the low-level writer, (c) the AuditWriter already proves this pattern works. Phase 5 can wrap the sync writer in async if needed.

### 9. Query Engine: Streaming vs Materialized
**Recommendation:** Load query results into memory (materialized). For v1 vault sizes (<100K entries), reading and filtering entries.jsonl lines is fast enough. The index provides O(1) candidate set reduction by type/author, then linear scan of candidates for date range/amends filtering. Streaming reads are deferred to v2 (LAPI-06).

### 10. Amendment Model
**Recommendation:** An amendment is a regular entry with `entry_type: 'clinical_amendment'` and `metadata.amends` set to the original entry's UUID. The original entry is never modified. Both the original and amendment are independently queryable via the index. The query engine supports filtering by `amends` to find all amendments to a given entry.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate signature + encryption files | Single JSONL line with both encrypted payload and unencrypted metadata | PRD design | Enables chain verification without decryption; enables indexing without decryption |
| Re-serialize for hash verification | Hash the raw JSONL line bytes | Phase 1 decision [01-03] | Eliminates key-order non-determinism as a chain-breaking failure mode |
| Sign post-encryption (ciphertext) | Sign pre-encryption (plaintext via SignableContent) | PRD design, Architecture research | Signature covers actual clinical content, not the encryption wrapper; anyone with encryption key cannot forge signatures |
| Rebuild index on every open | Persist index.json, rebuild only on mismatch | v1 optimization | Fast vault startup; index is always rebuildable from entries.jsonl |

**Deprecated/outdated:**
- The PRD uses `UUID v4` for entry IDs, but the codebase uses UUIDv7 (established in Phase 1). Use UUIDv7 for consistency with vault IDs and audit entry IDs.
- The PRD's `LedgerEntry.id` says "UUID v4" but Phase 1's `generateUUIDv7()` is the standard. This is a PRD-to-implementation evolution, not a conflict.

## Open Questions

1. **Entry count tracking for key rotation**
   - What we know: The PRD's `KeyRecord` interface includes `entry_count` for tracking how many entries were encrypted with each key. The Phase 2 KeyRing implementation does NOT include `entry_count` on KeyRecord.
   - What's unclear: Should Phase 3 add entry_count tracking to trigger key rotation, or defer to a later phase?
   - Recommendation: Defer entry_count-based automatic rotation. Phase 3 should focus on the ledger itself. The KeyRing already supports manual rotation via `rotate()`. Automatic rotation policy is a Phase 5 concern (PatientChart facade orchestration). However, the LedgerWriter could expose a `getEntryCount()` method for the facade to use as a rotation trigger.

2. **AAD (Additional Authenticated Data) usage**
   - What we know: Phase 2's `encrypt()` function accepts optional AAD. The architecture research suggests using AAD to authenticate unencrypted metadata alongside the encrypted payload.
   - What's unclear: Should the ledger writer pass unencrypted metadata as AAD during encryption?
   - Recommendation: YES, pass the serialized `EntryMetadata` as AAD. This means tampering with the unencrypted metadata (e.g., changing `entry_type` or `author_id`) will cause AES-GCM decryption to fail with an auth tag mismatch, providing metadata integrity for free. The decrypt path must pass the same metadata as AAD. This is a powerful integrity mechanism at zero additional cost.

3. **Genesis entry (vault_initialized)**
   - What we know: The first ledger entry should be a `vault_initialized` system entry with `prev_hash: null`.
   - What's unclear: Should `createVault()` (Phase 1) be modified to write a genesis entry, or should the LedgerWriter handle genesis automatically?
   - Recommendation: Phase 3 should NOT modify `createVault()`. Instead, the LedgerWriter should handle genesis naturally (first entry has prev_hash: null, matching the AuditWriter pattern). The vault_initialized genesis entry will be written by the PatientChart facade in Phase 5 during `create()`. Phase 3 tests should write genesis entries explicitly.

4. **Ledger integrity verification: chain-only vs chain+signatures**
   - What we know: Success Criteria 5 says "detects any hash break, signature failure, or content tampering."
   - What's unclear: Should `verifyLedgerIntegrity()` do both chain verification AND signature verification in a single pass?
   - Recommendation: Provide two separate functions: `verifyChain(entriesPath)` for hash-chain-only verification (fast, does not require key ring) and `verifyIntegrity(entriesPath, keyRing)` for full verification (chain + signatures, requires decryption). The Phase 1 `verifyChain()` from audit can be adapted for ledger chain verification. Full integrity verification walks the chain, decrypts each entry, and verifies each signature -- it is expensive but comprehensive.

## Sources

### Primary (HIGH confidence)
- `src/audit/writer.ts` -- AuditWriter hash-chain JSONL pattern (proven, 67 lines)
- `src/audit/integrity.ts` -- Chain verification pattern (proven, 70 lines)
- `src/encryption/aes.ts` -- AES-256-GCM encrypt/decrypt with internal IV generation (proven, 96 lines)
- `src/encryption/ed25519.ts` -- Ed25519 sign/verifySignature with null algorithm (proven, 111 lines)
- `src/encryption/keyring.ts` -- KeyRing with getEncryptionKey(keyId) and getActiveEncryptionKey() (proven, 342 lines)
- `src/encryption/errors.ts` -- CryptoError hierarchy pattern (proven, 45 lines)
- `src/types/encryption.ts` -- EncryptedPayload TypeBox schema (proven, 64 lines)
- `src/util/uuidv7.ts` -- UUIDv7 generation (proven, 38 lines)
- `patient-chart-PRD.md` sections 3.1-3.5 -- LedgerEntry, LedgerEntryType, EntryAuthor, EntryMetadata interfaces
- `.planning/research/ARCHITECTURE.md` -- Write path and read path data flows, component boundaries
- `.planning/research/PITFALLS.md` -- Pitfall 3 (JSON serialization), Pitfall 4 (signature scope mismatch)
- `.planning/STATE.md` -- Provider write locality blocker, accumulated decisions

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` -- Phase 3 feature summary and pitfall avoidance strategies
- `.planning/research/FEATURES.md` -- Feature decomposition and dependency analysis
- `.planning/phases/01-vault-foundation-audit-pipeline/01-RESEARCH.md` -- AuditWriter pattern documentation
- `.planning/phases/02-encryption-key-management/02-RESEARCH.md` -- SignableContent scope discussion, AAD recommendation

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources (existing codebase and project documentation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies already installed and proven in Phase 1/2; no new packages needed
- Architecture: HIGH -- write path and read path fully documented in architecture research; composition of proven primitives
- Pitfalls: HIGH -- identified from existing codebase patterns, Phase 2 open questions, and comprehensive pitfalls research document
- Discretion recommendations: HIGH -- grounded in existing codebase conventions, PRD specifications, and architecture constraints

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain -- JSONL, hash chaining, and node:crypto APIs are stable; ledger design is well-defined in PRD)
