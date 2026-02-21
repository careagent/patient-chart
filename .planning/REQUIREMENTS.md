# Requirements: @careagent/patient-chart

**Defined:** 2026-02-21
**Core Value:** The patient's health record is a permanent, tamper-proof, encrypted artifact that the patient owns absolutely.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Vault Foundation

- [ ] **VALT-01**: pnpm TypeScript project with tsdown build, vitest testing, zero runtime npm dependencies
- [ ] **VALT-02**: Vault directory structure creation with all required subdirectories (ledger/, audit/, keys/, sync/, backup/, emergency/)
- [ ] **VALT-03**: Vault metadata file (vault.json) with creation timestamp, schema version, vault UUID

### Audit

- [ ] **AUDT-01**: Hash-chained JSONL append-only audit log with SHA-256 chain from genesis
- [ ] **AUDT-02**: 38 vault event types covering lifecycle, ledger, access, write gate, read gate, sync, emergency, keys, and backup
- [ ] **AUDT-03**: Every vault operation (write, read, grant, sync, emergency, backup) generates an audit event
- [ ] **AUDT-04**: Audit chain integrity verification detects any tampering
- [ ] **AUDT-05**: Audit never blocks vault operations (audit write failures do not prevent ledger writes)

### Encryption

- [ ] **ENCR-01**: AES-256-GCM encryption/decryption for ledger entry payloads using node:crypto
- [ ] **ENCR-02**: Ed25519 key pair generation, signing, and verification using node:crypto
- [ ] **ENCR-03**: X25519 key agreement for per-recipient sync payload encryption
- [ ] **ENCR-04**: scrypt key derivation from patient passphrase to master key
- [ ] **ENCR-05**: Key ring with rotation: new keys for new entries, old keys retained for historical decryption
- [ ] **ENCR-06**: All cryptographic operations use only node:crypto — zero external crypto dependencies

### Ledger

- [ ] **LDGR-01**: Hash-chained JSONL append-only ledger with SHA-256 chain from genesis entry
- [ ] **LDGR-02**: Every entry is encrypted with AES-256-GCM before writing to disk
- [ ] **LDGR-03**: Every entry is signed with the author's Ed25519 key
- [ ] **LDGR-04**: 26 ledger entry types covering clinical, care network, access control, emergency, patient-authored, and system categories
- [ ] **LDGR-05**: Amendments reference original entry UUID; original is never modified
- [ ] **LDGR-06**: Ledger query engine supports filtering by entry_type, author, date range, and amends
- [ ] **LDGR-07**: Entry index provides fast lookups by entry_type and author
- [ ] **LDGR-08**: Ledger integrity verification detects any chain break, signature failure, or tampering

### Access Control

- [ ] **ACLS-01**: Access grants are stored as immutable ledger entries (access_grant_* types)
- [ ] **ACLS-02**: Six access roles: provider_write, provider_read, family_read, legal_read, organization_read, application_read
- [ ] **ACLS-03**: Write gate enforces signature verification, grant check, scope check, expiration check, relationship check
- [ ] **ACLS-04**: Read gate enforces grant check, scope check, date range check, expiration check
- [ ] **ACLS-05**: Grant revocation immediately blocks further access
- [ ] **ACLS-06**: Grant expiration automatically triggers access_grant_expired entry
- [ ] **ACLS-07**: Materialized ACL view provides O(1) grant lookups, rebuilt from ledger on vault open
- [ ] **ACLS-08**: Grant create, modify, and revoke operations are recorded as ledger entries and audit events

### Sync Engine

- [ ] **SYNC-01**: Every new ledger entry triggers a sync check against active grants with sync.enabled
- [ ] **SYNC-02**: Sync payloads are encrypted per-recipient using X25519 key agreement
- [ ] **SYNC-03**: Retry queue with exponential backoff for failed deliveries
- [ ] **SYNC-04**: Grant revocation immediately cancels all pending sync deliveries for that grant
- [ ] **SYNC-05**: Patient is notified after alert_after_failures consecutive sync failures
- [ ] **SYNC-06**: Every sync event (triggered, delivered, failed, retried, stopped) is recorded in audit trail

