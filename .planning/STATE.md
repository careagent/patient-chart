# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The patient's health record is a permanent, tamper-proof, encrypted artifact that the patient owns absolutely -- it outlives every application that touches it.
**Current focus:** Phase 3 in progress -- Immutable Ledger

## Current Position

Phase: 3 of 9 (Immutable Ledger)
Plan: 1 of 4 in current phase (COMPLETE)
Status: Executing Phase 3 -- plan 1 of 4 complete
Last activity: 2026-02-24 -- Completed 03-01-PLAN.md (Ledger Types & Canonicalization)

Progress: [████------] 40%

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 3min
- Total execution time: 0.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 - Vault Foundation | 4 | 16min | 4min |
| 2 - Encryption & Key Management | 4 | 10min | 2.5min |
| 3 - Immutable Ledger | 1 | 3min | 3min |
| 9 - Knowledge Graph Layer | 3 | 12min | 4min |

**Recent Trend:**
- Last 5 plans: 3min, 7min, 3min, 2min, 3min
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8-phase build order follows strict architectural dependency graph (Encryption/Audit have no upward deps; Ledger depends on both; Access depends on Ledger; Sync/Emergency depend on Access; Backup depends on Ledger+Facade)
- [Roadmap]: Phase 5 bundles Local API + Sync + Emergency because all three require a working PatientChart facade and access control, and Sync/Emergency have no dependency on each other
- [01-01]: Used .mjs/.d.mts output from tsdown (default ESM extension) and updated package.json exports to match
- [01-01]: Added @types/node as devDependency for node:crypto type declarations
- [01-01]: Excluded barrel exports and type schemas from coverage thresholds to avoid false failures on declarative code
- [01-01]: TypeBox bundled into dist output (inlineOnly: false) to maintain zero runtime deps for consumers
- [01-02]: Removed unused TypeBox import from vault/schema.ts -- only re-exports and const array needed, no schema construction
- [01-03]: Hash computed on exact raw JSON line string (not re-serialized object) to avoid key-order non-determinism breaking the chain
- [01-03]: VaultAuditPipeline generates id (UUIDv7) and timestamp internally -- callers provide only event_type, actor, outcome, details
- [01-03]: Crash recovery walks from end of file backward, skipping malformed trailing lines to find last valid entry
- [01-04]: createVault accepts optional VaultAuditPipeline as second parameter -- audit is opt-in, not required, maintaining backward compatibility
- [01-04]: src/index.ts re-exports types with 'export type' syntax for proper TypeScript isolatedModules compatibility
- [02-01]: Error classes use simple inheritance (CryptoError base) with descriptive this.name for instanceof checks
- [02-01]: DEFAULT_KDF_PARAMS omits salt (generated per vault) -- stores algorithm, N, r, p, key_length only
- [02-01]: HKDF uses sha256 digest -- standard choice for sub-key derivation from scrypt master key
- [02-01]: maxmem set to 256 MiB for scrypt to accommodate N values up to 2^20
- [02-02]: IV is never a parameter -- always generated internally by encrypt to prevent IV reuse by design
- [02-02]: All node:crypto exceptions wrapped in CryptoError with generic messages to prevent key material leakage in errors
- [02-03]: Ed25519 sign uses null algorithm parameter (not sha256) per RFC 8032 EdDSA internal SHA-512
- [02-03]: X25519 low-order rejection relies on OpenSSL automatic protection rather than custom validation
- [02-03]: DER header constants exported as readonly Buffer for documentation and potential validation use
- [02-04]: KeyRing stores keyWrappingKey internally so save/rotate can re-encrypt with fresh IVs without caller re-providing the key
- [02-04]: KeyRing uses static factory methods (create/load) not constructor for enforced initialization patterns
- [02-04]: Key-wrapping key ID is a constant 'kwk' string since it is never stored in the key ring itself
- [09-01]: Error classes follow encryption/errors.ts pattern: simple inheritance with descriptive this.name
- [09-01]: KnowledgeNoteMeta has 5 required fields (id, type, status, created, updated) and 10 optional clinical fields
- [09-01]: KNOWLEDGE_SUBDIRS is a separate constant from VAULT_SUBDIRS for knowledge-module-scoped usage
- [09-02]: KnowledgeStore takes getActiveKey/getKeyById functions instead of KeyRing directly for loose coupling and testability
- [09-02]: Failed getKeyById (unknown key_id) caught and rethrown as NoteCorruptedError for uniform error surface
- [09-02]: listNotes returns paths relative to the search folder (knowledge/ or subfolder), not absolute paths
- [09-03]: Removed unused private readonly from KnowledgeStore vaultPath param -- only used to derive knowledgeDir, not stored
- [03-01]: canonicalize() uses JSON.stringify with recursive key-sorting replacer for deterministic byte output
- [03-01]: LedgerError hierarchy mirrors CryptoError pattern: base class + 3 specific subclasses with locator info
- [03-01]: SignatureVerificationError/ChainVerificationError include entryId/entryIndex for precise diagnostics

### Roadmap Evolution

- Phase 9 added: Knowledge Graph Layer

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 5]: Sync transport contract is unresolved -- the SyncTransport interface consumers implement must be defined before sync delivery layer can be built. Resolve during Phase 4 planning.
- [Phase 5]: Concurrent vault access / file locking strategy needs a decision before PatientChart facade ships. Options: lockfile, in-process mutex, or documented single-consumer constraint. Resolve during Phase 4 planning.
- [Phase 3/4]: Provider write locality assumption CONFIRMED during Phase 3 planning -- local writes only. Remote write is a Phase 5 transport concern. The provider's agent must be present on the machine to write (private key for signing and vault encryption key are local-only resources).

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed 03-01-PLAN.md (Ledger Types & Canonicalization)
Resume file: None
