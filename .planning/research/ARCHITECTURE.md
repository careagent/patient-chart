# Architecture Research

**Domain:** Encrypted append-only hash-chained local health record vault
**Researched:** 2026-02-21
**Confidence:** HIGH

Evidence base: provider-core's proven AuditWriter/pipeline pattern (reference implementation, fully built), the patient-chart PRD (complete TypeScript interfaces, vault directory layout, and phase plan), and established cryptographic engineering patterns for append-only ledgers using node:crypto primitives.

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Consumer Layer                                │
│  patient-core, third-party apps, emergency interfaces                 │
│  (import PatientChart class — no HTTP, no network)                    │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ programmatic API
┌───────────────────────────▼───────────────────────────────────────────┐
│                      PatientChart Facade                              │
│  create() / open() / close() lifecycle                                │
│  Orchestrates all subsystems, owns vault state                        │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┬────────────┘
   │          │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌────────┐ ┌───────┐ ┌──────┐ ┌─────────┐ ┌────────┐
│Ledger│ │ Access │ │ Sync  │ │Emerg.│ │ Backup  │ │ Audit  │
│      │ │Control │ │Engine │ │Access│ │         │ │        │
└──┬───┘ └───┬────┘ └───┬───┘ └──┬───┘ └────┬────┘ └───┬────┘
   │         │          │        │           │          │
   └─────────┴──────────┴────────┴───────────┴──────────┘
                            │
              ┌─────────────▼──────────────┐
              │       Encryption Layer      │
              │  AES-256-GCM  |  Ed25519    │
              │  X25519       |  scrypt     │
              │  Key Ring     |  SHA-256    │
              └─────────────┬──────────────┘
                            │
              ┌─────────────▼──────────────┐
              │     Storage Layer (FS)      │
              │  ledger/entries.jsonl       │
              │  audit/vault-audit.jsonl    │
              │  keys/keyring.json          │
              │  sync/queue.json            │
              │  vault.json                 │
              └────────────────────────────┘
