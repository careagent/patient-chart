# Feature Research

**Domain:** Encrypted, patient-controlled, append-only health record vault (local-first programmatic library)
**Researched:** 2026-02-21
**Confidence:** HIGH (domain well-understood; PRD provides complete specification; research confirms alignment with industry patterns)

## Feature Landscape

### Table Stakes (Vault Is Unusable Without These)

These are the foundational guarantees. Without any one of them, the vault cannot credibly claim to be an immutable, encrypted, patient-controlled health record. No one gives you credit for having them, but their absence renders the vault untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Hash-chained append-only ledger** | Tamper-evidence is the core integrity guarantee. Every immutable record system (blockchain, Certificate Transparency, SQL Server Ledger) uses hash chaining. Without it, entries can be silently altered. | MEDIUM | SHA-256 chain from genesis. Pattern proven in provider-core's AuditWriter. Must handle genesis entry (prev_hash: null) and chain verification. PRD reqs: LDGR-01, LDGR-08. |
| **AES-256-GCM payload encryption** | Health records contain the most sensitive personal data. Encryption at rest is a HIPAA addressable requirement and a moral imperative for patient sovereignty. Unencrypted health records on disk are a non-starter. | MEDIUM | Per-entry encryption with unique IV. Key ID in each payload links to key ring. Must handle encrypt/decrypt round-trip fidelity. PRD reqs: ENCR-01. |
| **Ed25519 digital signatures** | Every entry must be attributable to a verified author. Without signatures, any process with disk access could forge entries. Signatures provide non-repudiation and legal defensibility. | MEDIUM | Sign pre-encryption content. Verify on read. Must store author public keys. PRD reqs: ENCR-02, LDGR-03. |
| **scrypt key derivation** | The patient's passphrase must derive the master key. Without KDF, the master key would need to be stored in plaintext or use a weaker derivation. scrypt is memory-hard, resisting GPU/ASIC attacks. | LOW | Deterministic given same passphrase + salt. Intentionally slow (security feature). PRD req: ENCR-04. |
| **Key ring with rotation** | Encryption keys have cryptoperiods (NIST SP 800-57). Without rotation, a compromised key exposes the entire vault. Without key retention, historical entries become unreadable after rotation. | MEDIUM | New key for new entries, old keys retained for historical decryption. Key ring encrypted by master key. PRD req: ENCR-05. |
| **Access control (read gate + write gate)** | Multi-party access (patient, providers, family, legal) requires enforceable boundaries. Without gates, any caller with a reference to the vault object can read/write anything. | HIGH | Write gate: 5 checks (signature, grant, scope, expiration, relationship). Read gate: 4 checks (grant, scope, date range, expiration). Both must produce audit events on denial. PRD reqs: ACLS-03, ACLS-04. |
| **ACL with grant/revoke lifecycle** | Access must be grantable and revocable. This is the minimum viable access control. Without it, access is all-or-nothing. | MEDIUM | Six roles with distinct permission boundaries. Grant create, modify, revoke operations. Expiration handling. PRD reqs: ACLS-01, ACLS-02, ACLS-05, ACLS-06. |
| **Hash-chained audit trail** | HIPAA requires audit logs recording who accessed what, when, and how, retained for six years minimum. Without an audit trail, the vault cannot demonstrate compliance or detect unauthorized access. | MEDIUM | Separate hash-chained JSONL from ledger. 38 event types. Must never block vault operations (audit failure must not prevent ledger writes). PRD reqs: AUDT-01 through AUDT-05. |
| **Vault directory structure + metadata** | The vault must have a well-defined, discoverable structure on disk. Without it, consumers cannot locate or validate the vault. | LOW | Seven subdirectories, vault.json with creation timestamp, schema version, vault UUID. PRD reqs: VALT-01, VALT-02, VALT-03. |
| **Amendment model (no deletion)** | Medical record amendment is a legal standard: originals are preserved, corrections are additive. Deletion breaks hash chains and legal defensibility. Without amendments, errors in clinical data have no correction path. | LOW | New entry of type `clinical_amendment` referencing original UUID. Original is never modified. PRD req: LDGR-05. |
| **Ledger integrity verification** | Useless to have hash chains if you never verify them. Integrity verification is the mechanism that detects tampering. | MEDIUM | Full chain walk: verify each hash links to previous entry, verify each signature, detect insertions/modifications/deletions. PRD req: LDGR-08. |
| **PatientChart class (create/open/close lifecycle)** | The vault needs a coherent programmatic interface. Without a lifecycle-managed class, consumers must manually orchestrate key derivation, ACL rebuild, file locking, and cleanup. | MEDIUM | `create()` initializes new vault. `open()` derives master key, loads key ring, rebuilds materialized ACL. `close()` flushes and clears sensitive material. PRD reqs: LAPI-01, LAPI-02. |

