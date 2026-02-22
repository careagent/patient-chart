# Phase 2: Encryption & Key Management - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete cryptographic layer providing AES-256-GCM encryption/decryption, Ed25519 signing/verification, X25519 key agreement, scrypt key derivation, and a key ring with rotation — all using only node:crypto with zero external dependencies. This phase delivers the crypto primitives and key management that Phases 3-6 build upon.

</domain>

<decisions>
## Implementation Decisions

### Key storage & serialization
- Claude's Discretion: key file format (raw binary vs JSON envelope vs other) — choose what best fits the vault's JSONL patterns and downstream needs
- Claude's Discretion: encryption at rest policy (all keys encrypted vs public keys in clear) — choose based on security tradeoffs and what downstream phases need for verification
- Claude's Discretion: file layout within keys/ directory (single keyring file vs one file per key) — choose based on rotation semantics and vault file system patterns
- Claude's Discretion: audit granularity for key operations (all events vs rotation-only) — choose appropriate logging level for the security model

### Key ring behavior
- Claude's Discretion: rotation trigger mechanism (manual-only vs threshold-based) — choose what fits a library (not a service) context
- Claude's Discretion: old key retention policy (keep forever vs optional expiry) — choose based on the vault's immutability guarantees
- Claude's Discretion: key ID linkage strategy (key ID in entry vs key ring index) — choose based on JSONL ledger format and decryption pipeline needs
- Claude's Discretion: signing key rotation policy (retain old signing keys vs one identity key per actor) — choose based on the vault's identity and trust model

### Passphrase UX & derivation
- Claude's Discretion: passphrase strength enforcement (enforce minimum vs trust caller vs warn-only) — choose based on the library's role as building block vs end-user tool
- Claude's Discretion: scrypt parameter flexibility (configurable per vault vs fixed defaults) — stored in vault.json for future upgrades regardless
- Claude's Discretion: passphrase change support (include in phase 2 vs defer) — decide if it fits naturally or should be later
- Claude's Discretion: master key memory strategy (hold in session vs derive on demand) — choose based on performance vs security for a local vault

### Error & edge case policy
- Claude's Discretion: wrong passphrase handling approach — choose what fits a library's responsibility boundary
- Claude's Discretion: corrupted key file behavior (hard fail vs degrade gracefully) — choose based on the vault's integrity-first philosophy
- Claude's Discretion: error type strategy (typed error classes vs generic with codes) — choose what fits the library's TypeScript patterns
- Claude's Discretion: memory zeroing approach (active zeroing vs GC-reliant vs best-effort) — choose the pragmatic approach for Node.js

### Claude's Discretion
The user has granted full discretion across all four discussed areas. Claude should make decisions that are:
- Consistent with the vault's security-first, integrity-first, patient-sovereign design philosophy
- Appropriate for a zero-dependency TypeScript library (not a service or end-user app)
- Compatible with the immutable, append-only ledger architecture in subsequent phases
- Pragmatic for the Node.js/node:crypto runtime environment

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The user trusts Claude's judgment across all implementation decisions for this cryptographic infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-encryption-key-management*
*Context gathered: 2026-02-21*
