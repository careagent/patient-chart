# Roadmap: @careagent/patient-chart

## Overview

Build a patient-sovereign, encrypted, append-only health record vault as a zero-dependency TypeScript library. The vault stores the complete longitudinal health record as an immutable, hash-chained, encrypted JSONL ledger on the patient's local machine. The build order follows the strict architectural dependency graph: cryptographic primitives and audit trail first, then the encrypted ledger, then access control layered on top, then the facade API with sync and emergency access, then backup, and finally integration testing and documentation. Each phase delivers a complete, verifiable subsystem that the next phase builds upon.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Vault Foundation & Audit Pipeline** - Buildable project scaffold with vault directory creation, hash-chained audit trail, and integrity verification
- [ ] **Phase 2: Encryption & Key Management** - Complete cryptographic layer with AES-256-GCM, Ed25519, X25519, scrypt, and key ring with rotation
- [ ] **Phase 3: Immutable Ledger** - Hash-chained, encrypted, signed JSONL ledger with write/read pipelines, query engine, and integrity verification
- [ ] **Phase 4: Access Control** - Event-sourced ACL as ledger entries with six roles, write gate, read gate, and materialized view
- [ ] **Phase 5: Local API, Sync Engine & Emergency Access** - PatientChart facade class, event-driven sync with encrypted delivery, and break-glass emergency protocol
- [ ] **Phase 6: Backup Management** - Encrypted backup archives with incremental watermarks and retention policy enforcement
- [ ] **Phase 7: Integration Testing** - End-to-end tests for all vault workflows and mock consumer verification
- [ ] **Phase 8: Documentation & Release** - Architecture guide, API reference, backup guide, README, and CONTRIBUTING

## Phase Details

### Phase 1: Vault Foundation & Audit Pipeline
**Goal**: A buildable, testable TypeScript package with vault directory creation, hash-chained audit writer, and chain integrity verification -- establishing the canonical JSONL append pattern that every subsequent component inherits
**Depends on**: Nothing (foundation phase)
**Requirements**: VALT-01, VALT-02, VALT-03, AUDT-01, AUDT-02, AUDT-03, AUDT-04, AUDT-05
**Success Criteria** (what must be TRUE):
  1. `pnpm build` produces working ESM artifacts with zero runtime npm dependencies and `pnpm test` passes with 80%+ coverage
  2. Calling vault initialization creates the complete directory structure (ledger/, audit/, keys/, sync/, backup/, emergency/) and a valid vault.json with UUID, schema version, and creation timestamp
  3. Audit entries are appended as hash-chained JSONL lines where each entry's prev_hash is the SHA-256 of the previous line, starting from a genesis entry with prev_hash null
  4. Audit chain verification detects any inserted, modified, or deleted entry and reports the exact point of tampering
  5. An audit write failure does not prevent or delay a simulated vault operation (non-blocking audit guarantee)
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold, TypeBox schemas (VaultEventType 39 literals, VaultAuditEntry, AuditActor, VaultMetadata), UUIDv7 utility
- [x] 01-02-PLAN.md — Vault creation (createVault) and discovery (discoverVaults) with TDD
- [x] 01-03-PLAN.md — Audit writer (AuditWriter + VaultAuditPipeline) and chain integrity (verifyChain) with TDD
- [x] 01-04-PLAN.md — Package entry point (src/index.ts), full build verification, human approval checkpoint