### Differentiators (Competitive Advantage)

These features elevate patient-chart from "encrypted file storage with access control" to a genuinely sovereign, operationally robust health record vault. They are not expected in a basic implementation but they are what make the vault trustworthy in real-world clinical scenarios.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Event-sourced ACL (grants as ledger entries)** | Complete, immutable history of who had access, when, and why. Most systems store ACLs in a mutable config file or database table -- the history of access changes is lost. Event sourcing means the ACL is auditable, replayable, and tamper-evident, same as clinical data. | MEDIUM | Grants stored as `access_grant_*` ledger entry types. Current ACL is a materialized view rebuilt by replaying grant entries. Invalidate and rebuild on new grant entries. PRD reqs: ACLS-01, ACLS-07, ACLS-08. |
| **Materialized ACL view with O(1) lookups** | Naive event-sourced ACL requires scanning all grant entries on every access check. Materialized view gives O(1) grant lookups while preserving event-sourced correctness. Performance-critical for any vault with multiple grants. | MEDIUM | Rebuilt from ledger entries on vault open. Invalidated on new grant entry. In-memory map of grantee ID to active grant. PRD req: ACLS-07. |
| **Break-glass emergency access** | The patient may be incapacitated. Without emergency access, the vault's data is unreachable when it matters most (emergency room, ICU). This is the feature that makes patient sovereignty practical rather than theoretical. | HIGH | Four auth methods (passphrase, multi-party quorum, hardware key, trusted Neuron). Patient-configured in advance. Time-limited sessions. Full audit logging. PRD reqs: EMRG-01 through EMRG-06. |
| **Time-limited emergency sessions with cooldown** | Prevents emergency access from becoming a permanent backdoor. The session expires automatically, and cooldown prevents rapid re-triggering (abuse mitigation). | MEDIUM | `max_session_seconds` enforces automatic expiration. `cooldown_seconds` prevents re-trigger. All lifecycle events logged. Depends on: break-glass protocol. PRD reqs: EMRG-03, EMRG-04. |
| **Event-driven sync engine** | Authorized recipients (providers, family, organizations) receive new entries automatically. Without sync, the vault is a write-only archive that requires manual export. Sync makes the vault an active participant in the care network. | HIGH | Every new ledger entry triggers sync check against active grants with `sync.enabled`. Scope-filtered per grant. Must handle multiple concurrent recipients. PRD reqs: SYNC-01, SYNC-06. |
| **Per-recipient encrypted sync delivery (X25519)** | Each recipient gets a payload encrypted specifically for them. The vault's master key is never shared. This is end-to-end encryption for sync -- even if the transport is compromised, only the intended recipient can decrypt. | HIGH | X25519 key agreement produces per-recipient ephemeral shared secret. Encrypt with that shared secret. Vault key never leaves the vault. PRD reqs: ENCR-03, SYNC-02. |
| **Sync retry queue with exponential backoff** | Network failures are inevitable. Without retry, sync is unreliable. Without backoff, failed retries create thundering herd. Without patient alerting, persistent failures go unnoticed. | MEDIUM | Base delay doubles per retry, capped at max_delay_ms. Alert after N consecutive failures. Queue persisted to disk. PRD reqs: SYNC-03, SYNC-05. |
| **Immediate sync stop on grant revocation** | When access is revoked, pending sync deliveries must be cancelled immediately. Without this, revocation has a delay window where data continues flowing to a now-unauthorized recipient. | LOW | Cancel all pending sync for revoked grant. Record `sync_stopped_revocation` audit event. Depends on: sync engine, ACL revocation. PRD req: SYNC-04. |
| **Encrypted incremental backup with watermarks** | Full backups are expensive for large vaults. Watermarks (hash of last backed-up entry) enable incremental backup -- only new entries since last backup. Encrypted archives mean backups are safe on untrusted storage (iCloud, Dropbox, USB drive). | MEDIUM | Watermark tracks last-backed-up position. Incremental includes only new entries. Archive encrypted by master key. Self-contained (includes key ring). PRD reqs: BKUP-01, BKUP-02, BKUP-03. |
| **Retention policy enforcement** | Without retention policy, backup destinations accumulate unbounded data. Patient-configurable max count and max age per destination keeps storage manageable. | LOW | Max backups, max age, cleanup logic. Per-destination configuration. PRD req: BKUP-04. |
| **Ledger query engine with entry index** | A raw hash-chained JSONL file requires full scan for any query. The index (entry_type, author, date) enables fast lookups. Without this, any vault with more than a few hundred entries becomes impractically slow to query. | MEDIUM | Index maps entry_type to entry IDs, author to entry IDs. Persisted to disk for fast startup. Rebuilt on demand for consistency. PRD reqs: LDGR-06, LDGR-07. |

