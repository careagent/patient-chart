# @careagent/patient-chart — Product Requirements Document

**Version:** 0.1.0 (Initial Draft)
**Date:** 2026-02-21
**Author:** Thomas / CareAgent Team
**Status:** Draft — Pending Review

---

## Guiding Principle: Structural Sovereignty

> *The record outlives everything. It outlives the CareAgent. It outlives the provider. It outlives the organization. It outlives every piece of software that ever touched it. The patient's health record is not a feature of any system — it is a permanent, self-contained artifact that the patient owns absolutely.*

Where provider-core says "risk stays with the provider," patient-core says "control stays with the patient," and Axon says "the channel belongs to everyone" — patient-chart says "the record belongs to the patient, unconditionally." The vault is not a database. It is not a service. It is an encrypted, append-only, hash-chained ledger that exists on the patient's own machine and is readable by the patient even if every other piece of the CareAgent ecosystem disappears.

---

## 1. Product Overview

### 1.1 What patient-chart Is

`@careagent/patient-chart` is a pnpm TypeScript package that provides the patient's sovereign, encrypted, append-only health record vault. It is the permanent record of truth at the foundation of the CareAgent ecosystem — not a feature of the CareAgent, not a component of OpenClaw, but an independent artifact that the patient owns and controls absolutely.

The vault:

- Maintains the patient's complete longitudinal health record as an immutable, hash-chained, encrypted ledger
- Enforces write access — only credentialed provider CareAgents with established, consented relationships can write clinical entries
- Enforces read access — governed by the patient's access control list, stored as ledger entries
- Drives the authorized access sync engine — propagating new entries to authorized recipients automatically
- Manages the break-glass emergency access protocol configured by the patient
- Logs every access event, write event, sync event, and blocked action in an immutable audit trail

### 1.2 What patient-chart Is Not

patient-chart is not an application. It has no CLI, no HTTP endpoints, and no user interface. It is a programmatic library consumed by:

