---
phase: 03-immutable-ledger
plan: 01
subsystem: ledger
tags: [typebox, ed25519, canonicalize, jsonl, ledger-types]

# Dependency graph
requires:
  - phase: 02-encryption
    provides: EncryptedPayloadSchema for LedgerEntry encrypted_payload field
provides:
  - LedgerEntryTypeSchema with 26 entry types across 6 categories
  - EntryAuthor, EntryMetadata, SignableContent, LedgerEntry TypeBox schemas
  - LedgerError class hierarchy (LedgerCorruptedError, SignatureVerificationError, ChainVerificationError)
  - Deterministic canonicalize() function for Ed25519 signature input
  - ENTRIES_FILENAME and INDEX_FILENAME ledger constants
affects: [03-02-PLAN, 03-03-PLAN, 03-04-PLAN, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [recursive-key-sort-canonicalization, ledger-error-hierarchy]

key-files:
  created:
    - src/types/ledger.ts
    - src/ledger/errors.ts
    - src/ledger/canonicalize.ts
    - src/ledger/schema.ts
    - test/unit/canonicalize.test.ts
  modified:
    - src/types/index.ts

key-decisions:
  - "canonicalize() uses JSON.stringify with recursive key-sorting replacer for deterministic byte output"
  - "LedgerError hierarchy mirrors CryptoError pattern: base class + 3 specific subclasses"
  - "SignatureVerificationError and ChainVerificationError include locator info (entryId/entryIndex) for diagnostics"

patterns-established:
  - "Ledger error classes: same inheritance pattern as encryption/errors.ts (base + specific)"
  - "Ledger module schema.ts: re-exports types from types/ plus module-specific constants"

# Metrics
duration: 3min
completed: 2026-02-24
---

# Phase 3 Plan 1: Ledger Types & Canonicalization Summary

**TypeBox schemas for 26-type immutable ledger with deterministic canonicalize() for Ed25519 signing and LedgerError class hierarchy**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-24T13:23:24Z
- **Completed:** 2026-02-24T13:26:09Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Defined LedgerEntryTypeSchema with 26 string literal types across 6 categories (clinical, care network, access control, emergency, patient-authored, system)
- Created full on-disk LedgerEntry schema separating unencrypted metadata envelope from EncryptedPayload
- Implemented deterministic canonicalize() with recursive key sorting for Ed25519 signature input
- Added LedgerError hierarchy following established CryptoError pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Ledger TypeBox schemas and typed error classes** - `ceab889` (feat)
2. **Task 2: Deterministic canonicalize function with tests** - `3700a0b` (feat)

## Files Created/Modified
- `src/types/ledger.ts` - 5 TypeBox schemas (LedgerEntryType, EntryAuthor, EntryMetadata, SignableContent, LedgerEntry) and 5 static types
- `src/ledger/errors.ts` - 4 error classes (LedgerError base, LedgerCorruptedError, SignatureVerificationError, ChainVerificationError)
- `src/ledger/canonicalize.ts` - Deterministic JSON serialization with recursive key sorting for Ed25519 signing
- `src/ledger/schema.ts` - ENTRIES_FILENAME/INDEX_FILENAME constants and type re-exports
- `src/types/index.ts` - Added ledger type and schema re-exports
- `test/unit/canonicalize.test.ts` - 5 tests covering determinism, nested sorting, roundtrip, optional fields, UTF-8

## Decisions Made
- canonicalize() uses JSON.stringify with a recursive key-sorting replacer function for deterministic byte output -- simpler than a full RFC 8785 (JCS) implementation while meeting the same determinism requirement for Ed25519 signing
- LedgerError hierarchy mirrors the CryptoError pattern from Phase 2: base class with descriptive this.name, specific subclasses for each failure mode
- SignatureVerificationError accepts entryId and ChainVerificationError accepts entryIndex for precise error diagnostics

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All TypeBox schemas ready for import by ledger writer (03-02), reader/query (03-03), and integrity (03-04) plans
- canonicalize() ready for Ed25519 signing in the writer module
- Error classes ready for throw/catch in all ledger operations
- 137 total tests passing with zero regressions

## Self-Check: PASSED

All 6 files verified present on disk. Both task commits (ceab889, 3700a0b) verified in git log.

---
*Phase: 03-immutable-ledger*
*Completed: 2026-02-24*