### Phase 2: Encryption & Key Management
**Goal**: Complete cryptographic layer providing AES-256-GCM encryption/decryption, Ed25519 signing/verification, X25519 key agreement, scrypt key derivation, and a key ring with rotation -- all using only node:crypto with zero external dependencies
**Depends on**: Phase 1 (vault directory for key storage, audit pipeline for logging key events)
**Requirements**: ENCR-01, ENCR-02, ENCR-03, ENCR-04, ENCR-05, ENCR-06
**Success Criteria** (what must be TRUE):
  1. AES-256-GCM encrypt then decrypt round-trip produces identical plaintext, with a unique 12-byte IV generated internally for every encryption call (never caller-supplied)
  2. Ed25519 sign then verify round-trip succeeds on original data and fails on tampered data, with signing operating on a well-defined SignableContent type (pre-encryption scope)
  3. X25519 key agreement between two generated key pairs produces an identical shared secret on both sides, and rejects low-order public keys
  4. scrypt derivation from a passphrase and salt is deterministic and uses N=2^17 minimum, with parameters stored in vault.json for future upgradeability
  5. Key ring supports rotation: after rotating to a new key, entries encrypted with any prior key can still be decrypted using the retained historical keys
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Immutable Ledger
**Goal**: Hash-chained, encrypted, signed JSONL ledger with a complete write pipeline (encrypt, sign, chain, append), read pipeline (load, verify, decrypt, verify signature), query engine, entry index, and integrity verification
**Depends on**: Phase 2 (AES-256-GCM for payload encryption, Ed25519 for signing, key ring for key IDs)
**Requirements**: LDGR-01, LDGR-02, LDGR-03, LDGR-04, LDGR-05, LDGR-06, LDGR-07, LDGR-08
**Success Criteria** (what must be TRUE):
  1. A ledger entry written to disk is encrypted with AES-256-GCM, signed with Ed25519 (on pre-encryption content), and hash-chained to the previous entry via SHA-256
  2. A ledger entry read from disk is chain-verified, signature-verified against the author's public key, and decrypted to produce the original plaintext payload
  3. Amendments are stored as new entries referencing the original entry's UUID, and both the original and amendment are independently queryable
  4. The query engine filters entries by entry_type, author, date range, and amends field, and the entry index provides O(1) lookups by entry_type and author
  5. Ledger integrity verification walks the full chain and detects any hash break, signature failure, or content tampering, reporting the exact failing entry
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Access Control
**Goal**: Event-sourced ACL stored as immutable ledger entries with six access roles, a write gate enforcing five checks, a read gate enforcing four checks, and a materialized ACL view providing O(1) grant lookups
**Depends on**: Phase 3 (ledger writer for storing grants as entries, ledger reader for materializing ACL on open)
**Requirements**: ACLS-01, ACLS-02, ACLS-03, ACLS-04, ACLS-05, ACLS-06, ACLS-07, ACLS-08
**Success Criteria** (what must be TRUE):
  1. Access grants (create, modify, revoke) are stored as immutable ledger entries (access_grant_created, access_grant_modified, access_grant_revoked) and each operation generates corresponding audit events
  2. The write gate denies a write when any of its five checks fail (invalid signature, no grant, out-of-scope entry type, expired grant, no active relationship) and records the denial reason in the audit trail
  3. The read gate denies a read when any of its four checks fail (no grant, out-of-scope entry type, outside date range, expired grant) and records the denial reason in the audit trail
  4. Grant revocation immediately and permanently blocks the revoked grantee from further reads and writes, with no race window
  5. The materialized ACL view is rebuilt from ledger entries on vault open and provides O(1) grant lookups by grantee ID during gate checks
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Local API, Sync Engine & Emergency Access
**Goal**: PatientChart facade class with create/open/close lifecycle orchestrating all subsystems, an event-driven sync engine with X25519-encrypted per-recipient delivery and retry queue, and a break-glass emergency access protocol with four auth methods and time-limited sessions
**Depends on**: Phase 4 (access control gates for enforcing permissions, grants for sync targets and emergency parties)
**Requirements**: LAPI-01, LAPI-02, LAPI-03, LAPI-04, LAPI-05, SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, EMRG-01, EMRG-02, EMRG-03, EMRG-04, EMRG-05, EMRG-06
**Success Criteria** (what must be TRUE):
  1. PatientChart.create() initializes a new vault (directory structure, key generation, genesis entry) and PatientChart.open() opens an existing vault (derives master key, loads key ring, rebuilds ACL), with close() zeroing all key material from memory
  2. Ledger methods (writeEntry, amendEntry, readEntry, queryEntries) enforce access gates, and access control methods (createGrant, modifyGrant, revokeGrant, listActiveGrants, checkAccess) manage ACL through ledger entries
  3. Every new ledger entry triggers a sync check, and entries within scope of a sync-enabled grant are encrypted per-recipient via X25519 and delivered, with failed deliveries queued for retry with exponential backoff and patient notification after configured failure threshold
  4. Grant revocation immediately cancels all pending sync deliveries for that grant and prevents future sync to the revoked recipient
  5. Emergency access authenticates via one of four methods (passphrase, multi-party quorum, hardware key, trusted Neuron), opens a time-limited read session that automatically expires, enforces a cooldown between sessions, and logs every event to the audit trail
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Backup Management
**Goal**: Encrypted backup archives with incremental watermarks, full backup support, and retention policy enforcement -- all recorded as ledger entries and audit events
**Depends on**: Phase 5 (PatientChart facade for exposing backup methods, encryption layer for archive encryption)
**Requirements**: BKUP-01, BKUP-02, BKUP-03, BKUP-04, BKUP-05
**Success Criteria** (what must be TRUE):
  1. A full backup creates an encrypted archive containing all ledger entries, audit entries, and the current key ring, readable only with the master key
  2. An incremental backup includes only entries written since the last backup watermark, and the watermark advances correctly after each successful backup
  3. Retention policy enforcement deletes backups exceeding the configured max count or max age for a given destination
  4. Every backup operation (start, complete, fail) is recorded as both a backup_record ledger entry and corresponding backup_* audit events
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Integration Testing
**Goal**: End-to-end tests validating complete vault workflows across all subsystems, mock consumer tests simulating patient-core, and package export verification
**Depends on**: Phases 1-6 (all subsystems must be operational)
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04, INTG-05
**Success Criteria** (what must be TRUE):
  1. E2E test completes the full lifecycle: vault creation, entry writes across multiple types, entry reads, ledger integrity verification, and backup -- with hash chains valid throughout
  2. E2E test completes the access control lifecycle: grant creation, write gate enforcement (authorized and denied), read gate enforcement (authorized and denied), grant revocation, and audit trail verification showing every decision
  3. E2E test completes the sync lifecycle: entry written, sync triggered and delivered to authorized recipient, grant revoked, all pending syncs cancelled, no further syncs sent
  4. E2E test completes the emergency lifecycle: trigger request, authentication (success and failure paths), time-limited read session, session expiration, cooldown enforcement blocking early re-trigger
  5. A mock consumer importing @careagent/patient-chart can create a vault, write entries, query entries, manage grants, and verify integrity using only the public API exports
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Documentation & Release
**Goal**: Complete developer documentation enabling any TypeScript developer to create, operate, and back up a patient vault by following the documentation alone
**Depends on**: Phase 7 (all features tested and verified, API surface stable)
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05
**Success Criteria** (what must be TRUE):
  1. Architecture guide (docs/architecture.md) covers vault directory structure, data model, encryption architecture, access control model, sync engine, emergency access, and backup -- sufficient for a developer to understand the system without reading source code
  2. API reference (docs/api.md) documents every public method of PatientChart with parameter types, return types, error conditions, and usage examples
  3. Backup guide (docs/backup.md) covers archive format, incremental vs full backup, watermark behavior, retention policy configuration, and all supported destination types
  4. README.md provides installation instructions, quickstart code example, ecosystem context, and links to detailed documentation
  5. CONTRIBUTING.md covers development environment setup, test execution, coding conventions, and contribution workflow
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 > 2 > 3 > 4 > 5 > 6 > 7 > 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Vault Foundation & Audit Pipeline | 4/4 | Complete | 2026-02-21 |
| 2. Encryption & Key Management | 0/0 | Not started | - |
| 3. Immutable Ledger | 0/0 | Not started | - |
| 4. Access Control | 0/0 | Not started | - |
| 5. Local API, Sync Engine & Emergency Access | 0/0 | Not started | - |
| 6. Backup Management | 0/0 | Not started | - |
| 7. Integration Testing | 0/0 | Not started | - |
| 8. Documentation & Release | 0/0 | Not started | - |