### Emergency Access

- [ ] **EMRG-01**: Patient-configurable emergency access protocol with authorized parties, auth methods, and scope
- [ ] **EMRG-02**: Four authentication methods: passphrase, multi-party quorum, hardware key, trusted Neuron
- [ ] **EMRG-03**: Time-limited emergency sessions with automatic expiration
- [ ] **EMRG-04**: Cooldown period between emergency sessions
- [ ] **EMRG-05**: Every emergency event (trigger, auth success/failure, session start/end, cooldown) logged to audit trail
- [ ] **EMRG-06**: Failed authentication attempts are logged with full context

### Local API

- [ ] **LAPI-01**: PatientChart.create() initializes a new vault with directory structure, key generation, and genesis entry
- [ ] **LAPI-02**: PatientChart.open() opens an existing vault, derives master key, loads key ring, rebuilds ACL
- [ ] **LAPI-03**: Ledger methods (writeEntry, amendEntry, readEntry, queryEntries) enforce access gates
- [ ] **LAPI-04**: Access control methods (createGrant, modifyGrant, revokeGrant, listActiveGrants, checkAccess) manage ACL as ledger entries
- [ ] **LAPI-05**: Status methods (getStatus, getSyncStatus, getKeyRingStatus) provide vault health information

### Backup

- [ ] **BKUP-01**: Encrypted backup archives containing ledger entries, audit entries, and key ring
- [ ] **BKUP-02**: Incremental backup using watermarks — only new entries since last backup
- [ ] **BKUP-03**: Full backup support — complete vault snapshot
- [ ] **BKUP-04**: Retention policy enforcement (max count, max age) per backup destination
- [ ] **BKUP-05**: All backup operations recorded as backup_record ledger entries and backup_* audit events

### Integration

- [ ] **INTG-01**: E2E: vault creation -> entry write -> entry read -> integrity verification -> backup
- [ ] **INTG-02**: E2E: access grant lifecycle -> write gate -> read gate -> revocation -> audit trail verification
- [ ] **INTG-03**: E2E: sync lifecycle -> entry written -> sync delivered -> grant revoked -> sync stopped
- [ ] **INTG-04**: E2E: emergency access -> trigger -> authenticate -> read -> session end -> cooldown
- [ ] **INTG-05**: Mock consumer tests simulating patient-core consuming the local API through package exports

### Documentation

- [ ] **DOCS-01**: Architecture guide (docs/architecture.md)
- [ ] **DOCS-02**: API reference (docs/api.md)
- [ ] **DOCS-03**: Backup guide (docs/backup.md)
- [ ] **DOCS-04**: README.md updated with usage instructions and ecosystem context
- [ ] **DOCS-05**: CONTRIBUTING.md with development setup and guidelines

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Ledger

- **LDGR-09**: Merkle tree overlay for O(log n) integrity proofs
- **LDGR-10**: Ledger compaction and archival for long-running vaults

### Encryption

- **ENCR-07**: Post-quantum key exchange (ML-KEM)
- **ENCR-08**: Hardware security module (HSM) integration for key storage

### Access Control

- **ACLS-09**: Per-data-category access control (medications, diagnoses, mental health, substance use)
- **ACLS-10**: Delegated grant administration (patient delegates grant management to a trusted party)

### Sync Engine

- **SYNC-07**: Bidirectional sync (receive updates from providers, not just send)
- **SYNC-08**: Conflict resolution for concurrent writes from multiple providers

### Backup

- **BKUP-06**: Automated backup scheduling with cron-like configuration
- **BKUP-07**: Backup verification and restore testing

### Emergency Access

- **EMRG-07**: Rate limiting for emergency authentication attempts
- **EMRG-08**: Emergency access notification to patient's emergency contacts

### Local API

- **LAPI-06**: Streaming read API for large query results
- **LAPI-07**: Vault migration tool for schema version upgrades

### Integration

- **INTG-06**: Live cross-repo integration test with patient-core consuming patient-chart
- **INTG-07**: Performance benchmarks for ledger write throughput and query latency

### Documentation