```

### Architecture Summary

Seven components behind a single facade class (`PatientChart`), all sharing a common encryption layer and writing to flat files on the local filesystem. No database, no HTTP server, no runtime dependencies beyond Node.js built-ins. The encryption layer is foundational -- every other component depends on it for payload encryption, signing, or key agreement. The audit component is cross-cutting -- every other component logs to it but must never be blocked by it.

---

## Component Boundaries

| Component | Responsibility | Source Directory | Communicates With |
|-----------|---------------|------------------|-------------------|
| **Encryption** | AES-256-GCM encrypt/decrypt, Ed25519 sign/verify, X25519 key agreement, scrypt KDF, key ring lifecycle | `src/encryption/` | Every other component (foundational) |
| **Audit** | Hash-chained JSONL append-only audit log, chain verification, 38 event types | `src/audit/` | Every other component writes to it (cross-cutting) |
| **Ledger** | Hash-chained encrypted signed JSONL entries, read/write/amend/query, index management, integrity verification | `src/ledger/` | Encryption (encrypt/sign payloads), Audit (log operations) |
| **Access Control** | ACL as ledger entries, materialized ACL view, write gate, read gate, 6 roles, grant lifecycle | `src/access/` | Ledger (store/read grants as entries), Audit (log gate decisions) |
| **Sync Engine** | Event-driven propagation, X25519 encrypted delivery, retry queue, revocation stop | `src/sync/` | Access (check grants), Encryption (X25519 per-recipient), Ledger (read entries to sync), Audit |
| **Emergency Access** | Break-glass protocol, 4 auth methods, time-limited sessions, cooldown | `src/emergency/` | Access (temporary grant creation), Encryption (credential verification), Audit |
| **Backup** | Encrypted archives, incremental with watermarks, retention policy | `src/backup/` | Ledger (read entries for archive), Encryption (encrypt archive), Audit |
| **Types** | Public TypeScript interfaces, TypeBox schemas | `src/types/` | Consumed by all components (no outbound communication) |
| **PatientChart** | Facade class, vault lifecycle (create/open/close), method dispatch | `src/index.ts` | Orchestrates all components |

### Boundary Rules

1. **Encryption has no upward dependencies.** It provides primitives. It does not import from ledger, access, sync, or any other component.
2. **Audit has no upward dependencies.** It receives entries to append. It does not import from ledger, access, sync, or any other component. Following the provider-core pattern, audit write failures must never block vault operations.
3. **Ledger depends on encryption and audit.** It calls encryption to encrypt/decrypt payloads and sign/verify entries. It calls audit to log operations.
4. **Access depends on ledger and audit.** It reads/writes grant entries through the ledger. It does not call encryption directly -- the ledger handles encryption of grant entry payloads.
5. **Sync depends on access, encryption, ledger, and audit.** It checks the materialized ACL for sync targets, uses X25519 for per-recipient encryption, reads ledger entries to deliver, and logs all events.
6. **Emergency depends on access, encryption, and audit.** It creates temporary grants, verifies credentials, and logs all events.
7. **Backup depends on ledger, encryption, and audit.** It reads ledger entries and audit entries, encrypts the archive, and logs operations.
8. **PatientChart depends on everything.** It is the orchestrator.

---

## Data Flow

### Write Path (Plaintext to Disk)

```
Caller provides:  plaintext data + entry type + author identity
                          │
                          ▼
              ┌──────────────────────┐
              │   1. WRITE GATE      │  Access Control checks:
              │   (access/write-gate)│  - Author signature valid? (Ed25519 verify)
              │                      │  - Active provider_write grant exists?
              │                      │  - Entry type within grant scope?
              │                      │  - Grant not expired?
              │                      │  - Care relationship active?
              └──────────┬───────────┘
                         │ authorized
                         ▼
              ┌──────────────────────┐
              │   2. ENCRYPT         │  AES-256-GCM with active key from key ring
              │   (encryption/aes)   │  Produces: ciphertext + IV + auth_tag + key_id
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   3. SIGN            │  Ed25519 sign over canonical entry content
              │   (encryption/ed25519)│  (pre-encryption plaintext, not ciphertext)
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   4. CHAIN           │  SHA-256 hash of previous entry's JSON line
              │   (ledger/writer)    │  Genesis entry has prev_hash: null
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   5. APPEND          │  Serialize to JSON, append to entries.jsonl
              │   (ledger/writer)    │  Update entry index
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   6. AUDIT           │  Log entry_written event to vault-audit.jsonl
              │   (audit/writer)     │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   7. SYNC CHECK      │  For each active synced grant:
              │   (sync/engine)      │  - Entry within grant scope?
              │                      │  - If yes: encrypt for recipient (X25519)
              │                      │  - Queue for delivery
              └──────────────────────┘
```

**Critical ordering:** Signature is computed over the plaintext (step 3 happens before step 5). This means signature verification requires decryption first, which is by design -- you must possess the decryption key to verify authorship. The hash chain (step 4) is computed over the serialized JSON line including the encrypted payload, so chain verification does NOT require decryption.

### Read Path (Disk to Plaintext)

```
Caller requests:  entry by ID or query criteria + reader identity
                          │
                          ▼
              ┌──────────────────────┐
              │   1. READ GATE       │  Access Control checks:
              │   (access/read-gate) │  - Active grant exists for reader?
              │                      │  - Entry type within grant scope?
              │                      │  - Entry date within grant date range?
              │                      │  - Grant not expired?
              └──────────┬───────────┘
                         │ authorized
                         ▼
              ┌──────────────────────┐
              │   2. LOAD            │  Read JSON line from entries.jsonl
              │   (ledger/reader)    │  (use index for fast lookup)
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   3. VERIFY CHAIN    │  Check prev_hash matches SHA-256
              │   (ledger/integrity) │  of preceding entry's JSON line
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   4. DECRYPT         │  AES-256-GCM decrypt using key_id
              │   (encryption/aes)   │  from encrypted payload's key ring ref
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   5. VERIFY SIG      │  Ed25519 verify over decrypted plaintext
              │   (encryption/ed25519)│  using author's registered public key
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   6. AUDIT           │  Log entry_read event
              │   (audit/writer)     │
              └──────────────────────┘
                         │
                         ▼
                 Return plaintext entry to caller