- `@careagent/patient-core` — the primary interface (patient's CareAgent)
- Authorized third-party patient-facing applications — through the local API
- Emergency access interfaces — through the break-glass protocol

The vault is initialized during patient onboarding via patient-core and persists independently. If patient-core needs to be updated, reinstalled, or replaced, the patient's complete clinical record is untouched.

### 1.3 Relationship to the Ecosystem

```
Patient OpenClaw Gateway (local machine)
        │
        └── Patient Care Agent   ← @careagent/patient-core
                │
                ├── CANS.md (activation kernel — references vault location)
                ├── AUDIT.log (entries also written to vault)
                │
                ▼
        @careagent/patient-chart (vault)
                │
                ├── Credentialed write access  ← provider CareAgents via cross-installation protocol
                ├── Authorized read access     ← family, POA, legal, organizations
                ├── Sync engine                → authorized recipients
                ├── Local API                  ← third-party applications
                └── Emergency access           ← break-glass protocol
```

| Repository | Relationship | Status |
|-----------|-------------|--------|
| `@careagent/provider-core` | Provider CareAgents write to the vault via credentialed access. Audit pipeline pattern (hash-chained JSONL) is the reference implementation for patient-chart's ledger. | Fully built (v1 phases 1-5 complete) |
| `@careagent/patient-core` | Primary interface to the vault. Initializes vault during onboarding. Reads from and writes to the vault through the local API. | PRD complete, not yet built |
| `@careagent/axon` | Provides the discovery and trust layer that enables provider credential verification. Not involved after relationship establishment. | PRD complete, not yet built |
| `@careagent/neuron` | Organization-level node. Optional authorized sync endpoint for backup or access grant recipients. | README only, not yet built |

---

## 2. Core Concept: Immutability

The Patient Chart is an append-only, immutable ledger. Clinical data can be added and amended, but it cannot be deleted or altered. Every entry is:

- **Timestamped** at the moment of writing (ISO 8601, UTC)
- **Cryptographically signed** by the writing agent's Ed25519 identity key
- **Encrypted** with AES-256-GCM before being written to disk
- **Hash-chained** to the previous entry (SHA-256), forming a tamper-evident chain from genesis
- **Permanently retained** regardless of relationship status, access revocation, or any other event

Neither the provider nor the patient can alter the narrative after the fact. Amendments are new entries that reference the original — the original is never modified. The record is tamper-proof and legally defensible.

### 2.1 Amendment Model

When clinical information needs correction or update:

1. A new entry of type `clinical_amendment` is appended to the ledger
2. The amendment entry references the original entry's UUID
3. The original entry remains in the chain, unmodified
4. The amendment includes the corrected data and the reason for amendment
5. Consumers reading the ledger see both entries; the amendment supersedes the original for display purposes but does not erase it

This mirrors the medical record amendment standard: the original documentation is preserved, and amendments are additive.

---

## 3. Ledger Data Model

### 3.1 LedgerEntry

The fundamental unit of the Patient Chart. Every piece of data in the vault — clinical entries, access grants, audit events, sync records — is a `LedgerEntry`.

```typescript
interface LedgerEntry {
  /** UUID v4 — globally unique identifier for this entry */
  id: string;

  /** ISO 8601 UTC timestamp — moment this entry was written */
  timestamp: string;

  /** The type of ledger entry (see LedgerEntryType) */
  entry_type: LedgerEntryType;

  /** Who wrote this entry */
  author: EntryAuthor;

  /** SHA-256 hash of the previous entry's serialized JSON, or null for genesis */
  prev_hash: string | null;

  /** Ed25519 signature over the canonical entry content (pre-encryption) */
  signature: string;

  /** The encrypted payload — clinical data, access grant, audit event, etc. */
  encrypted_payload: EncryptedPayload;

  /** Unencrypted metadata for indexing and chain management */
  metadata: EntryMetadata;
}
```

### 3.2 LedgerEntryType

A controlled vocabulary of all entry types, organized by category:

```typescript
type LedgerEntryType =
  // Clinical entries — written by credentialed provider CareAgents
  | 'clinical_encounter'         // Full encounter documentation
  | 'clinical_medication'        // Medication prescription or change
  | 'clinical_allergy'           // Allergy documentation
  | 'clinical_diagnosis'         // Diagnosis entry
  | 'clinical_problem_list'      // Problem list update
  | 'clinical_lab_result'        // Laboratory result
  | 'clinical_imaging_result'    // Imaging result
  | 'clinical_pathology'         // Pathology report
  | 'clinical_procedure'         // Surgical or procedural documentation
  | 'clinical_amendment'         // Amendment to a prior clinical entry

  // Care network entries — relationship management
  | 'care_relationship_established'  // Provider relationship consented and established
  | 'care_relationship_terminated'   // Provider relationship terminated by patient
  | 'care_relationship_suspended'    // Provider relationship temporarily suspended

  // Access control entries — ACL management
  | 'access_grant_created'       // New access grant issued
  | 'access_grant_modified'      // Existing grant scope or time changed
  | 'access_grant_revoked'       // Access grant revoked
  | 'access_grant_expired'       // System-recorded expiration event

  // Emergency access entries
  | 'emergency_config_set'       // Emergency access configuration created or updated
  | 'emergency_access_triggered' // Break-glass access event initiated
  | 'emergency_access_ended'     // Emergency access session ended

  // Patient-authored entries
  | 'patient_note'               // Free-text patient note
  | 'patient_directive'          // Advance directive, living will, etc.
  | 'patient_preference'         // Care preference or goal

  // System entries
  | 'vault_initialized'          // Genesis entry — vault creation
  | 'key_rotation'               // Encryption key rotated
  | 'sync_record'                // Record of a sync event to an access grant recipient
  | 'backup_record';             // Record of a backup event
```

### 3.3 EntryAuthor

Identifies who wrote the entry. The author's identity is verifiable via Ed25519 signature.

```typescript
interface EntryAuthor {
  /** Type of author */
  type: 'patient_agent' | 'provider_agent' | 'system';

  /** Unique identifier — patient agent ID, provider NPI, or 'system' */
  id: string;

  /** Human-readable name (for display, not for identity) */
  display_name: string;

  /** Ed25519 public key of the signing agent */
  public_key: string;
}
```

### 3.4 EncryptedPayload

The actual content of the entry, encrypted with AES-256-GCM.

```typescript
interface EncryptedPayload {
  /** AES-256-GCM encrypted ciphertext (base64-encoded) */
  ciphertext: string;

  /** 96-bit initialization vector (base64-encoded) */
  iv: string;

  /** 128-bit authentication tag (base64-encoded) */
  auth_tag: string;

  /** Key ID used for encryption — references the key ring */
  key_id: string;
}
```

### 3.5 EntryMetadata

Unencrypted metadata for indexing and chain management. Contains no clinical content.

```typescript
interface EntryMetadata {
  /** Schema version for this entry format */
  schema_version: '1';

  /** Entry type (duplicated from entry_type for unencrypted indexing) */
  entry_type: LedgerEntryType;

  /** Author type (duplicated from author.type for unencrypted indexing) */
  author_type: 'patient_agent' | 'provider_agent' | 'system';

  /** Author ID (duplicated from author.id for unencrypted indexing) */
  author_id: string;

  /** For amendments: the UUID of the entry being amended */
  amends?: string;

  /** For sync records: the UUID of the entry that was synced */
  synced_entry?: string;

  /** Byte size of the encrypted payload */
  payload_size: number;
}
```

### 3.6 Access Control Types

Access grants are ledger entries themselves — the ACL is part of the immutable record.

```typescript
interface AccessGrant {
  /** UUID of this grant */
  grant_id: string;

  /** Who is receiving access */
  grantee: GranteeIdentity;

  /** What role the grantee has */
  role: AccessRole;

  /** What scope of data the grantee can access */
  scope: AccessScope;

  /** Time limits on the grant */
  time_limits?: TimeLimits;

  /** Sync configuration for this grant */
  sync?: SyncConfig;
}

/** Six access roles with distinct permission boundaries */
type AccessRole =
  | 'provider_write'      // Credentialed provider — can write clinical entries and read within scope
  | 'provider_read'       // Provider with read-only access (e.g., consulting provider)
  | 'family_read'         // Family member — read access within scope
  | 'legal_read'          // Legal representative, POA, executor — read access within scope
  | 'organization_read'   // Insurance, long-term care facility — structured read access
  | 'application_read';   // Third-party application — local API read access

interface GranteeIdentity {
  /** Type of grantee */
  type: 'provider' | 'individual' | 'organization' | 'application';

  /** Unique identifier — NPI for providers, application ID for apps, free-form for others */
  id: string;

  /** Human-readable name */
  display_name: string;

  /** Ed25519 public key for identity verification (required for providers) */
  public_key?: string;
}

interface AccessScope {
  /** Which entry types the grantee can access */
  entry_types: LedgerEntryType[] | 'all';

  /** Time range filter — only entries within this range */
  date_range?: {
    from?: string;    // ISO 8601
    to?: string;      // ISO 8601
  };

  /** For providers: which provider authored the entries (e.g., only their own) */
  author_filter?: string[];
}

interface TimeLimits {
  /** When the grant becomes effective */
  effective_from: string;   // ISO 8601

  /** When the grant expires (absent = no expiration until revoked) */
  expires_at?: string;      // ISO 8601

  /** Whether the grant auto-renews on expiration */
  auto_renew: boolean;
}
```

### 3.7 Sync Types

```typescript
interface SyncConfig {
  /** Whether sync is enabled for this grant */
  enabled: boolean;

  /** Where to send updates */
  endpoint: SyncEndpoint;

  /** Retry policy for failed deliveries */
  retry: RetryPolicy;
}

interface SyncEndpoint {
  /** Endpoint type */
  type: 'neuron' | 'direct' | 'local';

  /** For neuron/direct: the endpoint URL or address */
  address?: string;

  /** For local: the local application identifier */
  application_id?: string;

  /** X25519 public key for encrypting sync payloads for this recipient */
  recipient_public_key: string;
}

interface RetryPolicy {
  /** Maximum number of retry attempts */
  max_retries: number;

  /** Base delay in milliseconds between retries */
  base_delay_ms: number;

  /** Maximum delay in milliseconds (exponential backoff cap) */
  max_delay_ms: number;

  /** After this many consecutive failures, alert the patient */
  alert_after_failures: number;
}
```

### 3.8 Emergency Access Types

```typescript
interface EmergencyConfig {
  /** Whether emergency access is configured */
  enabled: boolean;

  /** Authorized emergency parties */
  parties: EmergencyParty[];

  /** Cooldown period after emergency access ends before another can be triggered (seconds) */
  cooldown_seconds: number;

  /** Maximum duration of a single emergency access session (seconds) */
  max_session_seconds: number;
}

interface EmergencyParty {
  /** Unique identifier for this party */
  party_id: string;

  /** Who this party is */
  identity: GranteeIdentity;

  /** How this party authenticates the break-glass request */
  auth_method: EmergencyAuthMethod;

  /** Where the break-glass credentials are stored */
  credential_storage: CredentialStorage;

  /** Scope of access during emergency */
  scope: AccessScope;
}

interface EmergencyAuthMethod {
  /** Authentication mechanism */
  type: 'passphrase' | 'multi_party' | 'hardware_key' | 'trusted_neuron';

  /** For multi_party: how many of the configured parties must co-authenticate */
  quorum?: number;

  /** For hardware_key: key type (e.g., FIDO2) */
  key_type?: string;

  /** For trusted_neuron: the Neuron NPI */
  neuron_npi?: string;
}

interface CredentialStorage {
  /** Where the credentials are held */
  type: 'local_encrypted' | 'trusted_person' | 'trusted_neuron' | 'safety_deposit';

  /** Human-readable description of the storage location */
  description: string;

  /** For trusted_person: the person's identity */
  holder_identity?: string;

  /** For trusted_neuron: the Neuron NPI */
  neuron_npi?: string;
}
```

### 3.9 Audit Types

The vault audit trail is distinct from patient-core's AUDIT.log. The vault audit captures every operation on the vault itself.

```typescript
interface VaultAuditEntry {
  /** UUID v4 */
  id: string;

  /** ISO 8601 UTC */
  timestamp: string;

  /** What happened */
  event_type: VaultEventType;

  /** Who did it */
  actor: AuditActor;

  /** Outcome of the event */
  outcome: 'allowed' | 'denied' | 'error';

  /** Additional context */
  details: Record<string, unknown>;

  /** SHA-256 hash of the previous audit entry, or null for genesis */
  prev_hash: string | null;
}

type VaultEventType =
  // Vault lifecycle
  | 'vault_created'
  | 'vault_opened'
  | 'vault_closed'
  | 'vault_integrity_checked'
  | 'vault_integrity_failed'

  // Ledger operations
  | 'entry_written'
  | 'entry_read'
  | 'entry_query'
  | 'entry_amendment_written'

  // Access control operations
  | 'grant_created'
  | 'grant_modified'
  | 'grant_revoked'
  | 'grant_expired'
  | 'grant_query'

  // Write gate
  | 'write_authorized'
  | 'write_denied_no_grant'
  | 'write_denied_expired_grant'
  | 'write_denied_scope_violation'
  | 'write_denied_invalid_signature'

  // Read gate
  | 'read_authorized'
  | 'read_denied_no_grant'
  | 'read_denied_expired_grant'
  | 'read_denied_scope_violation'

  // Sync operations
  | 'sync_triggered'
  | 'sync_delivered'
  | 'sync_failed'
  | 'sync_retried'
  | 'sync_stopped_revocation'

  // Emergency access
  | 'emergency_triggered'
  | 'emergency_authenticated'
  | 'emergency_auth_failed'
  | 'emergency_session_started'
  | 'emergency_session_ended'
  | 'emergency_cooldown_active'

  // Key management
  | 'key_generated'
  | 'key_rotated'
  | 'key_derived'

  // Backup
  | 'backup_started'
  | 'backup_completed'
  | 'backup_failed';

interface AuditActor {
  /** Type of actor */
  type: 'patient_agent' | 'provider_agent' | 'emergency_party' | 'application' | 'system';

  /** Unique identifier */
  id: string;

  /** Human-readable name */
  display_name: string;
}
```

---

## 4. Encryption Architecture

### 4.1 Algorithms

All cryptographic operations use Node.js built-in `node:crypto`. Zero external dependencies.

| Purpose | Algorithm | Specification |
|---------|-----------|--------------|
| Payload encryption | AES-256-GCM | 256-bit key, 96-bit IV, 128-bit auth tag |
| Digital signatures | Ed25519 | RFC 8032, via `crypto.sign` / `crypto.verify` |
| Key exchange | X25519 | RFC 7748, for encrypting sync payloads to recipients |
| Key derivation | scrypt | RFC 7914, for deriving encryption keys from patient passphrase |
| Hash chaining | SHA-256 | SHA-256 of serialized JSON line, same as provider-core's AuditWriter |

### 4.2 Key Hierarchy

```
Patient Passphrase
        │
        └── scrypt derivation
                │
                ├── Master Key (AES-256)
                │       │
                │       ├── Ledger Encryption Key (AES-256-GCM)
                │       │       └── Encrypts/decrypts ledger entry payloads
                │       │
                │       └── Audit Encryption Key (AES-256-GCM)
                │               └── Encrypts/decrypts audit entry details (optional)
                │
                └── Identity Key Pair (Ed25519)
                        ├── Signs all ledger entries authored by patient's agent
                        └── Public key shared with providers and access grant recipients

Provider CareAgent
        │
        └── Identity Key Pair (Ed25519)
                ├── Signs all ledger entries authored by this provider
                └── Public key registered during relationship establishment
```

### 4.3 Key Ring

The vault maintains a key ring that tracks all encryption keys, including rotated keys needed to decrypt historical entries.

```typescript
interface KeyRing {
  /** Currently active ledger encryption key ID */
  active_key_id: string;

  /** All keys, indexed by key ID (active and rotated) */
  keys: Record<string, KeyRecord>;

  /** Patient's Ed25519 identity key pair (private key encrypted by master key) */
  identity: {
    public_key: string;
    encrypted_private_key: EncryptedPayload;
  };
}

interface KeyRecord {
  /** Unique key identifier */
  key_id: string;

  /** The encryption key, encrypted by the master key */
  encrypted_key: EncryptedPayload;

  /** When this key was generated */
  created_at: string;

  /** When this key was rotated out (null if active) */
  rotated_at: string | null;

  /** How many entries were encrypted with this key */
  entry_count: number;
}
```

### 4.4 Key Rotation

Key rotation creates a new ledger encryption key and marks the previous key as rotated. Historical entries remain encrypted with their original key — re-encryption is not required. The key ring retains all rotated keys so historical entries can always be decrypted.

Key rotation events are recorded as `key_rotation` ledger entries and `key_rotated` audit entries.

---

## 5. Access Control

### 5.1 ACL as Ledger Entries

Access grants are not stored in a separate database or configuration file. They are ledger entries — `access_grant_created`, `access_grant_modified`, `access_grant_revoked`, `access_grant_expired`. This means the complete history of who has had access, when, and with what scope is part of the immutable record.

The current state of the ACL is a materialized view derived by replaying the access grant ledger entries in order. This is the same pattern as event sourcing: the ledger is the source of truth, and the current ACL is a projection.

### 5.2 Write Gate

Every write to the ledger passes through the write gate:

1. **Author verification** — the author's Ed25519 signature is verified against their registered public key
2. **Grant check** — the author must have an active `provider_write` grant (or be the patient's own agent or system)
3. **Scope check** — the entry type must be within the author's granted scope
4. **Expiration check** — the grant must not be expired
5. **Relationship check** — the provider must have an active care relationship (not terminated or suspended)

If any check fails, the write is denied and a `write_denied_*` audit event is recorded.

### 5.3 Read Gate

Every read from the ledger passes through the read gate:

1. **Grant check** — the reader must have an active access grant
2. **Scope check** — the requested entry types must be within the reader's granted scope
3. **Date range check** — if the grant has a date range filter, only entries within the range are returned
4. **Expiration check** — the grant must not be expired

If any check fails, the read is denied and a `read_denied_*` audit event is recorded.

### 5.4 Materialized ACL View

For performance, the vault maintains an in-memory materialized view of the current ACL, rebuilt from ledger entries on vault open. This view is used by the write gate and read gate for O(1) grant lookups instead of scanning the full ledger on every operation.

The materialized view is invalidated and rebuilt whenever a new access grant entry is written.

---

## 6. Sync Engine

### 6.1 Event-Driven Propagation

Every new entry written to the ledger triggers a sync check:

1. Read the materialized ACL view for all active grants with `sync.enabled: true`
2. For each synced grant, check if the new entry falls within the grant's scope
3. If yes, encrypt the entry payload with the recipient's X25519 public key
4. Deliver to the recipient's sync endpoint
5. Record a `sync_record` ledger entry and a `sync_delivered` audit event

### 6.2 Encrypted Delivery

Sync payloads are encrypted specifically for each recipient using their X25519 public key. The vault's encryption key is never shared. Each recipient receives a payload encrypted with a per-recipient ephemeral key derived via X25519 key agreement.

### 6.3 Retry Queue

Failed sync deliveries are queued for retry with exponential backoff per the grant's `RetryPolicy`:

- Base delay doubles on each retry, capped at `max_delay_ms`
- After `max_retries` failures, the sync is marked as failed and a `sync_failed` audit event is recorded
- After `alert_after_failures` consecutive failures, the patient is notified
- When connectivity restores, queued entries are delivered in order

### 6.4 Immediate Revocation Stop

When an access grant is revoked:

1. All pending sync deliveries for that grant are immediately cancelled
2. No new entries are synced to the revoked recipient
3. A `sync_stopped_revocation` audit event is recorded
4. Recipients retain what they already received — the immutable record of what was shared and when is in the audit log

---

## 7. Emergency Access

### 7.1 Break-Glass Protocol

Emergency access allows designated parties to read the Patient Chart when the patient is incapacitated and cannot provide direct consent. The protocol is fully patient-configured in advance.

### 7.2 Trigger Flow

1. An authorized emergency party initiates a break-glass request
2. The system authenticates the request according to the configured `EmergencyAuthMethod`:
   - **Passphrase:** The party provides the pre-shared passphrase
   - **Multi-party:** A quorum of configured parties co-authenticate
   - **Hardware key:** FIDO2 or similar hardware authentication
   - **Trusted Neuron:** The designated Neuron vouches for the request
3. If authentication succeeds, a time-limited read session is opened
4. The session is scoped according to the emergency party's configured `AccessScope`
5. Every access event during the emergency session is logged with full detail

### 7.3 Time-Limited Sessions

- Each emergency session has a maximum duration (`max_session_seconds` from `EmergencyConfig`)
- When the session expires, access is automatically terminated
- After a session ends, a cooldown period (`cooldown_seconds`) must elapse before another emergency session can be triggered
- All session lifecycle events are recorded: `emergency_session_started`, `emergency_session_ended`, `emergency_cooldown_active`

### 7.4 Authentication Failure

Failed authentication attempts are logged as `emergency_auth_failed` audit events with full context — who attempted, what method was used, and why it failed. There is no rate limiting in v1; rate limiting for authentication attempts is a v2 concern.

---

## 8. Backup

### 8.1 Patient-Controlled Destinations

Because the vault is a discrete, encrypted, portable artifact, the patient controls their backup strategy entirely:

- **Local backup** — external drive, NAS, home server
- **Personal cloud storage** — iCloud, Google Drive, Dropbox (vault is encrypted before leaving the device)
- **Distributed storage** — IPFS or similar decentralized storage
- **Trusted person** — encrypted copy held by a trusted individual or executor
- **Organization backup** — opt-in backup to a trusted organization's Neuron

### 8.2 Incremental Backup

The vault supports incremental backup: only new ledger entries and audit entries since the last backup are included. Each backup records a watermark (the hash of the last entry included) so the next backup can resume from that point.

### 8.3 Backup Archive Format

A backup is a self-contained encrypted archive containing:

- New ledger entries since last backup (or all entries for full backup)
- New audit entries since last backup
- Current key ring (encrypted by master key)
- Backup metadata (timestamp, watermark, entry count, archive hash)

The archive is encrypted with the patient's master key. A recipient without the master key cannot read the backup.

### 8.4 Retention Policy

The patient configures retention policy per backup destination:

- Maximum number of backups to retain
- Maximum age of backups before cleanup
- Whether to keep full backups vs. incremental chain

### 8.5 Backup Events

Every backup operation is recorded:

- `backup_started` audit event when backup begins
- `backup_completed` audit event with archive hash, destination, entry count
- `backup_failed` audit event with error details
- `backup_record` ledger entry as permanent record

---

## 9. Local API

### 9.1 PatientChart Class

The `PatientChart` class is the sole programmatic interface to the vault. There is no HTTP API, no REST endpoint, no RPC layer. Consumers import the class and call methods directly.

```typescript
class PatientChart {
  // --- Lifecycle ---

  /** Initialize a new vault at the given path. Creates the vault directory structure, generates keys, writes genesis entry. */
  static async create(path: string, passphrase: string): Promise<PatientChart>;

  /** Open an existing vault. Derives master key from passphrase, loads key ring, rebuilds materialized ACL. */
  static async open(path: string, passphrase: string): Promise<PatientChart>;

  /** Close the vault. Flushes pending operations, clears sensitive material from memory. */
  async close(): Promise<void>;

  // --- Ledger Write ---

  /** Write a clinical entry to the ledger. Enforces write gate. */
  async writeEntry(entry: LedgerEntryInput, author: EntryAuthor): Promise<LedgerEntry>;

  /** Write an amendment to an existing entry. */
  async amendEntry(originalId: string, amendment: LedgerEntryInput, author: EntryAuthor): Promise<LedgerEntry>;

  // --- Ledger Read ---

  /** Read a single entry by ID. Enforces read gate. */
  async readEntry(id: string, reader: AuditActor): Promise<LedgerEntry | null>;

  /** Query entries by type, date range, author, or other criteria. Enforces read gate per entry. */
  async queryEntries(query: LedgerQuery, reader: AuditActor): Promise<LedgerEntry[]>;

  /** Get the total entry count (no read gate — metadata only). */
  async getEntryCount(): Promise<number>;

  // --- Access Control ---

  /** Create a new access grant. Written as a ledger entry. */
  async createGrant(grant: AccessGrant): Promise<LedgerEntry>;

  /** Modify an existing access grant. */
  async modifyGrant(grantId: string, changes: Partial<AccessGrant>): Promise<LedgerEntry>;

  /** Revoke an access grant. Immediately stops sync. */
  async revokeGrant(grantId: string): Promise<LedgerEntry>;

  /** List all active access grants. */
  async listActiveGrants(): Promise<AccessGrant[]>;

  /** Check whether a specific actor has access to a specific entry type. */
  async checkAccess(actorId: string, entryType: LedgerEntryType): Promise<boolean>;

  // --- Emergency Access ---

  /** Configure the emergency access protocol. */
  async setEmergencyConfig(config: EmergencyConfig): Promise<LedgerEntry>;

  /** Get the current emergency access configuration. */
  async getEmergencyConfig(): Promise<EmergencyConfig | null>;

  /** Trigger emergency access (called by the break-glass interface). */
  async triggerEmergencyAccess(partyId: string, credential: unknown): Promise<EmergencySession>;

  /** End an active emergency session. */
  async endEmergencySession(sessionId: string): Promise<void>;

  // --- Sync ---

  /** Get the sync status for all active synced grants. */
  async getSyncStatus(): Promise<SyncStatus[]>;

  /** Manually trigger sync for a specific grant. */
  async triggerSync(grantId: string): Promise<void>;

  /** Get the retry queue status. */
  async getRetryQueueStatus(): Promise<RetryQueueStatus>;

  // --- Backup ---

  /** Create a backup archive to the specified destination. */
  async createBackup(destination: BackupDestination): Promise<BackupResult>;

  /** List available backups at a destination. */
  async listBackups(destination: BackupDestination): Promise<BackupInfo[]>;

  /** Apply retention policy to a backup destination. */
  async applyRetentionPolicy(destination: BackupDestination): Promise<void>;

  // --- Integrity ---

  /** Verify the integrity of the ledger hash chain. */
  async verifyLedgerIntegrity(): Promise<IntegrityResult>;

  /** Verify the integrity of the audit hash chain. */
  async verifyAuditIntegrity(): Promise<IntegrityResult>;

  /** Verify all Ed25519 signatures in the ledger. */
  async verifySignatures(): Promise<SignatureVerificationResult>;

  // --- Key Management ---

  /** Rotate the ledger encryption key. */
  async rotateKey(): Promise<void>;

  /** Get key ring status (key count, active key, rotation history). */
  async getKeyRingStatus(): Promise<KeyRingStatus>;

  // --- Vault Status ---

  /** Get overall vault status: entry count, grant count, sync status, integrity status. */
  async getStatus(): Promise<VaultStatus>;
}
```

### 9.2 No HTTP, No REST, No RPC

The local API is strictly programmatic. There is no HTTP server, no REST endpoint, no WebSocket, no gRPC. Consumers import `PatientChart` from `@careagent/patient-chart` and call methods in-process. This eliminates an entire class of network-based attack vectors and keeps the vault self-contained.

---

## 10. Anti-Features

Explicit exclusions with clear rationale. These are things patient-chart will NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|-------------|-----------|-------------------|
| **Clinical interpretation** | The vault stores data. It does not interpret symptoms, suggest diagnoses, or recommend treatments. That is the role of the provider CareAgent and the clinical skills layer. | Store the data faithfully. Let patient-core and provider-core handle clinical reasoning. |
| **HTTP API or network endpoint** | An HTTP server on the patient's machine creates a network attack surface. The vault should not be reachable from the network. | Expose a local API (TypeScript class) consumed in-process by authorized applications. |
| **Entry deletion** | The immutable, append-only model is the core integrity guarantee. Deletion would break hash chains and undermine legal defensibility. | Use amendments to correct entries. The original is always preserved. |
| **External database** | SQLite, PostgreSQL, or any database adds a runtime dependency and a failure mode. The vault is self-contained JSONL files. | Hash-chained JSONL, same as provider-core's AuditWriter. Files are the database. |
| **Multi-patient support** | One vault per patient. Multi-patient support requires proxy consent, legal authority verification, and creates cross-contamination risk. | Each patient has their own vault. Caregiver/proxy access is modeled as an access grant, not multi-tenancy. |
| **Real-time streaming** | The vault is not a streaming service. It is a ledger. Real-time clinical collaboration happens through the CareAgent layer. | Sync engine delivers new entries to authorized recipients. Not a real-time stream. |
| **Cloud-first storage** | The vault lives on the patient's local machine. Cloud storage is a backup destination, not the primary store. | Local-first, with patient-controlled backup to cloud destinations. |
| **User interface** | The vault is infrastructure. UI is the concern of patient-core and third-party applications. | Expose the local API. Let consumers build the UI. |
| **Bulk export** | Mass export creates exfiltration risk and undermines the access control model. | Access grants with defined scope. No mechanism for dumping the entire vault. |
| **Real patient data (PHI) in dev** | Synthetic data only in development platform. Architecture is PHI-ready but PHI handling is not implemented. | All development and testing uses synthetic data. |

---

## 11. Technical Stack & Constraints

Mirrors provider-core and patient-core exactly:

- **Runtime:** Node.js >=22.12.0
- **Language:** TypeScript ~5.7.x
- **Package manager:** pnpm
- **Build:** tsdown ~0.20.x
- **Test:** vitest ~4.0.x (80% coverage thresholds)
- **Schema validation:** @sinclair/typebox ~0.34.x
- **Runtime dependencies:** Zero (all runtime needs from Node.js built-ins)
- **Crypto:** `node:crypto` (AES-256-GCM, Ed25519, X25519, scrypt, SHA-256)
- **File I/O:** `node:fs`, `node:path`
- **License:** Apache 2.0

### Constraints

- **Zero runtime npm dependencies** — intentional, same as provider-core and patient-core
- **Synthetic data only** — no real PHI in dev
- **Single patient per vault** — no multi-patient support in v1
- **Local-first** — vault lives on patient's local machine, not in the cloud
- **No HTTP server** — programmatic API only
- **No database** — hash-chained JSONL files, same storage pattern as provider-core
- **No dependency on patient-core or provider-core** — patient-chart is an independent package consumed by them

---

## 12. Architecture

### 12.1 Vault Directory Structure

The vault is a directory on the patient's local filesystem:

```
~/.careagent/vault/
├── ledger/
│   ├── entries.jsonl          # Hash-chained, encrypted ledger entries
│   └── index.json             # Entry index for fast lookups (entry_type, author, date)
├── audit/
│   └── vault-audit.jsonl      # Hash-chained vault audit trail
├── keys/
│   └── keyring.json           # Encrypted key ring (all keys encrypted by master key)
├── sync/
│   ├── queue.json             # Pending sync deliveries and retry state
│   └── watermarks.json        # Per-grant sync watermarks
├── backup/
│   └── state.json             # Backup watermarks and retention state
├── emergency/
│   └── config.json            # Emergency access configuration (encrypted)
└── vault.json                 # Vault metadata (creation date, schema version, vault ID)
```

### 12.2 Project Source Structure

```
@careagent/patient-chart/
├── src/
│   ├── index.ts               # Package entry point — exports PatientChart class
│   ├── ledger/                # Append-only immutable ledger implementation
│   │   ├── writer.ts          # Hash-chained JSONL ledger writer (mirrors provider-core AuditWriter)
│   │   ├── reader.ts          # Ledger reader with decryption
│   │   ├── query.ts           # Ledger query engine
│   │   ├── index-manager.ts   # Entry index for fast lookups
│   │   └── integrity.ts       # Hash chain and signature verification
│   ├── encryption/            # Vault encryption and key management
│   │   ├── aes.ts             # AES-256-GCM encrypt/decrypt
│   │   ├── ed25519.ts         # Ed25519 sign/verify
│   │   ├── x25519.ts          # X25519 key agreement for sync encryption
│   │   ├── kdf.ts             # scrypt key derivation from passphrase
│   │   └── keyring.ts         # Key ring management and rotation
│   ├── access/                # Access control list enforcement
│   │   ├── acl.ts             # Materialized ACL view (rebuilt from ledger entries)
│   │   ├── write-gate.ts      # Write gate — signature, grant, scope, expiration checks
│   │   └── read-gate.ts       # Read gate — grant, scope, date range, expiration checks
│   ├── sync/                  # Authorized access sync engine
│   │   ├── engine.ts          # Event-driven sync on new entries
│   │   ├── delivery.ts        # Encrypted payload delivery
│   │   ├── queue.ts           # Retry queue with exponential backoff
│   │   └── revocation.ts      # Immediate sync stop on grant revocation
│   ├── backup/                # Backup management and scheduling
│   │   ├── archive.ts         # Encrypted backup archive creation
│   │   ├── incremental.ts     # Incremental backup with watermarks
│   │   └── retention.ts       # Retention policy enforcement
│   ├── emergency/             # Break-glass emergency access protocol
│   │   ├── protocol.ts        # Break-glass trigger and authentication flow
│   │   ├── session.ts         # Time-limited emergency session management
│   │   └── cooldown.ts        # Post-session cooldown enforcement
│   ├── audit/                 # Vault-level audit logging
│   │   ├── writer.ts          # Hash-chained JSONL audit writer (same pattern as provider-core)
│   │   └── integrity.ts       # Audit chain verification
│   └── types/                 # Public TypeScript interfaces
│       ├── index.ts           # Re-exports all public types
│       ├── ledger.ts          # LedgerEntry, LedgerEntryType, EntryAuthor, etc.
│       ├── access.ts          # AccessGrant, AccessRole, GranteeIdentity, etc.
│       ├── sync.ts            # SyncConfig, SyncEndpoint, RetryPolicy
│       ├── emergency.ts       # EmergencyConfig, EmergencyParty, etc.
│       ├── encryption.ts      # EncryptedPayload, KeyRing, KeyRecord
│       └── audit.ts           # VaultAuditEntry, VaultEventType, AuditActor
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

### 12.3 Package Exports

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./types": {
      "import": "./dist/types/index.js",
      "types": "./dist/types/index.d.ts"
    }
  }
}
```

The primary export (`.`) provides the `PatientChart` class and all types. The `./types` export provides only the TypeScript interfaces, for consumers that need the type definitions without importing the implementation (e.g., provider-core referencing ledger entry types).

---

## 13. Roadmap

Phased to align with provider-core architecture patterns. Provider-core v1 Phases 1–5 are complete (28/28 plans executed as of 2026-02-21), providing a reference implementation for hash-chained JSONL, audit pipelines, and zero-dependency architecture. patient-chart builds on these patterns for its own domain.

### Phase 1: Vault Foundation & Audit Pipeline

**Goal:** A buildable, testable TypeScript package with vault directory creation, hash-chained audit writer, and audit integrity verification.

**Depends on:** Nothing (foundation phase)

**Deliverables:**
1. pnpm TypeScript project scaffold (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`)
2. Zero runtime deps build configuration
3. TypeBox schemas for `VaultAuditEntry`, `VaultEventType`, `AuditActor`
4. Vault directory structure creation (`~/.careagent/vault/` with all subdirectories)
5. Hash-chained JSONL audit writer (mirrors provider-core's `AuditWriter` pattern)
6. Audit chain integrity verification
7. Vault metadata file (`vault.json`) creation and validation
8. Full test suite for audit writer, chain verification, and vault initialization

**Success Criteria:**
- `pnpm build` produces working artifacts with zero runtime npm dependencies
- Vault directory is created with correct structure
- Audit entries are hash-chained with SHA-256 (genesis entry has `prev_hash: null`)
- Chain verification detects any inserted, modified, or deleted entry
- All tests pass at 80%+ coverage

**Requirements:** VALT-01, VALT-02, VALT-03, AUDT-01, AUDT-02, AUDT-03, AUDT-04, AUDT-05

---

### Phase 2: Encryption & Key Management

**Goal:** Complete cryptographic layer: AES-256-GCM encryption/decryption, Ed25519 signing/verification, X25519 key agreement, scrypt key derivation, and key ring with rotation.

**Depends on:** Phase 1 (vault directory structure, audit pipeline for logging key events)

**Deliverables:**
1. AES-256-GCM encrypt/decrypt functions using `node:crypto`
2. Ed25519 key pair generation, signing, and verification
3. X25519 key pair generation and key agreement (for sync encryption)
4. scrypt key derivation from patient passphrase to master key
5. Key ring implementation: create, load, store (encrypted by master key)
6. Key rotation: generate new key, mark old key as rotated, update key ring
7. TypeBox schemas for `EncryptedPayload`, `KeyRing`, `KeyRecord`
8. Test suite for all crypto operations, key ring lifecycle, and rotation

**Success Criteria:**
- Encrypt → decrypt round-trip produces identical plaintext
- Ed25519 sign → verify round-trip succeeds; tampered data fails verification
- X25519 key agreement produces identical shared secret on both sides
- scrypt derivation is deterministic given same passphrase and salt
- Key rotation preserves ability to decrypt entries encrypted with prior keys
- All crypto uses only `node:crypto` — zero external dependencies
- All tests pass at 80%+ coverage

**Requirements:** ENCR-01, ENCR-02, ENCR-03, ENCR-04, ENCR-05, ENCR-06

---

### Phase 3: Immutable Ledger

**Goal:** Hash-chained, encrypted, signed JSONL ledger with write, read, amend, query, and integrity verification.

**Depends on:** Phase 2 (encryption for payloads, Ed25519 for signatures, key ring for key IDs)

**Deliverables:**
1. TypeBox schemas for `LedgerEntry`, `LedgerEntryType`, `EntryAuthor`, `EntryMetadata`
2. Hash-chained JSONL ledger writer: encrypt payload → sign entry → chain hash → append
3. Ledger reader: load entry → verify chain → verify signature → decrypt payload
4. Amendment support: new entries referencing original entry UUID
5. Ledger query engine: filter by entry_type, author, date range, amends
6. Entry index manager for fast lookups (entry_type → entry IDs, author → entry IDs)
7. Ledger integrity verification: hash chain + signature verification for full ledger
8. Test suite for write, read, amend, query, index, integrity

**Success Criteria:**
- Written entries are encrypted, signed, and hash-chained
- Read entries are decrypted, signature-verified, and chain-verified
- Amendments reference the original entry and are queryable
- Ledger integrity check detects any tampering
- Index enables O(1) lookup by entry type and author
- All tests pass at 80%+ coverage

**Requirements:** LDGR-01, LDGR-02, LDGR-03, LDGR-04, LDGR-05, LDGR-06, LDGR-07, LDGR-08

---

### Phase 4: Access Control

**Goal:** ACL as ledger entries with six roles, write gate, read gate, grant/revoke/modify, expiration, and materialized ACL view.

**Depends on:** Phase 3 (ledger writer for storing grants as entries, reader for materializing ACL)

**Deliverables:**
1. TypeBox schemas for `AccessGrant`, `AccessRole`, `GranteeIdentity`, `AccessScope`, `TimeLimits`
2. ACL as ledger entries: create, modify, revoke grants as `access_grant_*` entries
3. Materialized ACL view: rebuilt from ledger entries on vault open, invalidated on new grant entries
4. Write gate: signature verification, grant check, scope check, expiration check, relationship check
5. Read gate: grant check, scope check, date range check, expiration check
6. Grant expiration: automatic `access_grant_expired` entry when time limit reached
7. Six access roles with distinct permission boundaries
8. Test suite for all access control operations, gate enforcement, and edge cases

**Success Criteria:**
- Access grants are stored as immutable ledger entries
- Write gate denies unauthorized writes with appropriate audit events
- Read gate denies unauthorized reads with appropriate audit events
- Grant revocation immediately blocks further access
- Expired grants are automatically handled
- Materialized ACL view provides O(1) grant lookups
- All tests pass at 80%+ coverage

**Requirements:** ACLS-01, ACLS-02, ACLS-03, ACLS-04, ACLS-05, ACLS-06, ACLS-07, ACLS-08

---

### Phase 5: Local API + Sync + Emergency

**Goal:** `PatientChart` class exposing the full local API, event-driven sync engine with encrypted delivery and retry queue, and break-glass emergency access protocol.

**Depends on:** Phase 4 (access control for gate enforcement, grants for sync targets and emergency parties)

**Deliverables:**
1. `PatientChart` class with `create()`, `open()`, `close()` lifecycle
2. Ledger methods: `writeEntry()`, `amendEntry()`, `readEntry()`, `queryEntries()`
3. Access control methods: `createGrant()`, `modifyGrant()`, `revokeGrant()`, `listActiveGrants()`, `checkAccess()`
4. Sync engine: event-driven propagation on new entries, encrypted delivery via X25519, retry queue with exponential backoff
5. Immediate revocation stop: cancel pending syncs when grant revoked
6. Emergency access: `setEmergencyConfig()`, `triggerEmergencyAccess()`, `endEmergencySession()`
7. Emergency authentication: passphrase, multi-party, hardware key, trusted Neuron methods
8. Time-limited emergency sessions with automatic expiration and cooldown
9. Integrity methods: `verifyLedgerIntegrity()`, `verifyAuditIntegrity()`, `verifySignatures()`
10. Status methods: `getStatus()`, `getSyncStatus()`, `getKeyRingStatus()`
11. Test suite for all API methods, sync flows, emergency flows

**Success Criteria:**
- `PatientChart.create()` initializes a new vault; `PatientChart.open()` opens an existing one
- Write and read operations enforce access gates
- Sync delivers encrypted entries to authorized recipients
- Grant revocation immediately stops sync
- Emergency access works with time limits and cooldown
- All tests pass at 80%+ coverage

**Requirements:** LAPI-01, LAPI-02, LAPI-03, LAPI-04, LAPI-05, SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, EMRG-01, EMRG-02, EMRG-03, EMRG-04, EMRG-05, EMRG-06

---

### Phase 6: Backup Management

**Goal:** Encrypted backup archives, incremental backup with watermarks, scheduling, and retention policy.

**Depends on:** Phase 5 (`PatientChart` class provides the backup methods, encryption layer for archive encryption)

**Deliverables:**
1. Encrypted backup archive creation (self-contained, encrypted by master key)
2. Incremental backup with watermarks (only new entries since last backup)
3. Full backup support (complete vault snapshot)
4. Backup metadata recording (timestamp, watermark, entry count, archive hash)
5. Retention policy enforcement (max backups, max age, cleanup)
6. `backup_record` ledger entries and `backup_*` audit events
7. Test suite for archive creation, incremental backup, retention policy

**Success Criteria:**
- Full backup creates an encrypted archive containing all vault data
- Incremental backup includes only entries since the last backup watermark
- Archives are encrypted and cannot be read without the master key
- Retention policy correctly cleans up old backups
- All backup operations are recorded in ledger and audit trail
- All tests pass at 80%+ coverage

**Requirements:** BKUP-01, BKUP-02, BKUP-03, BKUP-04, BKUP-05

---

### Phase 7: Integration Testing

**Goal:** End-to-end tests validating complete vault workflows, mock consumer tests, and package export verification.

**Depends on:** Phases 1–6 (all components must be built)

**Deliverables:**
1. E2E test: vault creation → write entries → read entries → verify integrity → backup → restore check
2. E2E test: access grant lifecycle → write gate enforcement → read gate enforcement → revocation → audit verification
3. E2E test: sync lifecycle → entry written → sync delivered → grant revoked → sync stopped
4. E2E test: emergency access → trigger → authenticate → time-limited read → session end → cooldown
5. Mock consumer tests: simulate patient-core consuming the local API
6. Package export verification: confirm all public types and classes are exported correctly
7. Cross-operation integrity: verify that all operations across all tests produce valid hash chains

**Success Criteria:**
- All E2E flows complete successfully
- Mock consumer can perform all expected operations through the public API
- Package exports are correct and complete
- Hash chains remain valid across all test scenarios
- All tests pass at 80%+ coverage

**Requirements:** INTG-01, INTG-02, INTG-03, INTG-04, INTG-05

---

### Phase 8: Documentation & Release

**Goal:** Complete documentation for developers and ecosystem consumers.

**Depends on:** Phase 7 (all features tested and verified)

**Deliverables:**
1. Architecture guide (`docs/architecture.md`) — vault structure, data model, encryption, access control
2. API reference (`docs/api.md`) — full `PatientChart` class documentation with examples
3. Backup guide (`docs/backup.md`) — backup configuration, destinations, retention
4. README.md update — installation, usage, ecosystem context
5. CONTRIBUTING.md — development setup, testing, contribution guidelines

**Success Criteria:**
- A developer can create a vault, write entries, and query them by following documentation alone
- Architecture guide covers all vault subsystems
- API reference documents every public method with parameter types and return types
- Backup guide covers all supported destinations and configuration options

**Requirements:** DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05

---

## 14. Requirements Traceability

### v1 Requirements

**Vault Foundation (VALT)**

| ID | Requirement | Phase |
|----|-------------|-------|
| VALT-01 | pnpm TypeScript project with tsdown build, vitest testing, zero runtime npm dependencies | 1 |
| VALT-02 | Vault directory structure creation with all required subdirectories | 1 |
| VALT-03 | Vault metadata file (`vault.json`) with creation timestamp, schema version, vault UUID | 1 |

**Ledger (LDGR)**

| ID | Requirement | Phase |
|----|-------------|-------|
| LDGR-01 | Hash-chained JSONL append-only ledger with SHA-256 chain from genesis entry | 3 |
| LDGR-02 | Every entry is encrypted with AES-256-GCM before writing to disk | 3 |
| LDGR-03 | Every entry is signed with the author's Ed25519 key | 3 |
| LDGR-04 | 26 ledger entry types covering clinical, care network, access control, emergency, patient-authored, and system categories | 3 |
| LDGR-05 | Amendments reference original entry UUID; original is never modified | 3 |
| LDGR-06 | Ledger query engine supports filtering by entry_type, author, date range, and amends | 3 |
| LDGR-07 | Entry index provides fast lookups by entry_type and author | 3 |
| LDGR-08 | Ledger integrity verification detects any chain break, signature failure, or tampering | 3 |

**Encryption (ENCR)**

| ID | Requirement | Phase |
|----|-------------|-------|
| ENCR-01 | AES-256-GCM encryption/decryption for ledger entry payloads using `node:crypto` | 2 |
| ENCR-02 | Ed25519 key pair generation, signing, and verification using `node:crypto` | 2 |
| ENCR-03 | X25519 key agreement for per-recipient sync payload encryption | 2 |
| ENCR-04 | scrypt key derivation from patient passphrase to master key | 2 |
| ENCR-05 | Key ring with rotation: new keys for new entries, old keys retained for historical decryption | 2 |
| ENCR-06 | All cryptographic operations use only `node:crypto` — zero external crypto dependencies | 2 |

**Access Control (ACLS)**

| ID | Requirement | Phase |
|----|-------------|-------|
| ACLS-01 | Access grants are stored as immutable ledger entries (`access_grant_*` types) | 4 |
| ACLS-02 | Six access roles: `provider_write`, `provider_read`, `family_read`, `legal_read`, `organization_read`, `application_read` | 4 |
| ACLS-03 | Write gate enforces signature verification, grant check, scope check, expiration check, relationship check | 4 |
| ACLS-04 | Read gate enforces grant check, scope check, date range check, expiration check | 4 |
| ACLS-05 | Grant revocation immediately blocks further access | 4 |
| ACLS-06 | Grant expiration automatically triggers `access_grant_expired` entry | 4 |
| ACLS-07 | Materialized ACL view provides O(1) grant lookups, rebuilt from ledger on vault open | 4 |
| ACLS-08 | Grant create, modify, and revoke operations are recorded as ledger entries and audit events | 4 |

**Sync Engine (SYNC)**

| ID | Requirement | Phase |
|----|-------------|-------|
| SYNC-01 | Every new ledger entry triggers a sync check against active grants with `sync.enabled` | 5 |
| SYNC-02 | Sync payloads are encrypted per-recipient using X25519 key agreement | 5 |
| SYNC-03 | Retry queue with exponential backoff for failed deliveries | 5 |
| SYNC-04 | Grant revocation immediately cancels all pending sync deliveries for that grant | 5 |
| SYNC-05 | Patient is notified after `alert_after_failures` consecutive sync failures | 5 |
| SYNC-06 | Every sync event (triggered, delivered, failed, retried, stopped) is recorded in audit trail | 5 |

**Backup (BKUP)**

| ID | Requirement | Phase |
|----|-------------|-------|
| BKUP-01 | Encrypted backup archives containing ledger entries, audit entries, and key ring | 6 |
| BKUP-02 | Incremental backup using watermarks — only new entries since last backup | 6 |
| BKUP-03 | Full backup support — complete vault snapshot | 6 |
| BKUP-04 | Retention policy enforcement (max count, max age) per backup destination | 6 |
| BKUP-05 | All backup operations recorded as `backup_record` ledger entries and `backup_*` audit events | 6 |

**Emergency Access (EMRG)**

| ID | Requirement | Phase |
|----|-------------|-------|
| EMRG-01 | Patient-configurable emergency access protocol with authorized parties, auth methods, and scope | 5 |
| EMRG-02 | Four authentication methods: passphrase, multi-party quorum, hardware key, trusted Neuron | 5 |
| EMRG-03 | Time-limited emergency sessions with automatic expiration | 5 |
| EMRG-04 | Cooldown period between emergency sessions | 5 |
| EMRG-05 | Every emergency event (trigger, auth success/failure, session start/end, cooldown) logged to audit trail | 5 |
| EMRG-06 | Failed authentication attempts are logged with full context | 5 |

**Local API (LAPI)**

| ID | Requirement | Phase |
|----|-------------|-------|
| LAPI-01 | `PatientChart.create()` initializes a new vault with directory structure, key generation, and genesis entry | 5 |
| LAPI-02 | `PatientChart.open()` opens an existing vault, derives master key, loads key ring, rebuilds ACL | 5 |
| LAPI-03 | Ledger methods (`writeEntry`, `amendEntry`, `readEntry`, `queryEntries`) enforce access gates | 5 |
| LAPI-04 | Access control methods (`createGrant`, `modifyGrant`, `revokeGrant`, `listActiveGrants`, `checkAccess`) manage ACL as ledger entries | 5 |
| LAPI-05 | Status methods (`getStatus`, `getSyncStatus`, `getKeyRingStatus`) provide vault health information | 5 |

**Audit (AUDT)**

| ID | Requirement | Phase |
|----|-------------|-------|
| AUDT-01 | Hash-chained JSONL append-only audit log with SHA-256 chain from genesis | 1 |
| AUDT-02 | 38 vault event types covering lifecycle, ledger, access, write gate, read gate, sync, emergency, keys, and backup | 1 |
| AUDT-03 | Every vault operation (write, read, grant, sync, emergency, backup) generates an audit event | 1 |
| AUDT-04 | Audit chain integrity verification detects any tampering | 1 |
| AUDT-05 | Audit never blocks vault operations (audit write failures do not prevent ledger writes) | 1 |

**Integration (INTG)**

| ID | Requirement | Phase |
|----|-------------|-------|
| INTG-01 | E2E: vault creation → entry write → entry read → integrity verification → backup | 7 |
| INTG-02 | E2E: access grant lifecycle → write gate → read gate → revocation → audit trail verification | 7 |
| INTG-03 | E2E: sync lifecycle → entry written → sync delivered → grant revoked → sync stopped | 7 |
| INTG-04 | E2E: emergency access → trigger → authenticate → read → session end → cooldown | 7 |
| INTG-05 | Mock consumer tests simulating patient-core consuming the local API through package exports | 7 |

**Documentation (DOCS)**

| ID | Requirement | Phase |
|----|-------------|-------|
| DOCS-01 | Architecture guide (`docs/architecture.md`) | 8 |
| DOCS-02 | API reference (`docs/api.md`) | 8 |
| DOCS-03 | Backup guide (`docs/backup.md`) | 8 |
| DOCS-04 | README.md updated with usage instructions and ecosystem context | 8 |
| DOCS-05 | CONTRIBUTING.md with development setup and guidelines | 8 |

**Coverage:** 62 v1 requirements. All mapped to phases. Zero unmapped.

---

### v2 Deferred Requirements

| ID | Requirement | Rationale for Deferral |
|----|-------------|----------------------|
| LDGR-09 | Merkle tree overlay for O(log n) integrity proofs | v1 linear chain verification is sufficient for dev-phase vault sizes |
| LDGR-10 | Ledger compaction and archival for long-running vaults | Not needed until vault sizes reach production scale |
| ENCR-07 | Post-quantum key exchange (ML-KEM) | Standards still evolving; v1 X25519 is sufficient |
| ENCR-08 | Hardware security module (HSM) integration for key storage | Adds hardware dependency; v1 software keys are sufficient |
| ACLS-09 | Per-data-category access control (medications, diagnoses, mental health, substance use) | Requires clinical taxonomy integration; v1 entry_type-based scope is sufficient |
| ACLS-10 | Delegated grant administration (patient delegates grant management to a trusted party) | Requires proxy consent model |
| SYNC-07 | Bidirectional sync (receive updates from providers, not just send) | v1 sync is outbound-only; inbound updates come through the write gate |
| SYNC-08 | Conflict resolution for concurrent writes from multiple providers | v1 append-only model avoids conflicts; concurrent write ordering is v2 |
| BKUP-06 | Automated backup scheduling with cron-like configuration | v1 supports manual/programmatic triggers; scheduling is a consumer concern |
| BKUP-07 | Backup verification and restore testing | v1 creates backups; restore verification is v2 |
| EMRG-07 | Rate limiting for emergency authentication attempts | v1 logs failures but does not rate limit |
| EMRG-08 | Emergency access notification to patient's emergency contacts | Requires notification infrastructure |
| LAPI-06 | Streaming read API for large query results | v1 returns full result arrays; streaming is a performance optimization |
| LAPI-07 | Vault migration tool for schema version upgrades | Not needed until schema changes in a future version |
| INTG-06 | Live cross-repo integration test with patient-core consuming patient-chart | Depends on patient-core being built |
| INTG-07 | Performance benchmarks for ledger write throughput and query latency | Optimization is premature before production workloads are understood |
| DOCS-06 | Emergency access configuration walkthrough for patients | Requires patient-core UI integration |
| DOCS-07 | Security audit report and threat model documentation | Requires external security review |

---

## 15. Open Questions

1. **Vault location convention.** Should the default vault path be `~/.careagent/vault/`, or should it be configurable per-patient via patient-core's CANS.md? The README references CANS.md storing the vault location.

2. **Master key storage between sessions.** scrypt derivation from passphrase is slow by design. Should the derived master key be cached in a platform keychain (macOS Keychain, Linux secret-service) for session persistence, or must the patient enter their passphrase every time?

3. **Sync transport mechanism.** The sync engine encrypts and queues entries for delivery, but the actual transport (HTTP POST, WebSocket, file copy, Neuron relay) is not specified. What is the transport contract?

4. **Provider write workflow.** When a provider CareAgent writes to the patient's vault, does the write happen locally on the patient's machine (requiring the provider's agent to be present), or is there a remote write protocol?

5. **Concurrent access.** If both patient-core and a third-party application have the vault open simultaneously, how are concurrent writes serialized? File-level locking? Process-level mutex?

6. **Index persistence vs. rebuild.** The entry index (`index.json`) can be rebuilt from the ledger at any time. Should it be persisted for fast startup, or rebuilt on every `open()` to ensure consistency?

7. **Backup restore.** v1 creates backups but does not implement restore. When restore is implemented (v2), should it support merging a backup into an existing vault, or only restoring to a clean state?

8. **Emergency access offline.** If the patient's machine is powered off or unreachable, how does emergency access work? Is the break-glass protocol purely local, or can it work against a backup copy held by a trusted party?

9. **Audit log size management.** The audit log is append-only and never compacted. For long-running vaults, should there be an archival mechanism that moves old audit entries to a separate file while preserving the hash chain?

---

*This document is a living artifact. It will be updated as research phases complete and implementation decisions are made.*
