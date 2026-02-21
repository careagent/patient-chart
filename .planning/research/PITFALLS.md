# Pitfalls Research

**Domain:** Encrypted, hash-chained, append-only health record vault (TypeScript/Node.js)
**Researched:** 2026-02-21
**Confidence:** HIGH (crypto pitfalls are well-documented; vault-specific pitfalls derived from PRD architecture analysis + ecosystem research)

## Critical Pitfalls

### Pitfall 1: AES-256-GCM IV/Nonce Reuse Under the Same Key

**What goes wrong:**
If two ledger entries are ever encrypted with the same (key, IV) pair, AES-GCM's security completely collapses. An attacker can XOR the two ciphertexts to recover plaintext and forge authentication tags. This is not a theoretical weakness — it is a catastrophic, total break of confidentiality and integrity.

**Why it happens:**
The PRD specifies 96-bit random IVs via `crypto.randomBytes(12)`. With random IVs, the birthday bound means collision probability exceeds 2^-32 after ~2^32 encryptions under one key. In a patient vault that could accumulate entries over decades (clinical encounters, amendments, audit events, sync records), a single key used for the entire vault lifetime without rotation would approach dangerous territory. More subtly, a bug in IV generation (e.g., seeding the CSPRNG from a low-entropy source, or accidentally caching/reusing an IV buffer) can cause immediate collision.

