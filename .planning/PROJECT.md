# @careagent/patient-chart

## What This Is

A pnpm TypeScript package that provides the patient's sovereign, encrypted, append-only health record vault. It stores the complete longitudinal health record as an immutable, hash-chained, encrypted JSONL ledger on the patient's local machine. It is consumed programmatically by `@careagent/patient-core` and authorized applications — it has no CLI, no HTTP API, and no UI.

## Core Value

The patient's health record is a permanent, tamper-proof, encrypted artifact that the patient owns absolutely — it outlives every application that touches it, and no entity can alter or delete what has been written.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Vault directory structure creation and metadata
- [ ] Hash-chained JSONL append-only audit pipeline (mirrors provider-core's AuditWriter)
- [ ] AES-256-GCM encryption/decryption via node:crypto
- [ ] Ed25519 signing/verification via node:crypto
- [ ] X25519 key agreement for per-recipient sync encryption
- [ ] scrypt key derivation from passphrase to master key
- [ ] Key ring with rotation (old keys retained for historical decryption)
- [ ] Hash-chained, encrypted, signed JSONL ledger with 26 entry types
- [ ] Amendment model (new entries referencing original UUID)
- [ ] Ledger query engine with entry index for fast lookups
- [ ] Ledger and audit integrity verification
- [ ] ACL as immutable ledger entries (6 roles)
- [ ] Write gate (signature, grant, scope, expiration, relationship checks)
- [ ] Read gate (grant, scope, date range, expiration checks)
- [ ] Materialized ACL view rebuilt from ledger entries
- [ ] PatientChart class with create/open/close lifecycle
- [ ] Event-driven sync engine with encrypted delivery and retry queue
- [ ] Immediate sync stop on grant revocation
- [ ] Break-glass emergency access with 4 auth methods
- [ ] Time-limited emergency sessions with cooldown
- [ ] Encrypted backup archives (full and incremental with watermarks)
- [ ] Retention policy enforcement
- [ ] E2E integration tests for all vault workflows
- [ ] Package export verification
- [ ] Architecture, API, and backup documentation

### Out of Scope

- HTTP API or network endpoints — vault is programmatic only, no network attack surface
- External database (SQLite, PostgreSQL) — hash-chained JSONL files are the storage layer
- Multi-patient support — one vault per patient, caregiver access modeled as grants
- Real-time streaming — vault is a ledger, not a streaming service
- Cloud-first storage — local-first, cloud is a backup destination
- User interface — infrastructure only, consumers build UI
- Bulk export — undermines access control model
- Clinical interpretation — vault stores data, does not interpret it
- Entry deletion — breaks hash chains and legal defensibility
- Real patient data in dev — synthetic only

## Context

patient-chart is part of the CareAgent ecosystem alongside provider-core (fully built, v1 phases 1-5 complete), patient-core (PRD complete, not yet built), axon (PRD complete, not yet built), and neuron (README only). The hash-chained JSONL pattern is proven in provider-core's AuditWriter. The crypto spec (AES-256-GCM, Ed25519, X25519) aligns with patient-core's planned encryption architecture. All ecosystem packages share the same zero-dependency TypeScript stack.

The PRD (`patient-chart-PRD.md`) contains complete TypeScript interfaces for all data models: LedgerEntry, LedgerEntryType (26 types), EntryAuthor, EncryptedPayload, EntryMetadata, AccessGrant, AccessRole (6 roles), GranteeIdentity, AccessScope, TimeLimits, SyncConfig, SyncEndpoint, RetryPolicy, EmergencyConfig, EmergencyParty, EmergencyAuthMethod, CredentialStorage, VaultAuditEntry, VaultEventType (38 types), AuditActor.

## Constraints

- **Zero runtime deps**: All crypto via node:crypto, all I/O via node:fs/node:path — same as provider-core
- **Tech stack**: Node.js >=22.12.0, TypeScript ~5.7.x, pnpm, tsdown ~0.20.x, vitest ~4.0.x, @sinclair/typebox ~0.34.x
- **Storage**: Hash-chained JSONL files only — no database
- **No network**: Programmatic API only — no HTTP, no REST, no WebSocket
- **Synthetic data**: No real PHI in development
- **Independence**: No dependency on patient-core or provider-core — consumed by them

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hash-chained JSONL (not SQLite) | Matches provider-core pattern, zero deps, tamper-evident by design | — Pending |
| ACL as ledger entries (event sourcing) | Complete access history in the immutable record, same source of truth | — Pending |
| AES-256-GCM + Ed25519 + X25519 | Standard algorithms, all available in node:crypto, matches patient-core spec | — Pending |
| Programmatic API only (no HTTP) | Eliminates network attack surface, vault is local infrastructure | — Pending |
| Materialized ACL view (rebuilt on open) | O(1) grant lookups without external index, consistency guaranteed by rebuild | — Pending |

---
*Last updated: 2026-02-21 after initialization*
