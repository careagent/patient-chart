# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The patient's health record is a permanent, tamper-proof, encrypted artifact that the patient owns absolutely -- it outlives every application that touches it.
**Current focus:** Phase 2: Encryption & Key Management

## Current Position

Phase: 2 of 8 (Encryption & Key Management)
Plan: 4 of 4 in current phase
Status: Executing Phase 2 plans
Last activity: 2026-02-22 -- Completed 02-03-PLAN.md (Ed25519/X25519 Signing and Key Agreement)

Progress: [████░░░░░░] 22%

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 3min
- Total execution time: 0.38 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 - Vault Foundation | 4 | 16min | 4min |
| 2 - Encryption & Key Management | 3 | 7min | 2min |

**Recent Trend:**
- Last 5 plans: 3min, 5min, 2min, 2min, 3min
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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 5]: Sync transport contract is unresolved -- the SyncTransport interface consumers implement must be defined before sync delivery layer can be built. Resolve during Phase 4 planning.
- [Phase 5]: Concurrent vault access / file locking strategy needs a decision before PatientChart facade ships. Options: lockfile, in-process mutex, or documented single-consumer constraint. Resolve during Phase 4 planning.
- [Phase 3/4]: Provider write locality assumption (local writes only) should be confirmed during Phase 3 planning.

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 02-03-PLAN.md (Ed25519/X25519 Signing and Key Agreement)
Resume file: None
