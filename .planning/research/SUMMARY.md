# Project Research Summary

**Project:** patient-chart
**Domain:** Encrypted, patient-controlled, append-only hash-chained health record vault (TypeScript library)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Executive Summary

patient-chart is a zero-dependency TypeScript library that implements a local-first, patient-sovereign health record vault. The core artifact is a hash-chained, AES-256-GCM-encrypted, Ed25519-signed JSONL ledger stored on the local filesystem — no database, no HTTP server, no cloud. Research confirms this is the right architecture: comparable academic PHR systems (blockchain-based, IPFS-based) use heavier infrastructure to achieve the same tamper-evidence guarantees that a hash-chained JSONL file provides at zero marginal cost. The vault is not the UI layer, not the clinical reasoning layer, and not the network layer — it is pure storage infrastructure with programmatic access via a single `PatientChart` class.

The recommended approach is a layered build that mirrors the component dependency graph: cryptographic primitives first (AES-256-GCM, Ed25519, X25519, scrypt), then the audit trail (proven in provider-core's `AuditWriter`), then the encrypted signed ledger, then access control as event-sourced ledger entries, then the `PatientChart` facade with sync and emergency access, and finally backup. Every algorithm needed is available in Node.js `node:crypto` built-ins — no runtime npm dependencies are required. The toolchain (tsdown, vitest, TypeBox, TypeScript ~5.7.x) is already proven in the provider-core reference implementation in this same codebase, which eliminates configuration uncertainty entirely.

The primary risks are cryptographic mistakes with long-term consequences: AES-GCM IV reuse under the same key, non-canonical JSON serialization breaking hash chain verification, and key material lingering in heap memory after vault close. These are not probabilistic concerns — each is a well-documented failure mode with a simple, well-understood prevention strategy that must be baked into Phase 1 and Phase 2 before any higher-level component is built. Secondary risks are architectural: signing the wrong data scope (post-encryption instead of pre-encryption), TOCTOU races in the access control gates, and sync deliveries continuing after grant revocation. All of these have clear prevention strategies documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

The stack is fully determined with HIGH confidence across every component. The project uses zero runtime npm dependencies — all cryptographic and file I/O needs are served by Node.js built-in modules (`node:crypto`, `node:fs`, `node:path`, `node:os`). The dev toolchain mirrors provider-core exactly: TypeScript ~5.7.x (pinned to ecosystem version, not latest 5.9.x), tsdown ~0.20.x (Rolldown-powered library bundler), vitest ~4.0.x, and `@sinclair/typebox` ~0.34.x for schema validation. The engine constraint is Node.js >=22.12.0, which satisfies all toolchain requirements.

Every cryptographic algorithm needed is confirmed stable in Node.js >=22.12.0: AES-256-GCM via `createCipheriv`, Ed25519 via `sign(null, ...)` / `verify(null, ...)`, X25519 via `diffieHellman({privateKey, publicKey})`, scrypt via `scryptSync` with N=2^17, and SHA-256 via `createHash`. Key encoding patterns, base64 serialization conventions, and JSONL append-only write patterns are all directly extractable from provider-core's `AuditWriter` as a reference implementation. No exploratory work is needed on the stack.

**Core technologies:**
- `node:crypto` (built-in): All cryptographic operations — zero runtime deps, FIPS-compliant OpenSSL backing
- `node:fs` / `node:path` (built-in): JSONL append-only writes via `appendFileSync`, index and metadata reads
- `@sinclair/typebox` ~0.34.x: Runtime schema validation with static TypeScript type inference, zero-dep
- `tsdown` ~0.20.x: Library build with ESM output, `.d.ts` generation, multiple entry points
- `vitest` ~4.0.x: Test runner with full `node:crypto` access via Node.js pool (not jsdom)
- TypeScript ~5.7.x: Strict mode, NodeNext module resolution, pinned to match provider-core

**Critical version constraints:**
- Node.js >=22.12.0 required (`generateKeyPairSync('ed25519')` and `diffieHellman()` for X25519 require >=13.9.0; the constraint is set by provider-core ecosystem alignment)
- `@vitest/coverage-v8` must match vitest major version exactly (~4.0.x)
- Do NOT use `crypto.createECDH()` for X25519 (only supports NIST curves); use `crypto.diffieHellman()` with X25519 KeyObjects
- Do NOT use `environment: 'jsdom'` in vitest; crypto tests require the Node.js pool

### Expected Features

The PRD provides a complete feature specification. Research confirms the feature set is well-scoped and realistic: no over-engineering (blockchain was explicitly considered and rejected), and no missing fundamentals (all HIPAA-required elements are present).

**Must have (table stakes — vault is unusable without these):**
- Hash-chained append-only ledger (SHA-256, genesis entry with `prev_hash: null`) — core tamper-evidence
- AES-256-GCM payload encryption with unique per-entry IVs — HIPAA addressable requirement, moral imperative
- Ed25519 digital signatures on pre-encryption plaintext — non-repudiation and legal defensibility
- scrypt key derivation (N=2^17) from patient passphrase — memory-hard, resists GPU brute force
- Key ring with rotation, retaining all historical keys — enables decryption of historical entries
- Access control: event-sourced ACL (grants as ledger entries) + write gate (5 checks) + read gate (4 checks) — six roles
- Materialized ACL view (O(1) lookups) rebuilt by replaying grant entries on `open()`
- Hash-chained audit trail (separate from ledger, 38 event types, non-blocking writes)
- Vault directory structure + metadata (`vault.json`, 7 subdirectories)
- Amendment model (new `clinical_amendment` entry; no deletion — preserves hash chain and legal defensibility)
- Ledger integrity verification (hash chain + signatures, full chain walk)
- `PatientChart` class with `create()` / `open()` / `close()` lifecycle

**Should have (differentiators — elevate the vault for real-world clinical use):**
- Break-glass emergency access (4 auth methods, time-limited sessions with cooldown)
- Event-driven sync engine with X25519 per-recipient encrypted delivery
- Sync retry queue with exponential backoff and patient alerting on persistent failure
- Immediate sync stop on grant revocation
- Encrypted incremental backup archives with watermarks (incremental over full backup)
- Retention policy enforcement per backup destination
- Ledger query engine with entry index (`entry_type`, `author`, `date` — O(1) lookups via persisted index)

**Defer to v2+:**
- Merkle tree overlay for O(log n) integrity proofs (v1 linear verification is sufficient for dev-phase vault sizes)
- Ledger compaction and archival
- Post-quantum key exchange (ML-KEM — standards still evolving)
- HSM integration for key storage
- Per-data-category access control (mental health, substance use — requires clinical taxonomy)
- Bidirectional sync and conflict resolution
- Automated backup scheduling (consumer concern, not vault concern)
- Backup verification and restore
- Streaming read API

**Anti-features (explicitly out of scope — not just deferred, but wrong):**
- HTTP API or network endpoint (creates network attack surface, violates local-first)
- External database (violates zero-deps constraint; JSONL files ARE the database)
- Multi-patient support (cross-contamination risk; model as access grants instead)
- Entry deletion (breaks hash chain; use amendment model)
- Clinical interpretation (vault stores, does not reason; reasoning is provider-core's domain)
- Bulk export / full dump (exfiltration risk; always filter through read gate)
- Cloud-first storage (patient loses sovereignty; cloud is a backup destination, not primary)

### Architecture Approach

The architecture is a single-facade layered library: seven subsystems (Encryption, Audit, Ledger, Access Control, Sync Engine, Emergency Access, Backup) behind a `PatientChart` class, all communicating via direct method calls, all sharing a common encryption layer, all writing to flat files on the local filesystem. The dependency graph is strict and acyclic: Encryption and Audit have no upward dependencies; Ledger depends on both; Access depends on Ledger; Sync and Emergency depend on Access; Backup depends on Ledger; PatientChart orchestrates everything. This ordering is not a preference — it is a hard build order enforced by what must exist before what else can function.

Two cross-cutting rules govern the entire system: (1) Audit writes are fire-and-forget and must never block or fail a primary vault operation. (2) Every read and write passes through the access control gate with no bypass path in the public API. These are not optional design choices — they are requirements from the PRD (AUDT-05) and proven in provider-core.

**Major components:**
1. **Encryption** (`src/encryption/`) — AES-256-GCM, Ed25519, X25519, scrypt, key ring. Foundational; zero upward dependencies.
2. **Audit** (`src/audit/`) — Hash-chained JSONL audit trail, 38 event types, non-blocking writes. Mirrors provider-core `AuditWriter` exactly.
3. **Ledger** (`src/ledger/`) — Encrypt → sign → chain → append write pipeline; load → verify → decrypt → verify sig read pipeline; query engine; entry index; integrity verification.
4. **Access Control** (`src/access/`) — Event-sourced ACL (grants as ledger entries), materialized view, write gate (5 checks), read gate (4 checks), 6 roles.
5. **Sync Engine** (`src/sync/`) — Event-driven propagation on each ledger write, X25519 per-recipient encryption, retry queue with exponential backoff, revocation stop.
6. **Emergency Access** (`src/emergency/`) — Break-glass protocol, 4 auth methods, time-limited sessions, cooldown enforcement.
7. **Backup** (`src/backup/`) — Encrypted archives, incremental with watermarks, retention policy.
8. **PatientChart** (`src/index.ts`) — Facade class, vault lifecycle, method dispatch to subsystems.

**Key patterns:**
- Hash-chained append-only JSONL (used by both ledger and audit — proven in provider-core)
- Materialized ACL view via event sourcing (grants as ledger entries, rebuilt on `open()`, incremental update on new grant events)
- Layered key hierarchy (passphrase → scrypt → master key → key ring → per-entry AES-256 keys)
- Gate pattern for access enforcement (single enforcement point, every denial audited)
- Non-blocking audit (audit failures surface via callback/event, never by throwing)

### Critical Pitfalls

Research identified 7 critical pitfalls specific to this domain. The top 5 that must be built-in from day one:

1. **AES-256-GCM IV/nonce reuse under the same key** — Generates a fresh 12-byte IV internally in the `encrypt()` function (never accept IV as a parameter). Track `entry_count` per `KeyRecord` and enforce automatic rotation before reaching 2^31 entries per key. Write a test that encrypts 10,000 entries and asserts all IVs are unique. Addressed in Phase 2.

2. **Non-canonical JSON serialization breaks hash chain verification** — Hash the raw bytes written to the JSONL file, not a re-serialized object. When verifying the chain, read raw line bytes and hash them directly. Define a `canonicalize()` function used by both write and verify paths. Implement from Phase 1 onward; changing this later breaks all existing chains.

3. **Signing the wrong data scope (post-encryption vs. pre-encryption)** — Define an explicit `SignableContent` type with exactly the fields the signature covers. Create a `canonicalize(signable: SignableContent): Buffer` function used by both sign and verify paths. Test with entries read from disk (not just in-memory objects). Addressed in Phase 2 (signing API) and Phase 3 (ledger integration).

4. **Key material lingering in heap after vault close** — On `close()`, explicitly zero all key buffers with `buffer.fill(0)` before dropping references. Store keys as `Buffer` instances (not strings — strings cannot be zeroed). Derive master key on `open()`, zero it immediately after decrypting the key ring. Addressed in Phase 2 (key storage design) and Phase 5 (`PatientChart.close()`).

5. **TOCTOU race in access control gate checks** — Make gate check and write atomic using an in-process async mutex. Check `expires_at` against `Date.now()` at gate time, not against whether an `access_grant_expired` ledger entry exists. Re-check grant status immediately before each sync delivery attempt (not just when enqueued). Addressed in Phase 4 (gates) and Phase 5 (sync revocation).

**Additional pitfalls to address by phase:**
- Partial write / hash chain corruption (Phase 1): Use `open()` + `write()` + `fdatasync()`, not `appendFile()`. Validate last JSONL line on open; truncate and recover if malformed.
- Weak scrypt parameters (Phase 2): N=2^17 minimum; store parameters in `vault.json` so they can be upgraded.
- Using `===` for signature comparison (Phase 2): Always use `crypto.timingSafeEqual()` for any manual security-sensitive comparison.
- X25519 low-order point attack (Phase 2): Validate that `diffieHellman()` result is not all zeros; wrap in try/catch for `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`.
- Rebuild entire ACL on every grant change (Phase 4): Incremental update (apply only new event) vs. full rebuild only on `open()`.
- Emergency passphrase stored as plaintext (Phase 5): Store only the scrypt-derived hash.

---

## Implications for Roadmap

Based on research, the dependency graph imposes a clear build order. The suggested 8-phase structure aligns with the PRD and the architectural dependency chain.

### Phase 1: Vault Foundation and Audit Pipeline

**Rationale:** Audit (`src/audit/`) and the vault directory structure have zero upward dependencies. Building them first establishes the canonical hash-chained JSONL append pattern that every subsequent component inherits. Two critical pitfalls (non-canonical JSON serialization, partial write / chain corruption) must be addressed here — changing them later invalidates every chain written.

**Delivers:** Vault directory creation, `vault.json` metadata (with scrypt parameter slots), hash-chained audit trail (JSONL writer + chain verification), proven `appendFile` pattern with `fdatasync` durability.

**Addresses:** Hash-chained audit trail (table stake), vault directory structure (table stake).

**Avoids:** Non-canonical JSON serialization pitfall, partial write pitfall. These must be solved in Phase 1 before any other component writes JSONL.

**Research flag:** SKIP — The hash-chained JSONL pattern is directly cloned from provider-core's `AuditWriter`. No new research needed; implementation is mechanical.

---

### Phase 2: Encryption and Key Management

**Rationale:** Encryption and the key ring have no upward dependencies beyond the vault directory (Phase 1). Every other subsystem (ledger, access, sync, backup) depends on encryption primitives. This phase also establishes all security-critical invariants: IV generation strategy, canonical signing scope, scrypt parameters, and key material zeroing. Getting these wrong has permanent consequences.

**Delivers:** AES-256-GCM encrypt/decrypt (`src/encryption/aes.ts`), Ed25519 sign/verify with explicit `SignableContent` type (`src/encryption/ed25519.ts`), X25519 key agreement with low-order point validation (`src/encryption/x25519.ts`), scrypt KDF at N=2^17 with parameter storage (`src/encryption/kdf.ts`), key ring create/load/store/rotate with `buffer.fill(0)` zeroing (`src/encryption/keyring.ts`).

**Addresses:** AES-256-GCM payload encryption (table stake), Ed25519 digital signatures (table stake), scrypt key derivation (table stake), X25519 key agreement (needed for sync), key ring with rotation (table stake).

**Avoids:** AES-GCM IV reuse pitfall, signature scope mismatch pitfall, key material in heap pitfall, weak scrypt pitfall, X25519 low-order point attack, key-as-string pitfall.

**Research flag:** SKIP — All crypto APIs are confirmed stable in STACK.md with exact code patterns. This is pure implementation against well-specified interfaces.

---

### Phase 3: Immutable Ledger

**Rationale:** The ledger requires both Encryption (Phase 2) and Audit (Phase 1). It is the core artifact of the entire system. The write pipeline (encrypt → sign → chain → append) and read pipeline (load → verify chain → decrypt → verify sig) must be correct before access control can be built on top.

**Delivers:** Ledger writer with full encrypt/sign/chain/append pipeline (`src/ledger/writer.ts`), ledger reader with full load/verify/decrypt/verify-sig pipeline (`src/ledger/reader.ts`), entry query engine with filtering by type/author/date (`src/ledger/query.ts`), entry index with persistence and rebuild (`src/ledger/index-manager.ts`), full integrity verification (chain + signatures, `src/ledger/integrity.ts`), amendment model (`clinical_amendment` entry type).

**Addresses:** Hash-chained encrypted signed ledger (table stake), amendment model (table stake), ledger query engine (differentiator), ledger integrity verification (table stake).

**Avoids:** Signing post-encryption instead of pre-encryption (sign before encrypt using `SignableContent` from Phase 2), index inconsistency after reopen (test index persistence through close/reopen cycle).

**Research flag:** SKIP — Write and read pipeline are well-specified in ARCHITECTURE.md. The `AuditWriter` pattern from Phase 1 is the foundation; Phase 3 adds encryption and signing layers on top.

---

### Phase 4: Access Control

**Rationale:** Access control requires the ledger (Phase 3) because grants are stored as `access_grant_*` ledger entries. The materialized ACL view is a projection over those entries. This phase must also address the TOCTOU pitfall with an async mutex before higher-level operations can safely call the gates.

**Delivers:** Event-sourced ACL stored as ledger entries (`access_grant_created`, `access_grant_modified`, `access_grant_revoked`, `access_grant_expired`), materialized ACL view with O(1) lookups (`src/access/acl.ts`), write gate with 5 checks (`src/access/write-gate.ts`), read gate with 4 checks (`src/access/read-gate.ts`), 6 role types, grant lifecycle (create, modify, revoke, expiration), audit logging for every gate decision.

**Addresses:** ACL as ledger entries with six roles (table stake), write gate (table stake), read gate (table stake), materialized ACL view (differentiator).

**Avoids:** TOCTOU race (async mutex around check-and-write), stale ACL (check `expires_at` against `Date.now()` at gate time, not ledger entry existence), rebuilding entire ACL on every grant event (incremental update after `open()` rebuild).

**Research flag:** SKIP — The event-sourcing / materialized view pattern is well-documented. Gate logic is specified exactly in ARCHITECTURE.md. TOCTOU prevention via in-process async mutex is a standard Node.js pattern.

---

### Phase 5: PatientChart API, Sync Engine, and Emergency Access

**Rationale:** The `PatientChart` facade requires all subsystems from Phases 1–4. Sync and emergency access both require access control (Phase 4). These three features are built together because they all require a working `PatientChart` instance to orchestrate, and sync and emergency have no dependency on each other (they can be built in parallel within the phase).

**Delivers:** `PatientChart` class with `create()` / `open()` / `close()` lifecycle including key zeroing on close (`src/index.ts`), sync engine with event-driven propagation on each ledger write (`src/sync/engine.ts`), X25519 per-recipient encrypted delivery (`src/sync/delivery.ts`), retry queue with exponential backoff (`src/sync/queue.ts`), immediate sync stop on grant revocation (`src/sync/revocation.ts`), break-glass emergency access with 4 auth methods (`src/emergency/protocol.ts`), time-limited emergency sessions with cooldown (`src/emergency/session.ts`, `src/emergency/cooldown.ts`).

**Addresses:** `PatientChart` lifecycle (table stake), sync engine with encrypted delivery (differentiator), retry queue (differentiator), immediate revocation stop (differentiator), break-glass emergency access (differentiator), time-limited sessions with cooldown (differentiator).

**Avoids:** Key material in heap after close (Phase 2 key ring + Phase 5 `close()` zeroing), sync not stopped on revocation (re-check grant status immediately before each delivery attempt), emergency passphrase stored as plaintext (store only scrypt hash).

**Research flag:** NEEDS RESEARCH — The sync transport contract is unresolved (ARCHITECTURE.md §Open Integration Questions). The `SyncTransport` interface that consumers implement must be defined before the sync engine can be built. Additionally, the concurrent access / file-locking strategy needs a decision before Phase 5 (multiple processes opening the vault simultaneously).

---

### Phase 6: Backup

**Rationale:** Backup depends on ledger (Phase 3) and encryption (Phase 2). It does not depend on access control or the PatientChart facade in strict architectural terms, but the PRD places it here because backup methods are exposed via the `PatientChart` class (Phase 5). Placing it after Phase 5 simplifies integration and ensures the facade exists before backup APIs are surfaced.

**Delivers:** Encrypted backup archive creation using master key (`src/backup/archive.ts`), incremental backup with watermarks tracking last-backed-up entry hash (`src/backup/incremental.ts`), retention policy enforcement with max-count and max-age per destination (`src/backup/retention.ts`), `backup_record` ledger entry type.

**Addresses:** Encrypted backup archives (differentiator), incremental backup with watermarks (differentiator), retention policy enforcement (differentiator).

**Research flag:** SKIP — Backup is fundamentally: read entries from ledger, encrypt archive with master key, write to destination, track watermark. All primitives are established in Phases 2 and 3. The incremental / watermark pattern is specified clearly in FEATURES.md.

---

### Phase 7: Integration Testing

**Rationale:** Cross-component behavior (full write-to-read round trip, sync delivery on new entry, emergency access session lifecycle, backup and watermark persistence across close/reopen) requires all subsystems to be operational. Unit tests in each phase cover subsystem behavior; integration tests in Phase 7 cover the full system.

**Delivers:** End-to-end test scenarios covering the happy path and critical failure modes: multi-entry chain integrity across close/reopen cycles, key rotation followed by historical entry decryption, concurrent write + grant revocation race, full backup + watermark + retention cycle, emergency access session expiry and cooldown.

**Research flag:** SKIP — Integration test patterns are established in provider-core's `audit.test.ts` and in STACK.md's vitest patterns. The scenarios themselves are derived directly from PITFALLS.md §Pitfall-to-Phase Mapping.

---

### Phase 8: Documentation and Package Publish Preparation

**Rationale:** Documentation requires a stable, verified implementation. Publishing prep (package.json exports, README, CHANGELOG) is the final step before consumers can adopt the library.

**Delivers:** README with API reference, TSDoc comments on all public types and methods, `CHANGELOG.md`, verified package.json exports (`"."` and `"./types"`), build verification (tsdown outputs correct `.d.ts` and `.js`).

**Research flag:** SKIP — Package structure (dual entry points, ESM-only, `engines` constraint) is fully specified in STACK.md's tsdown configuration.

---

### Phase Ordering Rationale

The phase order is not arbitrary — it is dictated by the component dependency graph documented in ARCHITECTURE.md §Build Order:

- **Phases 1 and 2 could technically run in parallel** (Audit and Encryption have no mutual dependency), but the pitfall requiring that hash canonicalization be established before any JSONL writer is built makes Phase 1 a logical prerequisite for the mental model, even if not a strict code dependency. Run them sequentially to avoid confusion.
- **Phase 3 is blocked** on both Phase 1 (audit, for logging) and Phase 2 (encryption, for payload encryption and signing).
- **Phase 4 is blocked** on Phase 3 (grants are ledger entries; can't store them until ledger exists).
- **Phase 5 is blocked** on Phase 4 (sync and emergency both need access control).
- **Phase 6 can technically start after Phase 3**, but belongs after Phase 5 for integration simplicity.
- **Phases 7 and 8** are sequential post-implementation steps.

The two open questions that could affect Phase 5 scheduling: (1) sync transport interface design, and (2) concurrent access / file locking strategy. Both should be resolved during Phase 4 planning so Phase 5 can proceed without blocking.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every technology version confirmed against npm registry. Code patterns validated against provider-core reference implementation. Zero ambiguity. |
| Features | HIGH | PRD provides complete specification. Research confirms alignment with HIPAA requirements and healthcare record standards. Feature boundaries are clear and well-justified. |
| Architecture | HIGH | Component boundaries, data flows, and build order are fully specified. provider-core AuditWriter provides a proven reference implementation for the core pattern. Two unresolved integration questions noted. |
| Pitfalls | HIGH | Crypto pitfalls sourced from NIST, RFCs, and Node.js security advisories. All are well-documented with specific prevention strategies. No speculative pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

The following open questions were identified in research and must be resolved before or during Phase 5:

- **Sync transport contract** (Phase 5 blocker): The sync engine encrypts and queues entries, but the transport mechanism (HTTP POST to recipient endpoint, file copy, Neuron relay) is unspecified. A `SyncTransport` interface that consumers implement must be designed before the sync engine's delivery layer (`src/sync/delivery.ts`) can be built. Resolution: define the interface contract as part of Phase 5 planning, not during Phase 5 implementation.

- **Concurrent vault access / file locking** (Phase 5 consideration): Multiple processes opening the same vault simultaneously are not addressed in the PRD. Options are: (a) single-writer constraint enforced by a lockfile, (b) in-process async mutex (works only for single-process), (c) documented "single consumer" contract. This must be decided before Phase 5 ships the PatientChart facade to consumers. Resolution: decide during Phase 4 planning; document the constraint explicitly.

- **Provider write locality** (Phase 3/4 consideration): Whether providers write entries to the vault locally (requiring agent presence on the patient's machine) or remotely (requiring a write protocol) affects how the write gate's signature verification operates. The PRD assumes local writes. Resolution: confirm this assumption during Phase 3 planning.

---

## Sources

### Primary (HIGH confidence)

- provider-core `src/audit/writer.ts` — Hash-chained JSONL reference implementation (reviewed source code)
- provider-core `src/audit/entry-schema.ts` — TypeBox schema pattern (reviewed source code)
- provider-core `src/audit/pipeline.ts` — Pipeline pattern wrapping AuditWriter (reviewed source code)
- provider-core `package.json`, `tsdown.config.ts`, `vitest.config.ts` — Toolchain reference configuration (reviewed)
- provider-core `test/integration/audit.test.ts` — Crypto test patterns (reviewed)
- [Node.js v25.6.1 Crypto Documentation](https://nodejs.org/api/crypto.html) — API signatures for all crypto functions
- [tsdown Official Documentation](https://tsdown.dev/guide/) — Build configuration and entry points
- [Vitest 4.0 Release Blog](https://vitest.dev/blog/vitest-4) — Breaking changes confirmation
- [TypeBox GitHub Repository](https://github.com/sinclairzx81/typebox) — API reference, schema patterns
- [NIST: Practical Challenges with AES-GCM](https://csrc.nist.gov/csrc/media/Events/2023/third-workshop-on-block-cipher-modes-of-operation/documents/accepted-papers/Practical%20Challenges%20with%20AES-GCM.pdf) — AES-GCM nonce limits
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) — Deterministic JSON serialization
- [HIPAA Audit Log Requirements](https://compliancy-group.com/hipaa-audit-log-requirements/) — Audit trail compliance
- [Break Glass Procedure (Yale HIPAA)](https://hipaa.yale.edu/security/break-glass-procedure-granting-emergency-access-critical-ephi-systems) — Emergency access implementation
- patient-chart PRD — Complete interfaces, vault directory layout, phase plan
- `.planning/PROJECT.md` — Project constraints and context

### Secondary (MEDIUM confidence)

- [Hyperledger Healthchain](https://www.mdpi.com/2079-9292/10/23/3003) — IPFS+blockchain PHR comparison confirming patient-chart's architectural advantages
- [Blockchain PHR Systematic Review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8080150/) — Competitive landscape analysis
- [Soatok: Extending the AES-GCM Nonce](https://soatok.blog/2022/12/21/extending-the-aes-gcm-nonce-without-nightmare-fuel/) — AES-GCM nonce management strategies
- [Darwin's Deceptive Durability](https://transactional.blog/blog/2022-darwins-deceptive-durability) — macOS fsync / F_FULLFSYNC behavior
- [Monocypher X25519 manual](https://monocypher.org/manual/x25519) — X25519 low-order point pitfalls
- [Kurrent.io: Counterexamples in Event Sourced Consistency](https://www.kurrent.io/blog/counterexamples-regarding-consistency-in-event-sourced-solutions-part-1/) — Materialized view race conditions
- [Node.js GitHub Issue #9439](https://github.com/nodejs/node/issues/9439) — macOS fsync does not flush to disk
- npm registry (local `npm view`) — Version verification for all packages

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