### Anti-Features (Deliberately NOT Building)

These are features that seem reasonable on the surface but would undermine the vault's core value proposition, add attack surface, or violate architectural constraints. Documenting them prevents scope creep and clarifies the project's boundaries.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **HTTP API or network endpoint** | Seems natural for a data service. Enables remote access, browser-based UIs, mobile apps. | Creates a network attack surface on the patient's machine. Opens the vault to remote exploitation, credential theft, MITM attacks. Fundamentally undermines "local-first" and "patient owns it on their machine." | Programmatic TypeScript API consumed in-process. Consumers import `PatientChart` class directly. Zero network surface. |
| **External database (SQLite, PostgreSQL)** | Databases are the standard tool for structured data storage. Better query performance. SQL familiarity. | Adds a runtime dependency (violates zero-deps constraint). Introduces a second source of truth. Database corruption modes differ from file corruption. Complicates the "self-contained portable artifact" story. | Hash-chained JSONL files. The files ARE the database. Pattern proven in provider-core. Entry index provides query performance. |
| **Multi-patient support** | Caregiver managing elderly parent and child. Organization managing multiple patients. | Cross-contamination risk between patient records. Proxy consent and legal authority verification are complex. Multi-tenancy in an encrypted vault creates key management nightmares. | One vault per patient. Caregiver access modeled as access grants with appropriate roles (`family_read`, `legal_read`). Each vault is fully independent. |
| **Entry deletion** | GDPR right to erasure. Patient wants to remove embarrassing entries. Provider wants to retract an error. | Breaks the hash chain (every subsequent entry's prev_hash becomes invalid). Destroys legal defensibility. Undermines the immutability guarantee that is the vault's core value. Medical record standards require originals to be preserved. | Amendment model: new entry referencing original UUID. Original preserved. Amendment supersedes for display. |
| **Clinical interpretation** | "Smart vault" that flags drug interactions, suggests diagnoses, interprets lab results. | The vault stores data. It does not practice medicine. Clinical reasoning is the provider CareAgent's domain. Interpretation in the vault creates liability and couples storage to clinical logic. | Store faithfully. Let patient-core and provider-core handle clinical reasoning. |
| **Bulk export / full dump** | Data portability. Migration to another system. Research use. | Mass export creates exfiltration risk. Undermines access control model (scope, date range, entry type filters become meaningless). A single API call to dump the entire vault is a data breach waiting to happen. | Scoped access grants with defined entry types and date ranges. Export is always filtered through the read gate. |
| **Real-time streaming** | Live monitoring of patient vitals. Real-time collaboration between providers. | The vault is a ledger, not a streaming service. Real-time streaming requires persistent connections, back-pressure, and fundamentally different infrastructure. | Sync engine delivers new entries to authorized recipients. Event-driven, not real-time. Clinical collaboration happens through the CareAgent layer. |
| **Cloud-first storage** | Accessibility from anywhere. No risk of local hardware failure. | Patient loses sovereignty. Cloud provider can be subpoenaed, hacked, or go offline. "Your records are on someone else's computer" violates the core value proposition. | Local-first. Cloud is a backup destination (encrypted before leaving the device), not the primary store. |
| **User interface** | Users need to see their records. | The vault is infrastructure. UI is the concern of patient-core and third-party applications. Building UI into the vault couples presentation to storage. | Expose the local API (`PatientChart` class). Consumers build the UI. |
| **Automated backup scheduling** | Backups should happen regularly without user intervention. | Scheduling requires a long-running process or OS-level job (cron, launchd). The vault is a library, not a daemon. Scheduling is a consumer concern. | Provide `createBackup()` API. Let patient-core or the host application handle scheduling. |

## Feature Dependencies

```
[Vault Directory Structure + Metadata]
    |
    +--requires--> (nothing, foundation)
    |
[Hash-Chained Audit Trail]
    |
    +--requires--> [Vault Directory Structure]
    |
[AES-256-GCM Encryption]
    |
    +--requires--> [Vault Directory Structure] (for key storage)
    |
[Ed25519 Signatures]
    |
    +--requires--> (nothing, standalone crypto)
    |
[X25519 Key Agreement]
    |
    +--requires--> (nothing, standalone crypto)
    |
[scrypt Key Derivation]
    |
    +--requires--> (nothing, standalone crypto)
    |
[Key Ring with Rotation]
    |
    +--requires--> [AES-256-GCM Encryption] (master key encrypts key ring)
    +--requires--> [scrypt Key Derivation] (passphrase derives master key)
    |
[Hash-Chained Encrypted Signed Ledger]
    |
    +--requires--> [AES-256-GCM Encryption] (encrypt payloads)
    +--requires--> [Ed25519 Signatures] (sign entries)
    +--requires--> [Key Ring] (key IDs in payloads)
    +--requires--> [Hash-Chained Audit Trail] (log write events)
    |
[Amendment Model]
    |
    +--requires--> [Ledger] (amendments are ledger entries)
    |
[Ledger Query Engine + Index]
    |
    +--requires--> [Ledger] (queries over ledger entries)
    |
[Ledger Integrity Verification]
    |
    +--requires--> [Ledger] (verifies chain + signatures)
    |
[ACL as Ledger Entries (Event-Sourced)]
    |
    +--requires--> [Ledger] (grants are ledger entries)
    |
[Materialized ACL View]
    |
    +--requires--> [ACL as Ledger Entries] (rebuilt by replaying grants)
    +--requires--> [Ledger Query Engine] (filter grant entries)
    |
[Write Gate]
    |
    +--requires--> [Materialized ACL View] (O(1) grant lookup)
    +--requires--> [Ed25519 Signatures] (signature verification)
    |
[Read Gate]
    |
    +--requires--> [Materialized ACL View] (O(1) grant lookup)
    |
[PatientChart Class (create/open/close)]
    |
    +--requires--> [Ledger] (read/write entries)
    +--requires--> [Write Gate + Read Gate] (enforce access)
    +--requires--> [Key Ring] (key management on open)
    +--requires--> [Materialized ACL View] (rebuild on open)
    |
[Sync Engine]
    |
    +--requires--> [PatientChart Class] (triggers on entry write)
    +--requires--> [Materialized ACL View] (check sync-enabled grants)
    +--requires--> [X25519 Key Agreement] (per-recipient encryption)
    |
[Sync Retry Queue]
    |
    +--requires--> [Sync Engine]
    |
[Immediate Revocation Stop]
    |
    +--requires--> [Sync Engine]
    +--requires--> [ACL Revocation]
    |
[Break-Glass Emergency Access]
    |
    +--requires--> [PatientChart Class] (session management)
    +--requires--> [Read Gate] (scoped emergency reads)
    +--requires--> [Audit Trail] (log every emergency event)
    |
[Time-Limited Sessions + Cooldown]
    |
    +--requires--> [Break-Glass Emergency Access]
    |
[Encrypted Backup Archives]
    |
    +--requires--> [Ledger] (backup ledger entries)
    +--requires--> [Audit Trail] (backup audit entries)
    +--requires--> [Key Ring] (include in archive)
    +--requires--> [AES-256-GCM Encryption] (encrypt archive)
    |
[Incremental Backup with Watermarks]
    |
    +--requires--> [Encrypted Backup Archives]
    |
[Retention Policy Enforcement]
    |
    +--requires--> [Encrypted Backup Archives]
```

### Dependency Notes

- **Ledger requires Encryption + Signatures + Key Ring:** The ledger cannot be built before the crypto layer. Encryption, signing, and key management must exist first, because every ledger entry is encrypted, signed, and references a key ID.
- **ACL requires Ledger:** Grants are stored as ledger entries. The ledger must exist before access control can be implemented.
- **Gates require Materialized ACL:** The write gate and read gate need O(1) grant lookups. The materialized view must be built before gates can enforce access.
- **Sync requires PatientChart + ACL + X25519:** Sync is event-driven off entry writes, filtered by grants, and encrypted per-recipient. All three dependencies must exist.
- **Emergency Access requires PatientChart + Read Gate + Audit:** Emergency sessions are time-limited read sessions through the read gate, with full audit logging.
- **Backup requires Ledger + Audit + Key Ring + Encryption:** Backups archive ledger entries, audit entries, and the key ring, all encrypted by the master key.
- **Audit Trail is independent of Ledger:** The audit trail uses the same hash-chaining pattern but is a separate file. It can be built in Phase 1 before the ledger exists in Phase 3. The ledger then logs to the audit trail, not the other way around.

## MVP Definition

### Launch With (v1 Phases 1-4)

Minimum viable vault -- what's needed to validate that the immutable, encrypted, access-controlled ledger works correctly.

- [x] Vault directory structure and metadata -- foundation for everything else
- [x] Hash-chained audit trail -- HIPAA compliance, tamper detection
- [x] AES-256-GCM encryption/decryption -- payload confidentiality
- [x] Ed25519 signing/verification -- entry attribution and non-repudiation
- [x] scrypt key derivation -- passphrase to master key
- [x] Key ring with rotation -- key lifecycle management
- [x] Hash-chained, encrypted, signed ledger -- the core artifact
- [x] Amendment model -- clinical correction without deletion
- [x] Ledger query engine with index -- usable data retrieval
- [x] Ledger integrity verification -- tamper detection
- [x] ACL as ledger entries with six roles -- event-sourced access control
- [x] Write gate and read gate -- enforceable access boundaries
- [x] Materialized ACL view -- performant access checks

### Add After Validation (v1 Phases 5-6)

Features that require the core vault to be working and validated first.

- [ ] PatientChart class with full lifecycle -- when ledger + ACL + gates are proven
- [ ] Sync engine with encrypted delivery -- when access control is validated
- [ ] Sync retry queue -- when sync engine works for happy path
- [ ] Immediate revocation stop -- when sync + ACL revocation both work
- [ ] Break-glass emergency access -- when read gate and audit trail are proven
- [ ] Time-limited emergency sessions with cooldown -- when break-glass protocol works
- [ ] Encrypted backup archives -- when ledger and key ring are stable
- [ ] Incremental backup with watermarks -- when full backup works
- [ ] Retention policy enforcement -- when backup archives work

### Future Consideration (v2+)

Features deferred until v1 is validated and real-world usage patterns are understood.

- [ ] Merkle tree overlay for O(log n) integrity proofs -- v1 linear verification is sufficient for dev-phase vault sizes (LDGR-09)
- [ ] Ledger compaction and archival -- not needed until production scale (LDGR-10)
- [ ] Post-quantum key exchange (ML-KEM) -- standards still evolving (ENCR-07)
- [ ] HSM integration for key storage -- adds hardware dependency (ENCR-08)
- [ ] Per-data-category access control (mental health, substance use) -- requires clinical taxonomy (ACLS-09)
- [ ] Delegated grant administration -- requires proxy consent model (ACLS-10)
- [ ] Bidirectional sync -- v1 is outbound-only (SYNC-07)
- [ ] Conflict resolution for concurrent writes -- append-only avoids conflicts (SYNC-08)
- [ ] Automated backup scheduling -- consumer concern, not vault concern (BKUP-06)
- [ ] Backup verification and restore -- v1 creates but does not restore (BKUP-07)
- [ ] Emergency auth rate limiting -- v1 logs but does not rate limit (EMRG-07)
- [ ] Streaming read API -- performance optimization (LAPI-06)
- [ ] Vault schema migration tool -- not needed until schema changes (LAPI-07)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Phase |
|---------|------------|---------------------|----------|-------|
| Vault directory + metadata | HIGH | LOW | P1 | 1 |
| Hash-chained audit trail | HIGH | MEDIUM | P1 | 1 |
| AES-256-GCM encryption | HIGH | MEDIUM | P1 | 2 |
| Ed25519 signatures | HIGH | MEDIUM | P1 | 2 |
| scrypt key derivation | HIGH | LOW | P1 | 2 |
| Key ring with rotation | HIGH | MEDIUM | P1 | 2 |
| X25519 key agreement | MEDIUM | MEDIUM | P1 | 2 |
| Hash-chained encrypted signed ledger | HIGH | HIGH | P1 | 3 |
| Amendment model | HIGH | LOW | P1 | 3 |
| Ledger query engine + index | HIGH | MEDIUM | P1 | 3 |
| Ledger integrity verification | HIGH | MEDIUM | P1 | 3 |
| Event-sourced ACL (grants as entries) | HIGH | MEDIUM | P1 | 4 |
| Write gate (5 checks) | HIGH | HIGH | P1 | 4 |
| Read gate (4 checks) | HIGH | MEDIUM | P1 | 4 |
| Materialized ACL view | HIGH | MEDIUM | P1 | 4 |
| PatientChart class lifecycle | HIGH | MEDIUM | P1 | 5 |
| Sync engine + encrypted delivery | MEDIUM | HIGH | P2 | 5 |
| Sync retry queue | MEDIUM | MEDIUM | P2 | 5 |
| Immediate revocation stop | HIGH | LOW | P2 | 5 |
| Break-glass emergency access | HIGH | HIGH | P2 | 5 |
| Time-limited sessions + cooldown | MEDIUM | MEDIUM | P2 | 5 |
| Encrypted backup archives | MEDIUM | MEDIUM | P2 | 6 |
| Incremental backup + watermarks | MEDIUM | MEDIUM | P2 | 6 |
| Retention policy enforcement | LOW | LOW | P2 | 6 |

**Priority key:**
- P1: Must have for launch (Phases 1-4: vault is a credible encrypted ledger with access control)
- P2: Should have, add after core is validated (Phases 5-6: operational features that make the vault useful in practice)
- P3: Nice to have, future consideration (v2+: optimization and advanced features)

## Competitor Feature Analysis

| Feature | Blockchain PHR Systems (HealthChain, ACTION-EHR, MrC) | IPFS+Blockchain Hybrid (Hyperledger Healthchain) | Centralized EHR (Epic MyChart, Cerner) | patient-chart Approach |
|---------|-------------------------------------------------------|--------------------------------------------------|----------------------------------------|----------------------|
| Data sovereignty | Patient holds keys, data on-chain or IPFS | Patient holds keys, data on IPFS | Provider/vendor controls data | Patient holds keys, data on local filesystem. No cloud dependency. |
| Immutability | Blockchain consensus (expensive, slow) | Blockchain for hashes, IPFS for data | Audit trail only (data is mutable) | Hash-chained JSONL (lightweight, no consensus overhead). Same tamper-evidence, no blockchain complexity. |
| Encryption | Attribute-based encryption, on-chain key management | IPFS encryption + blockchain access records | TLS in transit, vendor-managed at rest | AES-256-GCM at rest, Ed25519 signatures, X25519 for sync. Patient controls all keys. |
| Access control | Smart contract-based ACL | Smart contract-based ACL | Role-based, vendor-managed | Event-sourced ACL as ledger entries. Patient-controlled grants with six roles. |
| Emergency access | Not typically implemented | Not typically implemented | Break-glass via EHR vendor | Patient-configured break-glass with four auth methods, time-limited sessions, cooldown. |
| Sync | Blockchain replication | IPFS distribution | HL7/FHIR integration | Event-driven encrypted delivery to specific recipients via X25519 key agreement. |
| Backup | Blockchain inherent (replicated) | IPFS inherent (distributed) | Vendor-managed | Patient-controlled encrypted archives with incremental watermarks. |
| Offline access | Requires blockchain node | Requires IPFS node | Requires network | Always available (local filesystem). Works fully offline. |
| Dependencies | Blockchain runtime, smart contract platform | IPFS daemon, blockchain node | Vendor platform, network | Zero runtime npm dependencies. Node.js built-ins only. |

### Key Differentiators vs. Existing Approaches

1. **No blockchain overhead.** Hash-chained JSONL provides the same tamper-evidence guarantees without consensus mechanisms, gas fees, smart contract complexity, or blockchain node requirements. The vault is a single patient's record -- it does not need distributed consensus because there is one authoritative copy.

2. **True local-first.** Unlike IPFS-based or blockchain-based systems that require network daemons, patient-chart works entirely offline on the patient's local filesystem. No network required for reads, writes, or integrity verification.

3. **Patient-configured emergency access.** Most blockchain PHR systems treat emergency access as an afterthought or omit it entirely. patient-chart makes it a first-class feature with four authentication methods and full audit trail.

4. **Event-sourced ACL.** Access control in blockchain systems is typically managed via smart contracts (mutable state on-chain). patient-chart stores all access grant events as immutable ledger entries, making the complete access history part of the tamper-evident record.

5. **Zero dependencies.** Blockchain and IPFS systems require substantial runtime infrastructure. patient-chart requires only Node.js >=22.12.0 and nothing else.

## Sources

- [Hyperledger Healthchain: Patient-Centric IPFS-Based Storage](https://www.mdpi.com/2079-9292/10/23/3003) -- IPFS+blockchain hybrid for health records
- [Blockchain Integration for Healthcare Records (HIPAA Vault)](https://www.hipaavault.com/resources/blockchain-integration-healthcare-records/) -- Blockchain HIPAA compliance strategies
- [Blockchain Personal Health Records: Systematic Review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8080150/) -- Comprehensive review of blockchain PHR systems
- [HealthChain Framework (JMIR)](https://www.jmir.org/2019/8/e13592/) -- Patient-centered blockchain health record exchange
- [ACTION-EHR (JMIR)](https://www.jmir.org/2020/8/e13598/) -- Blockchain-based patient-centric EHR management
- [Break Glass Procedure (Yale HIPAA)](https://hipaa.yale.edu/security/break-glass-procedure-granting-emergency-access-critical-ephi-systems) -- Emergency access implementation best practices
- [HIPAA Emergency Access Procedures](https://compliancy-group.com/emergency-access-procedures-under-the-hipaa-security-rule/) -- HIPAA break-glass requirements
- [HIPAA Audit Log Requirements](https://compliancy-group.com/hipaa-audit-log-requirements/) -- Audit trail compliance requirements
- [HIPAA Audit Logs 2025 (Kiteworks)](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/) -- Current audit log standards
- [CISA Encryption Key Management Best Practices](https://www.cisa.gov/sites/default/files/2023-02/08-19-2020_Operational-Best-Practices-for-Encryption-Key-Mgmt_508c.pdf) -- Key rotation and management guidance
- [Encryption Key Rotation Best Practices (Kiteworks)](https://www.kiteworks.com/regulatory-compliance/encryption-key-rotation-strategies/) -- Key rotation strategies
- [Trillian: Open-Source Append-Only Ledger](https://transparency.dev/) -- Reference implementation for tamper-evident logging
- [Tamper-Evident Audit Logs (Cossack Labs)](https://www.cossacklabs.com/blog/audit-logs-security/) -- Cryptographic audit log design
- [Efficient Data Structures for Tamper-Evident Logging (Crosby)](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf) -- Academic foundation for hash-chain and Merkle tree approaches
- [Encrypted Data Vaults Spec (Digital Bazaar)](https://digitalbazaar.github.io/encrypted-data-vaults/) -- W3C-adjacent encrypted data vault specification

---
*Feature research for: Encrypted, patient-controlled, append-only health record vault*
*Researched: 2026-02-21*