```

**Note on chain verification during reads:** Full chain verification (walking the entire chain) is expensive and is a separate integrity check operation. Individual reads should verify the specific entry's chain link (its prev_hash against the preceding entry), not the entire chain. Full verification is done via `verifyLedgerIntegrity()`.

### ACL Materialization Flow

```
vault.open(passphrase)
        │
        ▼
┌───────────────────────────┐
│  Derive master key        │  scrypt(passphrase, salt)
│  Load key ring            │  Decrypt key ring with master key
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Scan ledger entries      │  Filter for entry_type in:
│  (using unencrypted       │  access_grant_created,
│   metadata.entry_type)    │  access_grant_modified,
│                           │  access_grant_revoked,
│                           │  access_grant_expired
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Replay grant events      │  In chronological order:
│  in order                 │  - created: add grant to map
│                           │  - modified: update grant in map
│                           │  - revoked: remove from map
│                           │  - expired: remove from map
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Materialized ACL View    │  Map<grantId, ActiveGrant>
│  (in-memory)              │  Provides O(1) lookups by:
│                           │  - grantee ID
│                           │  - role
│                           │  - grant ID
└───────────────────────────┘
```

**Invalidation rule:** When any new `access_grant_*` entry is written to the ledger, the materialized view is invalidated and incrementally updated (apply just the new event) rather than fully rebuilt. Full rebuild happens only on `open()`.

### Sync Delivery Flow

```
New ledger entry written
        │
        ▼
┌───────────────────────────┐
│  Query materialized ACL   │  Find all grants where:
│  for sync targets         │  - sync.enabled === true
│                           │  - entry falls within grant scope
└───────────┬───────────────┘
            │
            ▼ (for each matching grant)
