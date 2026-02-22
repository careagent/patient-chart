---
phase: 02-encryption-key-management
plan: 01
subsystem: encryption
tags: [typebox, scrypt, hkdf, node-crypto, key-derivation, aes-256-gcm]

# Dependency graph
requires:
  - phase: 01-vault-foundation
    provides: TypeBox schema patterns (vault.ts, audit.ts), project structure, test infrastructure
provides:
  - TypeBox schemas for EncryptedPayload, KdfParams, KeyRecord, KeyRingData
  - Typed crypto error classes (CryptoError, VaultAuthenticationError, KeyRingCorruptedError, KeyNotFoundError)
  - scrypt master key derivation from passphrase + salt
  - HKDF domain-separated sub-key derivation
  - DEFAULT_KDF_PARAMS constant for vault.json storage
affects: [02-02, 02-03, 02-04, 03-ledger, encryption]

# Tech tracking
tech-stack:
  added: []
  patterns: [scrypt-key-derivation, hkdf-domain-separation, typed-crypto-errors]

key-files:
  created:
    - src/types/encryption.ts
    - src/encryption/errors.ts
    - src/encryption/kdf.ts
    - test/unit/kdf.test.ts
  modified:
    - src/types/index.ts

key-decisions:
  - "Error classes use simple inheritance (CryptoError base) with descriptive this.name for instanceof checks"
  - "DEFAULT_KDF_PARAMS omits salt (generated per vault) — stores algorithm, N, r, p, key_length only"
  - "HKDF uses sha256 digest — standard choice for sub-key derivation from scrypt master key"

patterns-established:
  - "Crypto error hierarchy: CryptoError > VaultAuthenticationError | KeyRingCorruptedError | KeyNotFoundError"
  - "KDF pipeline: passphrase + salt -> scrypt -> masterKey -> HKDF(info) -> sub-key"
  - "Encryption TypeBox schemas follow same pattern as vault.ts/audit.ts: schema + Static type export"

requirements-completed: [ENCR-04, ENCR-06]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 2 Plan 1: Encryption Types, Errors, and Key Derivation Summary

**TypeBox schemas for vault encryption data contracts, typed crypto error classes, and scrypt+HKDF key derivation pipeline producing deterministic 32-byte master and sub-keys from patient passphrase**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T02:37:55Z
- **Completed:** 2026-02-22T02:40:07Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Four TypeBox schemas (EncryptedPayload, KdfParams, KeyRecord, KeyRingData) defining the data contracts for the entire encryption subsystem
- Four typed error classes providing specific failure modes for crypto operations (wrong passphrase, corrupted key ring, missing key)
- scrypt + HKDF key derivation pipeline with minimum N=2^17 enforcement and domain-separated sub-keys
- 10 new KDF tests covering determinism, domain separation, and safety constraints; 52 total tests passing at 90%+ coverage

## Task Commits

Each task was committed atomically:

1. **Task 1: TypeBox encryption schemas and typed error classes** - `4d9db93` (feat)
2. **Task 2: scrypt + HKDF key derivation with TDD tests** - `41e4180` (feat)

## Files Created/Modified
- `src/types/encryption.ts` - TypeBox schemas for EncryptedPayload, KdfParams, KeyRecord, KeyRingData with Static types
- `src/types/index.ts` - Re-exports all new schemas and types from encryption.ts
- `src/encryption/errors.ts` - CryptoError, VaultAuthenticationError, KeyRingCorruptedError, KeyNotFoundError
- `src/encryption/kdf.ts` - deriveMasterKey (scrypt), deriveSubKey (HKDF), generateSalt, DEFAULT_KDF_PARAMS
- `test/unit/kdf.test.ts` - 10 tests for KDF determinism, domain separation, minimum N enforcement

## Decisions Made
- Error classes use simple inheritance (CryptoError base) with descriptive `this.name` for instanceof checks
- DEFAULT_KDF_PARAMS omits salt (generated per vault) -- stores algorithm, N, r, p, key_length only
- HKDF uses sha256 digest -- standard choice for sub-key derivation from scrypt master key
- maxmem set to 256 MiB for scrypt to accommodate N values up to 2^20

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Encryption schemas ready for AES-256-GCM implementation (Plan 02-02)
- Error classes ready for use across all encryption modules
- KDF pipeline ready for key ring creation and vault open flows
- All subsequent Phase 2 plans depend on these types and the KDF pipeline

## Self-Check: PASSED

All 5 files verified present on disk. Both commit hashes (4d9db93, 41e4180) verified in git log.

---
*Phase: 02-encryption-key-management*
*Completed: 2026-02-22*
