# CLAUDE.md -- @careagent/patient-chart

## Project Overview

Patient-chart is the **encrypted append-only vault** for patient health records in the CareAgent ecosystem. It provides a patient-sovereign data store where every clinical entry is encrypted with AES-256-GCM, signed with Ed25519, and linked into a hash-chained ledger for tamper evidence. The package has **zero runtime dependencies** -- all cryptography uses `node:crypto` and all I/O uses `node:fs`.

## The Irreducible Risk Hypothesis

Clinical AI agents carry irreducible risk of harm. Patient-chart manages this risk as the **last line of data integrity defense** -- even if every other layer is compromised, the patient's health record maintains cryptographic guarantees: entries cannot be modified (append-only), deleted (no delete API), forged (Ed25519 signatures), or reordered (hash-chained prev_hash). The KeyRing supports rotation so that a compromised key does not expose the entire history. Every vault operation is audit-logged through its own hash-chained audit trail.

## Directory Structure

```
patient-chart/
  src/
    audit/              # Vault-level audit writer + chain integrity verifier
    encryption/
      aes.ts            # AES-256-GCM encrypt/decrypt
      ed25519.ts        # Ed25519 key generation, signing, verification
      x25519.ts         # X25519 key exchange (Diffie-Hellman)
      kdf.ts            # Argon2id-based key derivation (via scrypt fallback)
      keyring.ts        # KeyRing -- key lifecycle, rotation, encrypted storage
      errors.ts         # CryptoError, VaultAuthenticationError, etc.
    knowledge/          # Knowledge graph (clinical notes, structured data)
      store.ts          # KnowledgeStore -- CRUD for clinical knowledge notes
      schema.ts         # Subdirectory structure constants
      errors.ts         # NoteNotFoundError, PathTraversalError, etc.
    ledger/
      writer.ts         # LedgerWriter -- append entries to JSONL file
      reader.ts         # Read individual or all entries
      query.ts          # Query entries by type, author, date range
      integrity.ts      # Chain verification + per-entry signature verification
      index-manager.ts  # Accelerated index for entry lookups
      canonicalize.ts   # Deterministic JSON serialization for signing
      schema.ts         # File constants (entries.jsonl, index.json)
      errors.ts         # LedgerCorruptedError, SignatureVerificationError, etc.
    types/
      audit.ts          # Vault audit entry TypeBox schema (event types)
      encryption.ts     # EncryptedPayload, KdfParams, KeyRecord, KeyRingData schemas
      knowledge.ts      # KnowledgeNoteMeta, ClinicalStatus, NoteType schemas
      ledger.ts         # LedgerEntry, 26 LedgerEntryType literals, author, metadata
      vault.ts          # VaultMetadata schema
      index.ts          # Type re-exports
    util/
      uuidv7.ts         # UUIDv7 generator (time-ordered IDs)
    vault/
      create.ts         # createVault() -- initialize vault directory structure
      discover.ts       # discoverVaults() -- find vault directories
      schema.ts         # Vault subdirectory constants
    index.ts            # Comprehensive barrel export
  test/
    unit/               # Unit tests
```

## Commands

```bash
pnpm build             # Build with tsdown
pnpm test              # Run tests with coverage: vitest run --coverage
pnpm test:watch        # Watch mode: vitest
pnpm typecheck         # Type check: tsc --noEmit
```

Note: `pnpm test` includes `--coverage` by default in this repo.

## Code Conventions

- **ESM-only** -- `"type": "module"` in package.json. All imports use `.js` extensions.
- **Zero runtime dependencies** -- everything uses `node:crypto` and `node:fs`. TypeBox is devDependency only.
- **TypeBox for all schemas** -- `@sinclair/typebox` (devDependency). All type schemas in `src/types/`. Use `Type.Object()`, `Type.Union()`, `Type.Literal()` patterns.
- **TypeScript types derived from TypeBox** -- `type Foo = Static<typeof FooSchema>`. Do NOT define standalone interfaces when a TypeBox schema exists.
- **Barrel exports** -- root `src/index.ts` is a comprehensive re-export of all public API. Single subpath export: `.` only.
- **Naming**: PascalCase for classes and schemas (suffix `Schema`), camelCase for functions, UPPER_SNAKE for constants.
- **Semicolons** -- this repo uses semicolons.
- **Atomic writes** -- use write-then-rename pattern (`writeFileSync` to temp file, then `renameSync`) for crash safety.
- **Node.js >= 22.12.0** required.
- **pnpm** as package manager.
- **Vitest** for testing. ~184 tests.