┌───────────────────────────┐
│  X25519 key agreement     │  Derive shared secret from:
│                           │  - Vault's ephemeral X25519 key pair
│                           │  - Recipient's X25519 public key
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Encrypt for recipient    │  AES-256-GCM with derived shared key
│                           │  (not the vault's ledger key)
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Enqueue delivery         │  Add to sync/queue.json
│                           │  with retry policy from grant
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│  Attempt delivery         │  Transport-agnostic (contract TBD)
│  to endpoint              │  Record sync_delivered or sync_failed
└───────────┬───────────────┘
            │ failure
            ▼
┌───────────────────────────┐
│  Retry with exponential   │  base_delay_ms * 2^attempt
│  backoff                  │  capped at max_delay_ms
│                           │  alert after alert_after_failures
└───────────────────────────┘
```

---

## Component Dependency Graph

```
                    ┌──────────┐
                    │  Types   │  (no runtime deps, consumed by all)
                    └──────────┘

                    ┌──────────┐
                    │  Audit   │  (depends on: nothing)
                    └──────────┘

                    ┌────────────┐
                    │ Encryption │  (depends on: nothing)
                    └────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐          ┌──────────┐
        │  Ledger  │          │  Backup  │
        │          │◄─────────│          │
        └──────────┘          └──────────┘
              │
              ▼
        ┌──────────┐
        │  Access  │
        │ Control  │
        └──────────┘
          │       │
     ┌────┘       └────┐
     ▼                 ▼
┌──────────┐    ┌───────────┐
│   Sync   │    │ Emergency │
│  Engine  │    │  Access   │
└──────────┘    └───────────┘
```

Arrows indicate "depends on" (points toward the dependency). Audit is omitted from arrows because every component writes to it, but never reads from it. Types is omitted because every component imports from it.

### Build Order (Strict Dependencies)

This is the order in which components can be built, based on what must exist before something else can function:

| Build Order | Component | Why This Position | Can Start After |
|-------------|-----------|-------------------|-----------------|
| **1** | Types | Pure interfaces, no implementation deps | Nothing |
| **2** | Audit | Hash-chained JSONL writer, no deps on other components. Mirrors provider-core AuditWriter exactly. | Types |
| **3** | Encryption | Crypto primitives (AES, Ed25519, X25519, scrypt, key ring). No deps on ledger or audit. | Types |
| **4** | Ledger | Needs encryption for payloads and signatures. Needs audit for logging. | Encryption + Audit |
| **5** | Access Control | Needs ledger for storing/reading grants. Materializes ACL from ledger entries. | Ledger |
| **6a** | Sync Engine | Needs access (grant queries), encryption (X25519), ledger (entry reads). | Access + Encryption |
| **6b** | Emergency Access | Needs access (temporary grants), encryption (credential verification). | Access + Encryption |
| **6c** | Backup | Needs ledger (entry reads), encryption (archive encryption). | Ledger + Encryption |
| **7** | PatientChart Facade | Orchestrates all components. Must wait for all subsystems. | Everything |

**Note:** Steps 2 and 3 (Audit and Encryption) can be built in parallel -- they have no mutual dependency. Steps 6a, 6b, and 6c (Sync, Emergency, Backup) can be built in parallel -- they depend on earlier layers but not on each other.

### Mapping to PRD Phases

The PRD's 8-phase roadmap aligns with this dependency graph:

| PRD Phase | Components Built | Dependency Satisfied |
|-----------|-----------------|---------------------|
| Phase 1: Vault Foundation | Types (partial), Audit | Standalone -- audit has no deps |
| Phase 2: Encryption | Encryption, Key Ring | Standalone -- encryption has no deps |
| Phase 3: Immutable Ledger | Ledger | Requires Phase 1 (audit) + Phase 2 (encryption) |
| Phase 4: Access Control | Access (ACL, gates) | Requires Phase 3 (ledger for grant storage) |
| Phase 5: API + Sync + Emergency | PatientChart, Sync, Emergency | Requires Phase 4 (access for grant queries) |
| Phase 6: Backup | Backup | Requires Phase 3 (ledger) + Phase 2 (encryption) |
| Phase 7: Integration Testing | Cross-component E2E | Requires Phases 1-6 |
| Phase 8: Documentation | None (docs only) | Requires Phase 7 |

**Observation:** Backup (Phase 6) could theoretically be built after Phase 3 since it depends on ledger + encryption, not on access control. The PRD places it after Phase 5 likely because the PatientChart facade (Phase 5) exposes the backup methods, and integration is simpler when the facade exists. This ordering is correct for practical purposes even if the strict dependency would allow earlier construction.

---

## Recommended Project Structure

```
src/
├── index.ts               # PatientChart class — sole public entry point
├── types/                 # Public TypeScript interfaces and TypeBox schemas
│   ├── index.ts           # Re-exports all public types
│   ├── ledger.ts          # LedgerEntry, LedgerEntryType, EntryAuthor, EntryMetadata
│   ├── access.ts          # AccessGrant, AccessRole, GranteeIdentity, AccessScope, TimeLimits
│   ├── sync.ts            # SyncConfig, SyncEndpoint, RetryPolicy
│   ├── emergency.ts       # EmergencyConfig, EmergencyParty, EmergencyAuthMethod
│   ├── encryption.ts      # EncryptedPayload, KeyRing, KeyRecord
│   └── audit.ts           # VaultAuditEntry, VaultEventType, AuditActor
├── encryption/            # Cryptographic primitives — ZERO upward deps
│   ├── aes.ts             # AES-256-GCM encrypt/decrypt
│   ├── ed25519.ts         # Ed25519 key generation, sign, verify
│   ├── x25519.ts          # X25519 key pair generation, key agreement
│   ├── kdf.ts             # scrypt key derivation from passphrase
│   └── keyring.ts         # Key ring create, load, store, rotate
├── audit/                 # Vault-level audit trail — ZERO upward deps
│   ├── writer.ts          # Hash-chained JSONL audit writer (mirrors provider-core)
│   └── integrity.ts       # Audit chain verification
├── ledger/                # Append-only immutable ledger — depends on encryption, audit
│   ├── writer.ts          # Encrypt → sign → chain → append pipeline
│   ├── reader.ts          # Load → verify → decrypt → verify sig pipeline
│   ├── query.ts           # Query engine (filter by type, author, date, amends)
│   ├── index-manager.ts   # Entry index for O(1) lookups by type/author
│   └── integrity.ts       # Full hash chain + signature verification
├── access/                # Access control — depends on ledger, audit
│   ├── acl.ts             # Materialized ACL view (event-sourced from ledger)
│   ├── write-gate.ts      # 5-check write authorization
│   └── read-gate.ts       # 4-check read authorization
├── sync/                  # Sync engine — depends on access, encryption, ledger, audit
│   ├── engine.ts          # Event-driven sync on new entries
│   ├── delivery.ts        # X25519 encrypted payload delivery
│   ├── queue.ts           # Retry queue with exponential backoff
│   └── revocation.ts      # Immediate sync stop on grant revocation
├── emergency/             # Break-glass access — depends on access, encryption, audit
│   ├── protocol.ts        # Break-glass trigger and 4 authentication methods
│   ├── session.ts         # Time-limited emergency session management
│   └── cooldown.ts        # Post-session cooldown enforcement
└── backup/                # Backup management — depends on ledger, encryption, audit
    ├── archive.ts         # Encrypted backup archive creation
    ├── incremental.ts     # Incremental backup with watermarks
    └── retention.ts       # Retention policy enforcement
```

### Structure Rationale

- **`types/`** is a leaf dependency. Every other module imports from it; it imports from nothing. This prevents circular dependencies and allows consumers to import types without pulling implementation code (via the `./types` package export).
- **`encryption/`** and **`audit/`** are foundational layers with zero upward imports. They can be tested in complete isolation. Encryption provides pure functions; audit provides the append-only writer.
- **`ledger/`** is the first component that composes lower layers. It calls encryption for payloads and audit for logging. The writer/reader split mirrors the write path/read path separation.
- **`access/`** sits above ledger because grants are stored as ledger entries. The materialized ACL view is a projection -- classic event sourcing.
- **`sync/`**, **`emergency/`**, and **`backup/`** are leaf consumers. They depend on lower layers but nothing depends on them (except the PatientChart facade).

---

## Architectural Patterns

### Pattern 1: Hash-Chained Append-Only JSONL

**What:** Each entry in a JSONL file includes a `prev_hash` field containing the SHA-256 hash of the previous line's serialized JSON. The first entry (genesis) has `prev_hash: null`. Any insertion, modification, deletion, or reordering of entries breaks the chain and is detectable by verification.

**When to use:** Both the ledger (`entries.jsonl`) and the audit trail (`vault-audit.jsonl`) use this pattern. It is proven in provider-core's AuditWriter.

**Trade-offs:**
- Pro: Tamper-evident without external infrastructure. Simple to implement. Portable (plain files).
- Pro: Append-only writes are fast and safe against partial writes (worst case: truncated last line).
- Con: Full chain verification is O(n) -- must read every entry. Acceptable for local vault sizes; the PRD defers Merkle tree overlay for O(log n) proofs to v2.
- Con: No random-access updates. By design -- this is a feature, not a limitation.

**Reference implementation (provider-core):**
```typescript
// From provider-core/src/audit/writer.ts -- this exact pattern transfers to patient-chart
append(entry: Omit<AuditEntry, 'prev_hash'>): void {
  const enriched: AuditEntry = { ...entry, prev_hash: this.lastHash };
  const line = JSON.stringify(enriched);
  const currentHash = createHash('sha256').update(line).digest('hex');
  appendFileSync(this.logPath, line + '\n', { flag: 'a' });
  this.lastHash = currentHash;
}
```

Patient-chart's ledger writer extends this pattern by adding encryption and signing before the append step.

### Pattern 2: Materialized ACL View (Event Sourcing)

**What:** Access grants are stored as immutable ledger entries (`access_grant_created`, `access_grant_modified`, `access_grant_revoked`, `access_grant_expired`). The current ACL state is a materialized view built by replaying these events in chronological order. The ledger is the single source of truth; the in-memory view is a derived projection.

**When to use:** Every write gate check and read gate check queries this materialized view for O(1) grant lookups instead of scanning the ledger.

**Trade-offs:**
- Pro: Complete access history is in the immutable record. No separate ACL database to get out of sync.
- Pro: O(1) lookups after rebuild. Rebuild is O(g) where g = number of grant events, not n = total entries.
- Con: Rebuild required on every `open()`. For vaults with thousands of grant events, this adds startup latency. Acceptable in v1.

**Implementation approach:**
```typescript
// Pseudocode for ACL materialization
class MaterializedACL {
  private grants = new Map<string, ActiveGrant>();
  private byGrantee = new Map<string, Set<string>>(); // grantee ID -> grant IDs

  rebuild(grantEntries: LedgerEntry[]): void {
    this.grants.clear();
    this.byGrantee.clear();
    for (const entry of grantEntries) {
      this.applyEvent(entry);
    }
  }

  applyEvent(entry: LedgerEntry): void {
    switch (entry.entry_type) {
      case 'access_grant_created':
        // decrypt payload, add to grants map and byGrantee index
        break;
      case 'access_grant_modified':
        // decrypt payload, update existing grant in map
        break;
      case 'access_grant_revoked':
      case 'access_grant_expired':
        // remove from grants map and byGrantee index
        break;
    }
  }

  hasActiveGrant(granteeId: string, role: AccessRole): boolean {
    // O(1) lookup via byGrantee index
  }
}
```

### Pattern 3: Layered Encryption with Key Ring

**What:** A key hierarchy where a patient passphrase derives a master key (via scrypt), which encrypts the key ring. The key ring contains one active ledger encryption key and zero or more rotated keys. Each ledger entry references a `key_id` so the correct key can be retrieved for decryption, even after rotation.

**When to use:** All ledger entry payloads. The key ring is loaded into memory during `open()` and cleared during `close()`.

**Trade-offs:**
- Pro: Key rotation does not require re-encrypting historical entries. Old keys are retained in the ring.
- Pro: Master key never touches disk in plaintext -- derived from passphrase on demand.
- Con: Passphrase loss means permanent data loss (no recovery without passphrase). This is by design for sovereignty.
- Con: scrypt derivation is intentionally slow (~100ms-1s) to resist brute force. Acceptable at `open()` time.

**Key ring lifecycle:**
```
1. CREATE (vault init):
   passphrase → scrypt → master_key
   generate ledger_key_0 (AES-256)
   encrypt ledger_key_0 with master_key → store in keyring.json
   generate Ed25519 identity key pair
   encrypt private key with master_key → store in keyring.json

2. USE (vault open):
   passphrase → scrypt → master_key
   decrypt keyring.json with master_key → active key + all rotated keys in memory

3. ROTATE (explicit action):
   generate ledger_key_N (AES-256)
   encrypt ledger_key_N with master_key
   mark ledger_key_(N-1) as rotated (set rotated_at timestamp)
   store updated keyring.json
   write key_rotation ledger entry

4. RETAIN:
   all rotated keys stay in the key ring forever
   entries encrypted with key_0 can always be decrypted
   key_id on each entry references the correct key
```

### Pattern 4: Gate Pattern for Access Enforcement

**What:** Every read and write operation passes through a "gate" -- a synchronous authorization check that either permits the operation or denies it with a specific reason. The gate consults the materialized ACL view and produces an audit event regardless of outcome.

**When to use:** Every `writeEntry()`, `amendEntry()`, `readEntry()`, and `queryEntries()` call. The gate is not optional and cannot be bypassed through the public API.

**Trade-offs:**
- Pro: Single enforcement point. Access logic is not scattered across multiple call sites.
- Pro: Every denial is audited with the specific reason (no_grant, expired, scope_violation, invalid_signature).
- Con: Gate checks add latency to every operation. Mitigated by O(1) materialized ACL lookups.

**Write gate checks (in order):**
1. Author signature valid? (Ed25519 verify against registered public key)
2. Active `provider_write` grant exists? (or author is patient's agent / system)
3. Entry type within grant scope?
4. Grant not expired?
5. Active care relationship? (not terminated or suspended)

**Read gate checks (in order):**
1. Active grant exists for reader?
2. Requested entry types within grant scope?
3. Entry dates within grant date range (if date-filtered)?
4. Grant not expired?

### Pattern 5: Non-Blocking Audit

**What:** Audit logging must never block or fail vault operations. If the audit write fails (disk full, permission error), the primary operation (ledger write, read, etc.) still succeeds. The audit failure itself should be surfaced through an error callback or event, not by throwing.

**When to use:** Every audit write call throughout the system.

**Reference:** This is established in provider-core (AUDT-05 in the PRD). The patient-chart PRD carries the same requirement.

**Implementation approach:** Wrap audit writes in try/catch at the call site. Use an error callback or event emitter for audit failures, not exceptions.

---

## Anti-Patterns

### Anti-Pattern 1: Encrypting the Hash Chain Input

**What people do:** Hash the encrypted ciphertext for chain linking, then later change encryption (key rotation) and expect chain verification to still work.
**Why it's wrong:** The hash chain must be stable. If you hash the ciphertext and then re-encrypt with a new key, the chain breaks.
**Do this instead:** The PRD's design is correct: hash the entire serialized JSON line (which includes the encrypted payload). Since entries are never re-encrypted (old keys are retained), the chain remains stable. The key insight: chain verification never requires decryption.

### Anti-Pattern 2: Storing ACL State Separately from the Ledger

**What people do:** Put access grants in a separate config file or database, separate from the clinical record.
**Why it's wrong:** The ACL and the clinical record can drift. There is no immutable history of who had access when. Auditors cannot reconstruct access state at a point in time.
**Do this instead:** Grants are ledger entries. The complete access history is in the same immutable chain as the clinical data. The materialized view is a performance optimization, not the source of truth.

### Anti-Pattern 3: Sharing the Vault Encryption Key for Sync

**What people do:** Send entries encrypted with the vault's own key to sync recipients, requiring them to have the vault key.
**Why it's wrong:** Sharing the vault key means recipients can decrypt the entire vault, not just their scoped entries. Key revocation becomes impossible.
**Do this instead:** Use per-recipient X25519 key agreement to derive a unique shared key for each sync delivery. The vault's encryption key never leaves the vault.

### Anti-Pattern 4: Blocking on Audit Writes

**What people do:** Treat audit logging as a synchronous prerequisite for completing the primary operation.
**Why it's wrong:** If audit write fails (disk full, I/O error), the primary operation (clinical entry write) also fails. Audit failure should not block clinical data entry.
**Do this instead:** Audit writes are best-effort. Log to a secondary channel (stderr, event emitter) if audit itself fails. The primary operation must complete.

### Anti-Pattern 5: Rebuilding the Full ACL on Every Grant Event

**What people do:** Call `rebuild()` (replay all grant events) every time a single new grant event is written.
**Why it's wrong:** Rebuild is O(g) where g = total grant events. For frequent grant operations, this becomes expensive.
**Do this instead:** Incremental update: apply only the new event to the existing materialized view. Full rebuild only on `open()`.

---

## Vault Directory Layout and File Semantics

```
~/.careagent/vault/
├── vault.json                 # Vault metadata: creation timestamp, schema version, vault UUID
│                              # Written once at create(). Read at open(). Never modified.
│
├── ledger/
│   ├── entries.jsonl          # The immutable record. One JSON line per entry.
│   │                          # Append-only. Never modified. Never truncated.
│   └── index.json             # Derived index for fast lookups.
│                              # Can be rebuilt from entries.jsonl at any time.
│                              # Persisted for fast startup; rebuilt if corrupted.
│
├── audit/
│   └── vault-audit.jsonl      # Hash-chained audit trail. Same pattern as entries.jsonl
│                              # but for vault operations, not clinical data.
│                              # Independent hash chain from the ledger.
│
├── keys/
│   └── keyring.json           # All encryption keys, encrypted by master key.
│                              # Updated on key rotation. Contains full key history.
│
├── sync/
│   ├── queue.json             # Pending sync deliveries and retry state.
│   │                          # Mutable. Updated on sync attempt/retry/completion.
│   └── watermarks.json        # Per-grant sync watermarks (last synced entry hash).
│                              # Mutable. Updated after successful delivery.
│
├── backup/
│   └── state.json             # Backup watermarks and retention state.
│                              # Mutable. Updated after backup operations.
│
└── emergency/
    └── config.json            # Emergency access configuration, encrypted.
                               # Updated when patient changes emergency config.
```

**Immutable files:** `vault.json`, `entries.jsonl`, `vault-audit.jsonl` (append-only counts as immutable for integrity purposes)
**Mutable files:** `index.json`, `keyring.json`, `queue.json`, `watermarks.json`, `state.json`, `config.json`
**Rebuildable files:** `index.json` (from `entries.jsonl`), materialized ACL view (from grant entries in `entries.jsonl`)

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-10K entries | No adjustments needed. Full chain verification under 1 second. Index fits in memory. |
| 10K-100K entries | Full chain verification takes seconds. Index file grows but still manageable. Consider lazy-loading index. |
| 100K+ entries | Full chain verification becomes slow (v2 Merkle tree overlay addresses this). Consider splitting ledger into date-partitioned files. Index needs secondary structure. |

### Scaling Priorities

1. **First bottleneck: Full chain verification at scale.** The O(n) linear scan becomes the bottleneck above ~100K entries. The PRD correctly defers Merkle tree overlay (LDGR-09) to v2 as O(log n) proof optimization.
2. **Second bottleneck: Vault open time.** ACL materialization + index loading + key ring decryption all happen at `open()`. For large vaults, consider lazy materialization or incremental loading.
3. **Third bottleneck: JSONL file size.** A single `entries.jsonl` file grows indefinitely. v2 should consider date-based partitioning (`entries-2026-01.jsonl`) with a manifest file.

---

## Integration Points

### External Boundaries (Package Consumers)

| Consumer | Integration Pattern | Notes |
|----------|---------------------|-------|
| `@careagent/patient-core` | Import `PatientChart` class, call methods in-process | Primary consumer. Initializes vault during patient onboarding. |
| Third-party apps | Import `PatientChart` class via `@careagent/patient-chart` package | Must have `application_read` grant. Same in-process API. |
| Emergency interfaces | Import `PatientChart`, call `triggerEmergencyAccess()` | Break-glass protocol. Time-limited session. |

### Internal Boundaries (Module Communication)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| PatientChart -> all subsystems | Direct method calls | Facade pattern. No events, no message bus. |
| Ledger -> Encryption | Function calls (encrypt, decrypt, sign, verify) | Encryption functions are pure -- no state except key material passed as arguments. |
| Ledger -> Audit | Append method call | Fire-and-forget. Audit failures do not propagate. |
| Access -> Ledger | Read/write method calls | Grants are stored as regular ledger entries. |
| Sync -> Access | Query method calls | Check materialized ACL for sync targets and scope. |
| Sync -> Encryption | Function calls (X25519 key agreement, AES encrypt) | Per-recipient encryption. Different keys from ledger encryption. |

### Open Integration Questions (from PRD)

These are unresolved architectural decisions that affect integration:

1. **Sync transport contract:** The sync engine encrypts and queues entries but the actual transport mechanism (HTTP POST, file copy, Neuron relay) is undefined. The sync engine should define a `SyncTransport` interface that consumers implement.
2. **Concurrent access:** Multiple processes opening the vault simultaneously need a serialization mechanism. File-level locking or a single-writer constraint should be decided before Phase 5.
3. **Provider write locality:** Whether providers write locally (requiring agent presence) or remotely (requiring a write protocol) affects the write gate's signature verification flow.

---

## Sources

- `provider-core/src/audit/writer.ts` -- Reference implementation of hash-chained JSONL (HIGH confidence, reviewed source code)
- `provider-core/src/audit/entry-schema.ts` -- Reference TypeBox schema pattern (HIGH confidence, reviewed source code)
- `provider-core/src/audit/pipeline.ts` -- Reference pipeline pattern wrapping AuditWriter (HIGH confidence, reviewed source code)
- `patient-chart-PRD.md` -- Complete interfaces, vault layout, phase plan (HIGH confidence, authoritative project document)
- `.planning/PROJECT.md` -- Project constraints and context (HIGH confidence, authoritative project document)
- Node.js `node:crypto` documentation -- AES-256-GCM, Ed25519, X25519, scrypt availability (HIGH confidence, platform capability)

---
*Architecture research for: encrypted append-only hash-chained health record vault*
*Researched: 2026-02-21*