**How to avoid:**
1. Generate a fresh 12-byte IV via `crypto.randomBytes(12)` for every single encryption call — never accept an IV as a parameter from outside the encrypt function.
2. Track `entry_count` per `KeyRecord` (already in the PRD's `KeyRecord.entry_count`). Enforce automatic key rotation when `entry_count` approaches a conservative threshold (e.g., 2^31 = ~2 billion, well below the 2^32 birthday bound).
3. In the encrypt function, generate the IV internally and return it alongside the ciphertext — never let the caller supply the IV.
4. Write a unit test that encrypts 10,000 entries and asserts all IVs are unique.
5. Consider a monotonic counter-based nonce scheme as a defense-in-depth alternative (counter||random hybrid), though random-only is acceptable if rotation is enforced.

**Warning signs:**
- The `encrypt()` function accepts an `iv` parameter instead of generating it internally.
- No key rotation trigger tied to `entry_count`.
- Tests that reuse a static IV for "convenience."
- The `EncryptedPayload.iv` field contains duplicate values when queried across the ledger.

**Phase to address:**
Phase 2 (Encryption & Key Management). The encrypt function's API design and key rotation threshold must be decided here. Phase 3 (Immutable Ledger) must call encrypt correctly.

---

### Pitfall 2: Hash Chain Corruption From Partial Writes and Crashes

**What goes wrong:**
A crash, power loss, or process kill during a JSONL append leaves a partially written line at the end of `entries.jsonl` or `vault-audit.jsonl`. The next append reads the last line to compute `prev_hash`, finds a malformed JSON fragment, and either throws an error (vault becomes unopenable) or computes a hash over corrupt data (chain silently diverges from the real history). On macOS specifically, `fs.fsync()` does not flush to disk — it only flushes to the drive's write cache. True durability requires `fcntl(F_FULLFSYNC)`, which Node.js's libuv maps correctly on internal drives but may fail silently on external drives.

**Why it happens:**
`fs.appendFile` and `fs.write` in Node.js are not atomic at the filesystem level. The OS may confirm the write before data reaches stable storage. JSONL makes this worse because a partial line is syntactically indistinguishable from a complete line until you try to parse it. Hash chains amplify the damage: one corrupt entry invalidates the chain from that point forward.

**How to avoid:**
1. Use `fs.open()` + `fs.write()` + `fs.fdatasync()` (or `fs.fsync()`) after every append — not `fs.appendFile()`. The fdatasync ensures data reaches stable storage before returning.
2. On vault open, read the last line of each JSONL file and validate it parses as JSON. If it does not, truncate the partial line (it was never committed) and log a recovery event to the audit trail.
3. Write the newline separator (`\n`) as part of the atomic write — write `JSON.stringify(entry) + '\n'` as a single `fs.write()` call, not two separate writes.
4. Keep the file descriptor open for the lifetime of the writer (open on vault open, close on vault close) to avoid repeated open/close overhead and ensure consistent file handle state.
5. On macOS, verify that fsync actually invokes `F_FULLFSYNC` by testing on the target platform. Node.js via libuv should do this automatically on Darwin, but external/networked drives may not support it.

**Warning signs:**
- Using `fs.appendFile` or `fs.writeFile` instead of `fs.open` + `fs.write` + `fs.fdatasync`.
- No recovery logic for malformed last lines on vault open.
- Tests that never simulate mid-write process termination.
- Hash chain verification passes in tests but only because tests never crash mid-write.

**Phase to address:**
Phase 1 (Vault Foundation & Audit Pipeline). The audit writer establishes the JSONL append pattern. Getting this right in Phase 1 means the ledger writer in Phase 3 inherits a proven pattern.

---

### Pitfall 3: Non-Canonical JSON Serialization Breaks Hash Chain Verification

**What goes wrong:**
The hash chain computes SHA-256 over the "serialized JSON line" of each entry. If the serialization is not canonically deterministic, the same logical entry can produce different byte sequences, causing hash verification to fail on re-read. `JSON.stringify()` in Node.js does not guarantee key ordering across engine versions. More insidiously, floating-point numbers, `undefined` values silently dropped, and Unicode escape differences (`\u00e9` vs the literal character) all produce different bytes for the same logical data.

**Why it happens:**
Developers assume `JSON.stringify()` is deterministic. It is for a given V8 version with the same input object, but: (a) object key insertion order may differ if the entry is reconstructed differently, (b) TypeBox schema validation may reorder keys, (c) future Node.js versions may change serialization behavior, (d) reading an entry from disk and re-serializing it may not produce byte-identical output.

**How to avoid:**
1. Define a canonical serialization function that sorts keys deterministically (RFC 8785 JSON Canonicalization Scheme is the standard, but a simpler sorted-keys `JSON.stringify` with a replacer is sufficient for a single-implementation system).
2. Hash the raw bytes as stored on disk — do not re-serialize and re-hash. When verifying the chain, read the raw line bytes and hash them directly.
3. Store the hash as the SHA-256 of the exact bytes written to the JSONL file (the line as a UTF-8 byte string), not a hash of a re-serialized object.
4. Write an invariant test: serialize an entry, write it, read the raw bytes back, and verify the hash matches.

**Warning signs:**
- The hash function accepts a JavaScript object and calls `JSON.stringify()` internally before hashing.
- No test that reads raw file bytes and verifies hashes against them.
- Hash verification works in unit tests (same process) but fails after vault close/reopen (different serialization path).

**Phase to address:**
Phase 1 (Vault Foundation). The hash computation strategy must be decided before any hash-chained writer is built. Phase 3 (Immutable Ledger) must use the same strategy.

---

### Pitfall 4: Signing Pre-Encryption Data but Verifying Post-Decryption Data (Signature Scope Mismatch)

**What goes wrong:**
The PRD says the Ed25519 signature covers "canonical entry content (pre-encryption)." If the verification path decrypts the payload and then verifies the signature over the decrypted content, but the signing path signed a slightly different canonical form (e.g., before metadata was added, or with a different field subset), the signature will fail for legitimate entries or — worse — pass for tampered entries because the wrong data is being verified.

**Why it happens:**
The LedgerEntry has both encrypted and unencrypted fields. The signature must cover a well-defined subset of the entry at a well-defined point in the write pipeline. If the "what gets signed" contract is ambiguous, different code paths (write vs. verify) will sign/verify different byte sequences. This is especially dangerous because the entry goes through multiple transformations: plaintext -> canonical form -> sign -> encrypt -> add metadata -> serialize -> hash chain -> write.

**How to avoid:**
1. Define an explicit `SignableContent` type that includes exactly the fields covered by the signature: `{ id, timestamp, entry_type, author, payload (plaintext), metadata }`.
2. Create a `canonicalize(signable: SignableContent): Buffer` function used by both the sign and verify paths.
3. The sign path: `canonicalize(signable) -> ed25519.sign(canonical, privateKey) -> signature`.
4. The verify path: decrypt payload -> reconstruct SignableContent from entry -> `canonicalize(signable) -> ed25519.verify(canonical, signature, publicKey)`.
5. Write a round-trip test: sign an entry, encrypt it, write it, read it, decrypt it, verify the signature.

**Warning signs:**
- The signing function and verification function use different field sets or serialization orders.
- Signature verification is tested only with in-memory objects, never with entries read from disk.
- No explicit type defining what fields are signed.

**Phase to address:**
Phase 2 (Ed25519 signing) defines the sign/verify API. Phase 3 (Immutable Ledger) integrates it into the write/read pipeline. The `SignableContent` type must be defined in Phase 2.

---

### Pitfall 5: TOCTOU Race in Access Control Gate Checks

**What goes wrong:**
The write gate checks the materialized ACL view ("does this author have an active `provider_write` grant?"), then proceeds to write the entry. If a grant is revoked between the check and the write, the entry is written by an unauthorized author. Similarly for the read gate: a grant could expire between the check and the decryption/return of data.

**Why it happens:**
The PRD describes a materialized ACL view rebuilt from ledger entries, used for O(1) lookups. In a single-process Node.js environment, this seems safe because JavaScript is single-threaded. However: (a) async operations yield to the event loop — a `revokeGrant()` call could interleave between the gate check and the `fs.write()`, (b) the materialized view could be stale if a grant expiration was not yet processed, (c) the pattern of "check then act" is inherently vulnerable in concurrent environments.

**How to avoid:**
1. Make the write gate check and the actual write a single atomic operation — hold a mutex/lock from the moment the gate check starts until the entry is written and flushed. Use an in-process async mutex (a simple promise-based lock) since this is single-process.
2. For grant expiration: check expiration at the moment of the gate check using `Date.now()` against `TimeLimits.expires_at`, do not rely on a background process having already recorded the `access_grant_expired` entry.
3. After writing an entry, re-validate the grant is still active. If it was revoked during the write, record the event in the audit trail (the entry is already written and cannot be removed from the append-only ledger, but the audit trail captures the race).
4. For the read gate, the window is less critical because reading does not modify state, but expired grants must be checked against wall-clock time, not against whether an `access_grant_expired` entry exists.

**Warning signs:**
- Gate check and write are separate async functions with an `await` between them.
- Grant expiration is checked by looking for `access_grant_expired` ledger entries rather than comparing `expires_at` to the current time.
- No mutex or serialization of write operations.
- Tests never exercise concurrent write + revoke scenarios.

**Phase to address:**
Phase 4 (Access Control). The gate implementation must use atomic check-and-write. Phase 5 (Local API) must ensure the `PatientChart` class serializes concurrent operations.

---

### Pitfall 6: Key Material Lingering in Memory After Vault Close

**What goes wrong:**
The master key, derived ledger encryption keys, and Ed25519 private keys remain in Node.js heap memory after `PatientChart.close()` is called. JavaScript's garbage collector does not zero memory — it merely marks it as available. A memory dump, core dump, or heap snapshot could expose all key material. The January 2026 Node.js security release (CVE affecting Buffer allocation) demonstrated that uninitialized memory can leak previous buffer contents under specific timing conditions.

**Why it happens:**
JavaScript has no concept of secure memory allocation or explicit memory zeroing. `Buffer.alloc()` zeros memory on allocation, but there is no `Buffer.zero()` or `SecureBuffer` that zeros on deallocation. Developers store keys as `Buffer` instances, call `close()`, set references to `null`, and assume GC will clean up. It will — eventually — but the memory contents persist until overwritten by a future allocation.

**How to avoid:**
1. On `close()`, explicitly zero all key buffers with `buffer.fill(0)` before dropping references. Zero the master key, all key ring entries, the Ed25519 private key, and any derived keys.
2. Store keys in `Buffer` instances (not strings or Uint8Arrays) so you have a `fill()` method available.
3. Minimize key lifetime: derive the master key on `open()`, zero it on `close()`. Do not cache derived keys longer than necessary.
4. For the scrypt-derived master key specifically: derive it once on open, use it to decrypt the key ring, then zero the master key and keep only the decrypted ledger encryption key. Re-derive from passphrase only when needed (key rotation).
5. Write a test that calls `close()` and then inspects the key buffer contents (should be all zeros).

**Warning signs:**
- Keys stored as hex strings or base64 strings (strings cannot be zeroed in JavaScript).
- No `buffer.fill(0)` calls in the `close()` method.
- Master key kept in memory for the entire session even after key ring is decrypted.
- No test verifying key material is zeroed after close.

**Phase to address:**
Phase 2 (Key Management). The key storage and lifecycle API must include zeroing. Phase 5 (PatientChart.close()) must call the zeroing functions.

---

### Pitfall 7: Weak scrypt Parameters Allow Brute-Force of Patient Passphrase

**What goes wrong:**
The patient's passphrase protects the entire vault — master key, ledger encryption keys, identity keys. If scrypt parameters are too weak (low N, r, p), an attacker with access to the vault files can brute-force the passphrase offline. The vault is local-first and designed to be backed up to external storage, so the encrypted key ring file will exist on USB drives, cloud storage, and potentially in the hands of adversaries.

**Why it happens:**
Developers use Node.js defaults or example code values. Node's `crypto.scrypt` defaults to N=16384, r=8, p=1, which is the minimum acceptable for 2016-era hardware. For a health record vault that must resist offline brute-force attacks for years, these defaults are dangerously weak. The scrypt computation must be slow enough to resist GPU-accelerated attacks but fast enough for a patient to open their vault in a few seconds.

**How to avoid:**
1. Use N=2^17 (131072) or higher, r=8, p=1 as the baseline. This produces ~500ms derivation time on modern hardware, which is acceptable for a vault-open operation that happens once per session.
2. Store the scrypt parameters (N, r, p, salt, keyLength) in `vault.json` alongside the vault metadata so they can be upgraded without breaking existing vaults.
3. Generate a unique 32-byte random salt per vault via `crypto.randomBytes(32)`. Never reuse salts across vaults.
4. Write a benchmark test that measures derivation time and fails if it drops below 200ms (indicating parameters are too weak) or exceeds 5 seconds (indicating parameters are too aggressive for UX).
5. Plan for parameter upgrades: when the patient changes their passphrase or on a future vault open, re-derive with stronger parameters and re-encrypt the key ring.

**Warning signs:**
- Using N=16384 (the Node.js default / common tutorial value).
- Salt shorter than 16 bytes.
- scrypt parameters hardcoded rather than stored in vault metadata.
- No benchmark test for derivation time.
- Same salt used across test fixtures.

**Phase to address:**
Phase 2 (Key Derivation). The scrypt parameters, salt generation, and parameter storage must be decided here. The `vault.json` metadata from Phase 1 must include a field for scrypt parameters.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing keys as hex/base64 strings instead of Buffers | Simpler serialization, easier logging | Cannot zero memory on close; keys persist in heap until GC; string immutability means copies proliferate | Never for private keys or symmetric keys |
| Using `JSON.stringify()` directly for hash computation | Quick to implement, no extra dependency | Hash verification breaks if serialization changes; cross-version incompatibility | Never — define canonical serialization from day one |
| Skipping `fsync`/`fdatasync` after JSONL appends | 10-50x faster writes in tests | Data loss on crash; corrupt hash chains; silent audit gaps | Only in test mode with an explicit `durability: false` flag |
| Rebuilding the entire ACL view on every grant change | Simple implementation, always consistent | O(n) rebuild on every grant operation; vault with thousands of grant history entries becomes slow | Phase 4 MVP, but must be optimized before Phase 7 integration tests with large datasets |
| Single JSONL file for all ledger entries | Simple file management, easy to reason about | File grows unbounded; seek/read for queries becomes O(n); OS file handle limits on very large files | Acceptable for v1 where vault sizes are small; plan segmented files for v2 |
| Hardcoded crypto algorithm identifiers | Fewer moving parts | Cannot migrate to new algorithms (e.g., post-quantum) without code changes | v1 only — Phase 2 should use algorithm identifiers in the EncryptedPayload so future versions can introduce new algorithms |

## Integration Gotchas

Common mistakes when connecting vault components internally (no external services in v1).

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Ledger Writer -> Audit Writer | Writing the ledger entry first, then the audit event, and not handling audit write failure. If audit write fails, the ledger entry exists but the audit trail has a gap. | Write ledger entry, then audit event. If audit write fails, log to stderr but do not roll back the ledger entry (PRD requirement AUDT-05: "audit never blocks vault operations"). Retry audit write on next operation. |
| Encrypt -> Sign -> Hash Chain | Signing the encrypted payload instead of the plaintext content. The signature becomes meaningless because anyone with the encryption key can re-encrypt different content and the signature still "verifies." | Sign the plaintext canonical content, then encrypt the payload. The signature covers the actual clinical data, not the ciphertext wrapper. |
| Materialized ACL -> Write Gate | Checking the materialized ACL for a grant but not checking `TimeLimits.expires_at` against wall-clock time. A grant that expired 5 minutes ago still appears "active" in the materialized view until an `access_grant_expired` entry is written. | Always compare `expires_at` to `Date.now()` in the gate check, regardless of materialized view state. The materialized view tracks grant existence; expiration is a runtime check. |
| Key Ring -> Ledger Reader | Using the `active_key_id` to decrypt all entries. Historical entries encrypted with rotated keys will fail decryption. | Read `key_id` from each entry's `EncryptedPayload.key_id` field and look up the corresponding key in the key ring. The active key is only for new encryptions. |
| Sync Engine -> Revocation | Checking grant status when the sync is triggered but not re-checking when the delivery is actually attempted (could be minutes later due to retry queue). | Re-check grant status immediately before each delivery attempt. If the grant was revoked while the delivery was queued, cancel and record `sync_stopped_revocation`. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Linear scan of JSONL for every query | Queries slow down proportionally to ledger size; `queryEntries()` takes seconds | Use the entry index (`index.json`) for lookups by entry_type and author; load index into memory on vault open | >10,000 entries (~2-3 years of active clinical use) |
| Full ledger replay to rebuild materialized ACL on every `open()` | Vault open time grows linearly with entry count; noticeable delay at startup | Cache the materialized ACL state with a watermark; on open, replay only entries after the watermark | >5,000 access-related entries (unlikely in v1, but important for long-lived vaults) |
| scrypt derivation blocking the event loop | Vault open blocks all other operations for 500ms-2s; UI appears frozen if patient-core is waiting | Use `crypto.scrypt()` (async, callback-based) not `crypto.scryptSync()`. The async version runs in the libuv thread pool and does not block the event loop. | Always — even at small scale, blocking the event loop for 500ms is unacceptable |
| Reading entire JSONL file into memory for integrity verification | Memory usage spikes to file size * 2-3x (raw text + parsed objects); OOM on large vaults | Stream the file line-by-line using `readline` or a custom line reader; verify hash chain incrementally | >100MB ledger file (~50,000+ entries with clinical payloads) |
| Sync engine fires for every entry write, even when no grants have sync enabled | Unnecessary ACL scan on every write; overhead proportional to grant count | Check a fast flag (`hasSyncGrants: boolean`) before iterating grants; only iterate if at least one sync-enabled grant exists | Not a crash risk, but noticeable overhead at >100 writes/session with many grants |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `===` or `Buffer.equals()` to compare Ed25519 signatures or HMAC tags | Timing side-channel: comparison short-circuits on first differing byte, leaking information about the expected value | Always use `crypto.timingSafeEqual()` for any security-sensitive comparison. Note: `crypto.verify()` for Ed25519 is already constant-time internally, but any manual signature comparison must use timingSafeEqual. |
| Reusing the same Ed25519 key pair for both signing and X25519 key exchange | Key reuse across algorithms can leak information about the private key; Ed25519 and X25519 use the same underlying curve but different protocols | Generate separate key pairs for signing (Ed25519) and key exchange (X25519). The PRD already separates these in the key hierarchy — enforce this separation in code. |
| Not validating X25519 public keys before key agreement | A malicious public key (e.g., a low-order point) can force the shared secret to a known value, allowing the attacker to decrypt sync payloads | After `diffieHellman.computeSecret()`, check that the result is not all zeros. Reject the key agreement if it is. Wrap in try/catch for `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`. |
| Storing the scrypt salt in the same file as the encrypted key ring | An attacker with the key ring file has everything needed for offline brute-force: salt + encrypted material + scrypt parameters | This is actually acceptable and standard practice (the salt is not secret — it prevents precomputation attacks). The real mistake is thinking the salt needs to be secret and storing it in a "more secure" location that is harder to back up. Store salt in `vault.json` alongside scrypt parameters. |
| Emergency passphrase stored as plaintext in `emergency/config.json` | Defeats the purpose of emergency authentication; anyone with filesystem access bypasses break-glass controls | Store only the scrypt-derived hash of the emergency passphrase, never the passphrase itself. Verify by re-deriving and comparing hashes. |
| Not logging denied access attempts with sufficient detail | Cannot detect brute-force or unauthorized access patterns; no forensic trail | Log the full context for every `write_denied_*` and `read_denied_*` event: who, what they tried, why it failed, timestamp. The PRD already specifies this — ensure the implementation actually includes the detail fields. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **AES-256-GCM encryption:** Often missing auth tag verification on decryption. Call `decipher.setAuthTag(tag)` before `decipher.final()` — if the auth tag is wrong, `final()` throws. If you catch the error and return the plaintext anyway, you have no integrity guarantee.
- [ ] **Hash chain verification:** Often verifies only the hash linkage (prev_hash matches) but not the signatures. A chain with valid hashes but forged signatures is still tampered. Verify both hash chain AND Ed25519 signatures.
- [ ] **Ed25519 signature verification:** Often tested with the same key pair that signed. Test with a different public key to verify that invalid signatures are actually rejected. Test with a tampered payload to verify that signature verification catches content modification.
- [ ] **Key rotation:** Often creates the new key and encrypts new entries with it, but does not test decrypting old entries with the old key after rotation. The key ring must retain all historical keys.
- [ ] **Grant revocation:** Often revokes the grant in the ACL but does not stop pending sync deliveries. Test that `revokeGrant()` cancels queued sync operations.
- [ ] **Materialized ACL rebuild:** Often replays `access_grant_created` entries but ignores `access_grant_modified` and `access_grant_revoked` entries. All three must be replayed in order.
- [ ] **Vault close:** Often flushes pending writes but does not zero key material in memory. Verify buffers are zeroed.
- [ ] **Integrity verification:** Often checks the chain forward (entry 1 -> entry 2 -> ... -> entry N) but does not detect a truncated chain (entries deleted from the end). Store the expected entry count or last hash in a separate metadata file.
- [ ] **Entry index:** Often built correctly on write but not tested after vault close/reopen. The persisted index must survive serialization round-trips.
- [ ] **JSONL encoding:** Often works with ASCII clinical data but fails with Unicode characters in patient names, medication names, or clinical notes. Test with multi-byte UTF-8 content (e.g., accented characters, CJK characters).

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Partial write corrupts last JSONL line | LOW | Detect on next open: read last line, if JSON parse fails, truncate the partial bytes, log recovery event to audit trail. The entry that was being written is lost — the caller should retry. |
| Hash chain divergence (bad serialization) | HIGH | If caught early (in development): fix the canonical serialization, rebuild the ledger from a backup. If caught in production: the chain is permanently broken from the point of divergence. Must re-hash the entire chain from genesis with the corrected serialization, which changes all hashes — existing backups and sync copies become incompatible. Prevention is the only real strategy. |
| IV reuse detected | HIGH | Affected entries must be re-encrypted with fresh IVs under a new key. This requires reading and re-encrypting every entry that used the compromised key, updating the hash chain (since encrypted payloads change), and invalidating all backups. Practically a full vault rebuild. |
| Stale materialized ACL allowed unauthorized read | MEDIUM | The read already happened — it cannot be undone. Record the incident in the audit trail. Rebuild the ACL from ledger entries and investigate the gap. If the reader was a sync recipient, the synced data cannot be un-synced. |
| Key material exposed in memory dump | HIGH | Rotate all keys immediately (new master key, new ledger key, new identity key pair). Re-encrypt the key ring. The exposed keys can still decrypt historical entries, but new entries will be protected. If the identity key was compromised, all prior signatures are suspect — publish a key revocation event. |
| Weak scrypt parameters discovered in production vault | MEDIUM | On next vault open (which requires the passphrase), re-derive the master key with stronger parameters, re-encrypt the key ring with the new master key, update `vault.json` with new parameters. Existing entries are not affected — only the key ring encryption changes. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| AES-GCM IV reuse | Phase 2 | Unit test: encrypt N entries, assert all IVs unique. Integration test: entry_count triggers rotation. |
| Partial write / hash chain corruption | Phase 1 | Unit test: kill writer mid-append, verify recovery on next open. Integration test: write 1000 entries with simulated crashes. |
| Non-canonical JSON serialization | Phase 1 | Unit test: serialize, write, read raw bytes, verify hash. Cross-version test: serialize with sorted keys, verify determinism. |
| Signature scope mismatch | Phase 2 + Phase 3 | Round-trip test: sign -> encrypt -> write -> read -> decrypt -> verify. Negative test: tamper with encrypted payload, verify signature fails. |
| TOCTOU in access control gates | Phase 4 | Concurrent test: write entry while revoking grant simultaneously. Verify either the write is denied or the race is audited. |
| Key material in memory after close | Phase 2 + Phase 5 | Unit test: after close(), inspect key buffers, assert all zeros. |
| Weak scrypt parameters | Phase 2 | Benchmark test: derivation time must be >= 200ms. Parameter storage test: verify N, r, p, salt are in vault.json. |
| Sync not stopped on revocation | Phase 5 | Integration test: queue sync, revoke grant, verify pending sync is cancelled before delivery. |
| Entry index inconsistency after reopen | Phase 3 | Integration test: write entries, close vault, reopen, verify index matches ledger contents. |
| Materialized ACL staleness | Phase 4 | Test: create grant, modify grant, revoke grant, rebuild ACL, verify final state reflects all three operations. Test: expired grant is rejected by gate even if no expiration entry exists in ledger. |
| X25519 low-order point attack | Phase 2 | Unit test: attempt key agreement with known low-order points, verify rejection. |
| macOS fsync durability gap | Phase 1 | Platform test (darwin): write entry, fsync, verify F_FULLFSYNC is called (check via strace/dtrace or by verifying libuv behavior). |

## Sources

- [NIST: Practical Challenges with AES-GCM](https://csrc.nist.gov/csrc/media/Events/2023/third-workshop-on-block-cipher-modes-of-operation/documents/accepted-papers/Practical%20Challenges%20with%20AES-GCM.pdf) — AES-GCM nonce limits and 2^32 invocation bound (HIGH confidence)
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) — Standard for deterministic JSON serialization (HIGH confidence)
- [Node.js crypto documentation](https://nodejs.org/api/crypto.html) — scrypt defaults, Ed25519 API, timingSafeEqual usage (HIGH confidence)
- [Node.js GitHub Issue #9439: darwin fsync and F_FULLFSYNC](https://github.com/nodejs/node/issues/9439) — macOS fsync does not flush to disk (HIGH confidence)
- [Node.js GitHub Issue #1058: fs.writeFile partial write corruption](https://github.com/nodejs/node/issues/1058) — Historical partial write corruption in Node.js fs (HIGH confidence)
- [Node.js January 2026 Security Release](https://nodejs.org/en/blog/vulnerability/december-2025-security-releases) — Buffer memory exposure vulnerability (HIGH confidence)
- [Node.js GitHub Issue #18896: crypto.alloc() for key memory management](https://github.com/nodejs/node/issues/18896) — Discussion of secure memory allocation limitations in Node.js (MEDIUM confidence)
- [Soatok: Extending the AES-GCM Nonce Without Nightmare Fuel](https://soatok.blog/2022/12/21/extending-the-aes-gcm-nonce-without-nightmare-fuel/) — AES-GCM nonce management strategies (MEDIUM confidence)
- [Node.js GitHub Issue #17178: crypto.timingSafeEqual not really time safe?](https://github.com/nodejs/node/issues/17178) — Limitations of timingSafeEqual (MEDIUM confidence)
- [Monocypher X25519 manual](https://monocypher.org/manual/x25519) — X25519 pitfalls including low-order points and shared secret validation (MEDIUM confidence)
- [Darwin's Deceptive Durability](https://transactional.blog/blog/2022-darwins-deceptive-durability) — macOS fsync behavior analysis (MEDIUM confidence)
- [Evan Jones: Durability and Linux File APIs](https://www.evanjones.ca/durability-filesystem.html) — fsync/fdatasync durability guarantees (MEDIUM confidence)
- [Kurrent.io: Counterexamples in Event Sourced Consistency](https://www.kurrent.io/blog/counterexamples-regarding-consistency-in-event-sourced-solutions-part-1/) — Event sourcing materialized view race conditions (MEDIUM confidence)
- [IBM Security Bulletin: CVE-2025-46328 TOCTOU in Node.js module](https://www.ibm.com/support/pages/security-bulletin-ibm-app-connect-enterprise-vulnerable-time-check-time-use-toctou-race-condition-due-nodejs-module-snowflake-cve-2025-46328) — Real-world TOCTOU in Node.js ecosystem (MEDIUM confidence)

---
*Pitfalls research for: Encrypted, hash-chained, append-only health record vault (TypeScript/Node.js)*
*Researched: 2026-02-21*