- **DOCS-06**: Emergency access configuration walkthrough for patients
- **DOCS-07**: Security audit report and threat model documentation

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| HTTP API or network endpoints | Vault is programmatic only — no network attack surface |
| External database (SQLite, PostgreSQL) | Hash-chained JSONL files are the storage layer — zero deps |
| Multi-patient support | One vault per patient; caregiver access modeled as grants |
| Real-time streaming | Vault is a ledger, not a streaming service |
| Cloud-first storage | Local-first; cloud is a backup destination |
| User interface | Infrastructure only; consumers build UI |
| Bulk export | Undermines access control model |
| Clinical interpretation | Vault stores data, does not interpret |
| Entry deletion | Breaks hash chains and legal defensibility |
| Real patient data in dev | Synthetic only — architecture is PHI-ready |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VALT-01 | Phase 1 | Pending |
| VALT-02 | Phase 1 | Pending |
| VALT-03 | Phase 1 | Pending |
| AUDT-01 | Phase 1 | Pending |
| AUDT-02 | Phase 1 | Pending |
| AUDT-03 | Phase 1 | Pending |
| AUDT-04 | Phase 1 | Pending |
| AUDT-05 | Phase 1 | Pending |
| ENCR-01 | Phase 2 | Pending |
| ENCR-02 | Phase 2 | Pending |
| ENCR-03 | Phase 2 | Pending |
| ENCR-04 | Phase 2 | Pending |
| ENCR-05 | Phase 2 | Pending |
| ENCR-06 | Phase 2 | Pending |
| LDGR-01 | Phase 3 | Pending |
| LDGR-02 | Phase 3 | Pending |
| LDGR-03 | Phase 3 | Pending |
| LDGR-04 | Phase 3 | Pending |
| LDGR-05 | Phase 3 | Pending |
| LDGR-06 | Phase 3 | Pending |
| LDGR-07 | Phase 3 | Pending |
| LDGR-08 | Phase 3 | Pending |
| ACLS-01 | Phase 4 | Pending |
| ACLS-02 | Phase 4 | Pending |
| ACLS-03 | Phase 4 | Pending |
| ACLS-04 | Phase 4 | Pending |
| ACLS-05 | Phase 4 | Pending |
| ACLS-06 | Phase 4 | Pending |
| ACLS-07 | Phase 4 | Pending |
| ACLS-08 | Phase 4 | Pending |
| SYNC-01 | Phase 5 | Pending |
| SYNC-02 | Phase 5 | Pending |
| SYNC-03 | Phase 5 | Pending |
| SYNC-04 | Phase 5 | Pending |
| SYNC-05 | Phase 5 | Pending |
| SYNC-06 | Phase 5 | Pending |
| EMRG-01 | Phase 5 | Pending |
| EMRG-02 | Phase 5 | Pending |
| EMRG-03 | Phase 5 | Pending |
| EMRG-04 | Phase 5 | Pending |
| EMRG-05 | Phase 5 | Pending |
| EMRG-06 | Phase 5 | Pending |
| LAPI-01 | Phase 5 | Pending |
| LAPI-02 | Phase 5 | Pending |
| LAPI-03 | Phase 5 | Pending |
| LAPI-04 | Phase 5 | Pending |
| LAPI-05 | Phase 5 | Pending |
| BKUP-01 | Phase 6 | Pending |
| BKUP-02 | Phase 6 | Pending |
| BKUP-03 | Phase 6 | Pending |
| BKUP-04 | Phase 6 | Pending |
| BKUP-05 | Phase 6 | Pending |
| INTG-01 | Phase 7 | Pending |
| INTG-02 | Phase 7 | Pending |
| INTG-03 | Phase 7 | Pending |
| INTG-04 | Phase 7 | Pending |
| INTG-05 | Phase 7 | Pending |
| DOCS-01 | Phase 8 | Pending |
| DOCS-02 | Phase 8 | Pending |
| DOCS-03 | Phase 8 | Pending |
| DOCS-04 | Phase 8 | Pending |
| DOCS-05 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 62 total
- Mapped to phases: 62
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after roadmap creation*