## Anti-Patterns

- **Do NOT add runtime dependencies.** This package has zero production deps. All crypto via `node:crypto`. Keep it that way.
- **Do NOT implement entry deletion or mutation.** The ledger is append-only. Corrections use `clinical_amendment` entry type with an `amends` field pointing to the original entry UUID.
- **Do NOT skip Ed25519 signature verification** when reading entries. Every entry's signature must be verified against the author's public key.
- **Do NOT break the hash chain.** Each entry's `prev_hash` is the SHA-256 of the previous JSONL line. The genesis entry has `prev_hash: null`. Never insert, reorder, or modify entries.
- **Do NOT expose raw key material** outside the KeyRing. The KeyRing encrypts all keys at rest using AES-256-GCM with a key-wrapping key. Use `destroy()` to zero Buffers when done.
- **Do NOT use `writeFileSync` directly for critical data.** Use write-then-rename (write to `.tmp`, then `renameSync`) for atomic crash-safe writes.
- **Do NOT use relative imports without `.js` extension.** ESM requires explicit extensions.
- **Do NOT store unencrypted PHI on disk.** All clinical payloads must pass through `encrypt()` before writing.

## Key Technical Details

### Encryption Stack

- **AES-256-GCM** (`src/encryption/aes.ts`) -- symmetric encryption for all clinical payloads. 96-bit IV, 128-bit auth tag.
- **Ed25519** (`src/encryption/ed25519.ts`) -- asymmetric signing for entry integrity. Each author has an identity key pair.
- **X25519** (`src/encryption/x25519.ts`) -- Diffie-Hellman key exchange for establishing shared secrets between patient and provider agents.
- **KDF** (`src/encryption/kdf.ts`) -- key derivation with configurable params. `deriveMasterKey()` and `deriveSubKey()` for key hierarchy.

### KeyRing (`src/encryption/keyring.ts`)

- Static factory: `KeyRing.create()` (new vault) or `KeyRing.load()` (existing)
- Manages encryption keys + Ed25519 identity key pair
- Keys encrypted at rest via key-wrapping key (AES-256-GCM)
- `rotate()` -- generates new active key, retires old key (old entries remain decryptable)
- `destroy()` -- zeros all Buffer key material
- Serialized as `KeyRingData` TypeBox schema

### 26 Ledger Entry Types

Organized into 6 categories:

1. **Clinical (10)**: encounter, medication, allergy, diagnosis, problem_list, lab_result, imaging_result, pathology, procedure, amendment
2. **Care Network (3)**: relationship_established, relationship_terminated, relationship_suspended
3. **Access Control (4)**: grant_created, grant_modified, grant_revoked, grant_expired
4. **Emergency (3)**: config_set, access_triggered, access_ended
5. **Patient-Authored (3)**: note, directive, preference
6. **System (3)**: vault_initialized, key_rotation, sync_record

### Ledger Integrity

- **Hash chain**: each entry's `prev_hash` = SHA-256 of the previous JSONL line (genesis = `null`)
- **Ed25519 signature**: covers `SignableContent` (id, timestamp, entry_type, author, payload, metadata) canonicalized via deterministic JSON serialization
- **Verification**: `verifyLedgerChain()` checks hash continuity; `verifyLedgerIntegrity()` checks signatures

### Knowledge Graph (`src/knowledge/store.ts`)

`KnowledgeStore` manages structured clinical notes in subdirectories. Notes have metadata (clinical status, verification status, note type) and are stored as individual files. Path traversal protection prevents directory escape.

### Vault Structure

Created by `createVault()`: initializes subdirectories (defined in `VAULT_SUBDIRS`) and writes `vault.json` with UUIDv7 identifier, schema version, and creation timestamp.

### UUIDv7

`src/util/uuidv7.ts` -- time-ordered UUIDs for entry IDs. Ensures chronological ordering of entries.

### A2A Protocol

Patient-chart is **unaffected** by A2A adoption. It is a local library with no network exposure — consumed by patient-core as a dependency. No A2A SDK, no Agent Card, no network transport.
