# Phase 2: Encryption & Key Management - Research

**Researched:** 2026-02-21
**Domain:** Cryptographic primitives (AES-256-GCM, Ed25519, X25519, scrypt), key ring management, key derivation, all via node:crypto
**Confidence:** HIGH

## Summary

Phase 2 builds the complete cryptographic layer for the patient vault. All six primitives required (AES-256-GCM encryption, Ed25519 signing, X25519 key agreement, scrypt key derivation, key ring with rotation, and zero-dependency constraint) are fully supported by Node.js 22's `node:crypto` module. Every API has been verified empirically on the project's target runtime (Node.js v22.22.0). The DER format headers for Ed25519 and X25519 are fixed-length constants, making raw key extraction deterministic. OpenSSL (underlying node:crypto) automatically rejects X25519 low-order points, satisfying the success criteria without custom validation code.

The key hierarchy follows the PRD exactly: patient passphrase -> scrypt -> master key -> HKDF -> purpose-specific keys. The key ring stores all encryption keys (active and rotated) encrypted by the master key, with each key identified by a UUIDv7 key_id that is referenced in each EncryptedPayload. Rotation creates a new key and marks the old one as rotated; historical entries remain decryptable because the key ring retains all prior keys. The Ed25519 identity key pair is generated once per vault and stored in the key ring with its private key encrypted by the master key.

**Primary recommendation:** Implement five focused modules (`src/encryption/aes.ts`, `ed25519.ts`, `x25519.ts`, `kdf.ts`, `keyring.ts`) plus TypeBox schemas in `src/types/encryption.ts`. Use DER (SPKI/PKCS8) format for key serialization -- fixed 44-byte public keys and 48-byte private keys with constant headers. Store scrypt parameters in vault.json for future upgradeability. Use HKDF to derive purpose-specific keys from the scrypt-derived master key.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
No locked decisions -- the user granted full discretion across all four discussed areas (key storage & serialization, key ring behavior, passphrase UX & derivation, error & edge case policy).

### Claude's Discretion
The user has granted full discretion across all four discussed areas. Claude should make decisions that are:
- Consistent with the vault's security-first, integrity-first, patient-sovereign design philosophy
- Appropriate for a zero-dependency TypeScript library (not a service or end-user app)
- Compatible with the immutable, append-only ledger architecture in subsequent phases
- Pragmatic for the Node.js/node:crypto runtime environment

Specific discretion areas:
- **Key storage & serialization**: key file format, encryption at rest policy, file layout within keys/ directory, audit granularity for key operations
- **Key ring behavior**: rotation trigger mechanism, old key retention policy, key ID linkage strategy, signing key rotation policy
- **Passphrase UX & derivation**: passphrase strength enforcement, scrypt parameter flexibility, passphrase change support, master key memory strategy
- **Error & edge case policy**: wrong passphrase handling, corrupted key file behavior, error type strategy, memory zeroing approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENCR-01 | AES-256-GCM encryption/decryption for ledger entry payloads using node:crypto | `crypto.createCipheriv('aes-256-gcm', key, iv)` and `crypto.createDecipheriv()` verified on Node.js 22. 256-bit key, 12-byte IV (generated internally via `crypto.randomBytes(12)`), 16-byte auth tag. Round-trip confirmed. Wrong key, wrong AAD, and tampered ciphertext all correctly throw. |
| ENCR-02 | Ed25519 key pair generation, signing, and verification using node:crypto | `crypto.generateKeyPairSync('ed25519')`, `crypto.sign(null, data, privateKey)`, `crypto.verify(null, data, publicKey, signature)` all verified. 64-byte signatures. Tampered data correctly fails verification. DER export/import round-trips successfully. |
| ENCR-03 | X25519 key agreement for per-recipient sync payload encryption | `crypto.generateKeyPairSync('x25519')` and `crypto.diffieHellman()` verified. 32-byte shared secrets. Both sides produce identical shared secret. Low-order points (all-zeros, order-2, order-4, order-8) are all rejected by OpenSSL with `ERR_OSSL_PROVIDER_FAILED_DURING_DERIVATION`. |
| ENCR-04 | scrypt key derivation from patient passphrase to master key | `crypto.scryptSync(passphrase, salt, 32, { N: 131072, r: 8, p: 1 })` verified. Deterministic. N=2^17 takes ~200ms, N=2^20 takes ~1600ms. Parameters stored in vault.json for upgradeability. |
| ENCR-05 | Key ring with rotation: new keys for new entries, old keys retained for historical decryption | KeyRing data model from PRD section 4.3 maps directly to a JSON file in `keys/keyring.json`. Active key ID tracks current encryption key. Rotated keys retained with `rotated_at` timestamp. Each EncryptedPayload includes `key_id` for lookup. |
| ENCR-06 | All cryptographic operations use only node:crypto -- zero external crypto dependencies | All APIs verified as built-in to Node.js 22: `createCipheriv`, `createDecipheriv`, `generateKeyPairSync`, `sign`, `verify`, `diffieHellman`, `scryptSync`, `hkdfSync`, `randomBytes`, `createHash`, `timingSafeEqual`. Zero npm packages needed. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:crypto | Built-in (Node.js 22) | AES-256-GCM, Ed25519, X25519, scrypt, HKDF, SHA-256, randomBytes | Zero deps; all algorithms verified on target runtime |
| node:fs | Built-in | Key ring file I/O (readFileSync, writeFileSync) | Zero deps; synchronous API matches Phase 1 patterns |
| @sinclair/typebox | ~0.34.x | TypeBox schemas for EncryptedPayload, KeyRing, KeyRecord | devDependency only; matches Phase 1 pattern for type definitions |

### Supporting (devDependencies, already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ~4.0.x | Test runner for crypto round-trip tests | `pnpm test` |
| @vitest/coverage-v8 | ~4.0.x | Coverage enforcement (80% thresholds) | `pnpm test` |
| @types/node | ^25.3.0 | Type declarations for node:crypto | Already installed from Phase 1 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DER key serialization | JWK format | JWK is more human-readable but adds JSON parsing overhead and is larger. DER is compact (44-48 bytes vs ~150 bytes for JWK), fixed-structure, and directly supported by node:crypto import/export. DER chosen for compact storage in the key ring. |
| scrypt | Argon2 (argon2 npm package) | Argon2 is newer and has memory-hardness advantages, but requires a native npm dependency. scrypt is built into node:crypto with zero deps. The PRD specifies scrypt. |
| HKDF for sub-key derivation | Direct scrypt output | HKDF provides cryptographic domain separation (different keys for different purposes from the same master). scrypt output used as the Input Keying Material for HKDF. |
| Single keyring.json | One file per key | Single file is simpler for atomic reads, matches PRD section 12.1 directory structure (`keys/keyring.json`), and avoids directory-scan complexity on load. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed from Phase 1
```

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
├── encryption/
│   ├── aes.ts            # AES-256-GCM encrypt/decrypt functions
│   ├── ed25519.ts         # Ed25519 key generation, sign, verify
│   ├── x25519.ts          # X25519 key generation, key agreement
│   ├── kdf.ts             # scrypt derivation + HKDF sub-key derivation
│   └── keyring.ts         # Key ring create, load, save, rotate
├── types/
│   └── encryption.ts      # EncryptedPayload, KeyRing, KeyRecord, KdfParams schemas
└── index.ts               # Updated with Phase 2 exports
test/
├── unit/
│   ├── aes.test.ts
│   ├── ed25519.test.ts
│   ├── x25519.test.ts
│   ├── kdf.test.ts
│   └── keyring.test.ts
```

### Pattern 1: AES-256-GCM Encrypt/Decrypt with Internal IV Generation
**What:** Encrypt plaintext with AES-256-GCM, generating a fresh 12-byte IV internally for every call. Returns an EncryptedPayload containing ciphertext, IV, auth tag, and key ID. Never accepts a caller-supplied IV.
**When to use:** Every ledger entry payload encryption (Phase 3+), key-at-rest encryption in key ring.
**Example:**
```typescript
// Source: Verified on Node.js 22.22.0 via empirical testing
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

interface EncryptedPayload {
  ciphertext: string;  // base64
  iv: string;          // base64
  auth_tag: string;    // base64
  key_id: string;
}

function encrypt(plaintext: Buffer, key: Buffer, keyId: string): EncryptedPayload {
  const iv = randomBytes(12); // 96-bit IV, generated internally -- NEVER caller-supplied
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64'),
    key_id: keyId,
  };
}

function decrypt(payload: EncryptedPayload, key: Buffer): Buffer {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
}
```

### Pattern 2: Ed25519 Sign/Verify with SignableContent
**What:** Sign a well-defined SignableContent structure (pre-encryption) and verify against the author's public key. The signing algorithm is implicit for Ed25519 (pass `null` as algorithm).
**When to use:** Every ledger entry write (Phase 3+). Sign before encrypt; verify after decrypt.
**Example:**
```typescript
// Source: Verified on Node.js 22.22.0 via empirical testing
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto';

// Generate Ed25519 key pair
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

// Sign data (algorithm is null for Ed25519 -- it uses EdDSA internally)
const data = Buffer.from(JSON.stringify(signableContent));
const signature = sign(null, data, privateKey);  // 64 bytes

// Verify
const isValid = verify(null, data, publicKey, signature);
```

### Pattern 3: X25519 Key Agreement with Low-Order Point Rejection
**What:** Generate X25519 key pairs and compute shared secrets via Diffie-Hellman. OpenSSL automatically rejects low-order public keys.
**When to use:** Phase 5 sync encryption (per-recipient payload encryption).
**Example:**
```typescript
// Source: Verified on Node.js 22.22.0 via empirical testing
import { generateKeyPairSync, diffieHellman } from 'node:crypto';

const alice = generateKeyPairSync('x25519');
const bob = generateKeyPairSync('x25519');

// Both sides compute the same shared secret
const aliceShared = diffieHellman({
  publicKey: bob.publicKey,
  privateKey: alice.privateKey,
});
const bobShared = diffieHellman({
  publicKey: alice.publicKey,
  privateKey: bob.privateKey,
});
// aliceShared.equals(bobShared) === true
// Shared secret is 32 bytes, suitable as AES-256-GCM key
```

### Pattern 4: scrypt + HKDF Key Derivation
**What:** Derive a master key from the patient passphrase using scrypt, then derive purpose-specific sub-keys using HKDF with distinct info strings.
**When to use:** Vault creation (generate master key), vault open (re-derive master key).
**Example:**
```typescript
// Source: Verified on Node.js 22.22.0 via empirical testing
import { scryptSync, hkdfSync, randomBytes } from 'node:crypto';

// Derive master key from passphrase
const salt = randomBytes(32);
const masterKey = scryptSync(passphrase, salt, 32, {
  N: 131072,  // 2^17 minimum
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
});

// Derive purpose-specific keys via HKDF
const encryptionKey = Buffer.from(
  hkdfSync('sha256', masterKey, salt, 'patient-chart:encryption', 32)
);
const keyWrappingKey = Buffer.from(
  hkdfSync('sha256', masterKey, salt, 'patient-chart:key-wrapping', 32)
);
```

### Pattern 5: DER Key Serialization
**What:** Export/import Ed25519 and X25519 keys using DER format. Fixed headers make raw key extraction deterministic.
**When to use:** Storing keys in the key ring (encrypted by master key).
**Example:**
```typescript
// Source: Verified on Node.js 22.22.0 via empirical testing
// DER headers are constant for each algorithm:
// Ed25519 SPKI (public):  302a300506032b6570032100 (12 bytes) + 32 bytes raw key = 44 bytes total
// Ed25519 PKCS8 (private): 302e020100300506032b657004220420 (16 bytes) + 32 bytes raw key = 48 bytes total
// X25519 SPKI (public):   302a300506032b656e032100 (12 bytes) + 32 bytes raw key = 44 bytes total
// X25519 PKCS8 (private):  302e020100300506032b656e04220420 (16 bytes) + 32 bytes raw key = 48 bytes total

// Export
const pubDer = publicKey.export({ type: 'spki', format: 'der' });   // 44 bytes
const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }); // 48 bytes

// Import
const reimported = createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
const reimportedPriv = createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
```

### Pattern 6: Key Ring as Encrypted JSON
**What:** The key ring is a JSON file where all sensitive key material is encrypted by the master-derived key-wrapping key before writing to disk. Public keys are stored in the clear for verification without the master key.
**When to use:** Key ring creation, loading, saving, rotation.
**Example structure on disk (`keys/keyring.json`):**
```json
{
  "active_key_id": "01953b3c-4a2e-7001-8000-000000000001",
  "keys": {
    "01953b3c-4a2e-7001-8000-000000000001": {
      "key_id": "01953b3c-4a2e-7001-8000-000000000001",
      "encrypted_key": { "ciphertext": "...", "iv": "...", "auth_tag": "...", "key_id": "master" },
      "created_at": "2026-02-21T14:30:00.123Z",
      "rotated_at": null,
      "entry_count": 0
    }
  },
  "identity": {
    "public_key": "<base64 DER>",
    "encrypted_private_key": { "ciphertext": "...", "iv": "...", "auth_tag": "...", "key_id": "master" }
  }
}
```

### Anti-Patterns to Avoid
- **Accepting caller-supplied IVs for AES-256-GCM:** IV reuse with the same key is catastrophic for GCM security. The encrypt function MUST generate a fresh 12-byte IV internally via `randomBytes(12)` on every call. Never expose an IV parameter.
- **Using CBC mode instead of GCM:** CBC provides confidentiality but not authenticity. GCM provides both (AEAD). The auth tag detects tampering. Always use GCM.
- **Signing after encryption (sign-then-encrypt):** The PRD specifies signing pre-encryption content (SignableContent). Sign the plaintext, then encrypt. This allows signature verification without decryption by downstream phases that have the public key but not the encryption key. However, for Phase 2, the primitives support either order -- the convention will be enforced in Phase 3.
- **Storing raw unencrypted private keys on disk:** All private key material must be encrypted by the master-derived key-wrapping key before persisting. Only public keys may be stored in the clear.
- **Using `createSecretKey()` for AES keys in the key ring:** While `createSecretKey` works for in-memory operations, key ring persistence requires raw Buffer/base64 representation. Use raw Buffers encrypted by the wrapping key.
- **Deriving multiple keys directly from scrypt:** Use scrypt once to get the master key, then HKDF with distinct info strings for sub-keys. This provides proper domain separation and avoids the complexity of multiple scrypt calls.
- **Hardcoding scrypt parameters:** Store N, r, p, salt, and key_length in vault.json so they can be upgraded in the future without breaking existing vaults.

## Discretion Recommendations

Research-informed recommendations for areas marked as "Claude's Discretion":

### 1. Key File Format
**Recommendation:** JSON envelope in a single `keys/keyring.json` file, matching the PRD's directory structure (section 12.1). The JSON envelope contains the key ring structure from PRD section 4.3 with all sensitive material encrypted by the master-derived key-wrapping key. This is consistent with the vault's JSONL/JSON patterns (vault.json, index.json, queue.json) and simplifies atomic reads/writes.

### 2. Encryption at Rest Policy
**Recommendation:** All private keys and symmetric keys encrypted by the master-derived key-wrapping key. Public keys (Ed25519 identity, X25519 exchange) stored in the clear. Rationale: public keys are non-secret by definition and are needed for signature verification and key agreement without the master key. Private keys and symmetric encryption keys must always be encrypted at rest.

### 3. Audit Granularity for Key Operations
**Recommendation:** Log all key events: `key_generated` (initial key creation during vault creation), `key_rotated` (rotation), `key_ring_loaded` (vault open). These three event types are already defined in Phase 1's VaultEventType enum. Rationale: in a security-critical system, a complete audit trail of key lifecycle events is essential for forensics and compliance.

### 4. Rotation Trigger Mechanism
**Recommendation:** Manual-only rotation via an explicit `rotateKey()` function. No automatic threshold-based rotation. Rationale: this is a library, not a service. The consuming application (patient-core) should decide when to rotate. The library provides the capability; the policy lives in the consumer.

### 5. Old Key Retention Policy
**Recommendation:** Keep all rotated keys forever (no expiry). Rationale: the vault is an immutable, append-only ledger. Entries encrypted with old keys must always be decryptable. Deleting a key would permanently destroy access to historical entries, violating the vault's core immutability guarantee.

### 6. Key ID Linkage Strategy
**Recommendation:** Embed the `key_id` in each `EncryptedPayload`. When decrypting, look up the key in the key ring by `key_id`. This is already specified in the PRD's `EncryptedPayload` interface (section 3.4). Simple, explicit, O(1) lookup.

### 7. Signing Key Rotation Policy
**Recommendation:** One Ed25519 identity key pair per vault, never rotated. Rationale: the identity key represents the patient's cryptographic identity. Rotating it would break the trust chain -- external parties (providers, grant recipients) verify entries against the patient's known public key. If the identity key is compromised, the patient creates a new vault (catastrophic recovery, but this is the correct security model for a sovereignty-first design). Key rotation is for encryption keys only.

### 8. Passphrase Strength Enforcement
**Recommendation:** No enforcement -- trust the caller. The library is a building block consumed by patient-core, which should implement UX-level passphrase strength guidance. Adding enforcement in the library would couple it to UX policy decisions. The library should accept any non-empty string.

### 9. Scrypt Parameter Flexibility
**Recommendation:** Configurable per vault with sensible defaults. Store the chosen parameters in vault.json so future versions can upgrade. Default: N=2^17 (131072), r=8, p=1, salt=32 random bytes. Allow the caller to override N at vault creation for stronger security (N=2^20 for high-security vaults). Minimum N=2^17 enforced.

### 10. Passphrase Change Support
**Recommendation:** Defer to a later phase. Passphrase change requires re-deriving the master key and re-encrypting the entire key ring with the new key-wrapping key. The mechanism is straightforward but adds surface area. Phase 2 should focus on the core primitives; passphrase change can be added as a key ring operation later.

### 11. Master Key Memory Strategy
**Recommendation:** Hold in memory for the vault session lifetime (between open and close). scrypt with N=2^17 takes ~200ms, which is acceptable for a one-time open operation. Re-deriving on every encrypt/decrypt would be impractical (~200ms per operation). The master key (and derived sub-keys) should be cleared from memory on vault close. Best-effort zeroing: overwrite Buffer contents with zeros before dereferencing. Node.js does not guarantee GC-proof zeroing, but zeroing before deref is still better than leaving cleartext in heap.

### 12. Wrong Passphrase Handling
**Recommendation:** Typed error class (`VaultAuthenticationError`) thrown when the key ring cannot be decrypted (AES-256-GCM auth tag failure). This gives the caller a specific error to catch and present to the user. The error message should not leak information about which byte failed -- just "authentication failed."

### 13. Corrupted Key File Behavior
**Recommendation:** Hard fail with a typed error (`KeyRingCorruptedError`). Do not attempt to recover. Rationale: the vault is integrity-first. A corrupted key ring means either the file was tampered with or there was a disk error. In either case, the correct action is to fail clearly and let the caller decide (restore from backup, re-initialize, etc.). Silent degradation would violate the vault's integrity guarantees.

### 14. Error Type Strategy
**Recommendation:** Typed error classes extending the base Error class. Create a small hierarchy:
- `CryptoError` (base) -- generic crypto operation failure
- `VaultAuthenticationError extends CryptoError` -- wrong passphrase / auth tag failure
- `KeyRingCorruptedError extends CryptoError` -- malformed or unreadable key ring
- `KeyNotFoundError extends CryptoError` -- requested key_id not in key ring
This matches TypeScript patterns (instanceof checks, specific catch blocks) and is more ergonomic than error codes for a library API.

### 15. Memory Zeroing Approach
**Recommendation:** Best-effort zeroing. Call `buffer.fill(0)` on sensitive Buffers (master key, derived keys, decrypted private keys) before dereferencing. Node.js Buffers backed by ArrayBuffer can be zeroed reliably. However, strings (passphrases) cannot be zeroed because strings are immutable in JavaScript. Document this limitation. Do not claim constant-time or GC-proof zeroing -- it is best-effort in a managed runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM encryption | Custom cipher implementation | `crypto.createCipheriv('aes-256-gcm')` | Battle-tested OpenSSL implementation; hand-rolling AES is a critical security risk |
| Ed25519 sign/verify | Custom EdDSA implementation | `crypto.sign(null, data, key)` / `crypto.verify()` | RFC 8032 implementation in OpenSSL; custom impl would introduce timing attacks |
| X25519 key agreement | Custom ECDH implementation | `crypto.diffieHellman()` | OpenSSL handles clamping, cofactor clearing, and low-order point rejection |
| scrypt key derivation | Custom KDF | `crypto.scryptSync()` | Memory-hard KDF with OS-level implementation; custom would lack memory-hardness guarantees |
| HKDF sub-key derivation | Custom key derivation | `crypto.hkdfSync()` | Standard HMAC-based KDF; available natively in Node.js 22 |
| IV generation | Custom random or counter | `crypto.randomBytes(12)` | CSPRNG seeded by OS; never use Math.random() or counters for IVs |
| Timing-safe comparison | `===` or Buffer.equals | `crypto.timingSafeEqual()` | Prevents timing side-channel attacks on auth tag or signature verification |
| Low-order point rejection | Manual X25519 point validation | OpenSSL (automatic) | Node.js 22 / OpenSSL rejects all low-order X25519 points automatically; verified empirically |

**Key insight:** Every cryptographic primitive needed for Phase 2 is available as a built-in node:crypto function. The value of this phase is in the composition layer (key ring, key lifecycle, type-safe wrappers) -- not in the crypto algorithms themselves. Never implement crypto algorithms; only compose the built-in primitives.

## Common Pitfalls

### Pitfall 1: IV Reuse in AES-256-GCM
**What goes wrong:** Reusing an IV with the same key in GCM mode leaks the XOR of two plaintexts and allows auth tag forgery.
**Why it happens:** Developer passes IV as a parameter and reuses it, or uses a deterministic IV scheme.
**How to avoid:** The encrypt function generates a fresh 12-byte IV internally via `randomBytes(12)` on every call. The IV parameter is not exposed in the function signature. This is an architectural decision, not a usage guideline.
**Warning signs:** IV parameter in the encrypt function signature; any test that passes a specific IV.

### Pitfall 2: Wrong Algorithm Parameter for Ed25519
**What goes wrong:** Passing a hash algorithm (e.g., 'sha256') to `crypto.sign()` or `crypto.verify()` with Ed25519 keys throws an error.
**Why it happens:** Ed25519 uses its own internal hashing (SHA-512) per RFC 8032. The algorithm parameter must be `null`.
**How to avoid:** Always pass `null` as the first argument: `crypto.sign(null, data, privateKey)`.
**Warning signs:** "Error: Unsupported algorithm" when signing with Ed25519.

### Pitfall 3: Forgetting to Set Auth Tag on Decrypt
**What goes wrong:** `decipher.final()` throws "Unsupported state or unable to authenticate data" because the auth tag was not set.
**Why it happens:** The auth tag must be set via `decipher.setAuthTag()` BEFORE calling `decipher.final()`.
**How to avoid:** Always call `decipher.setAuthTag(Buffer.from(payload.auth_tag, 'base64'))` before `decipher.update()` and `decipher.final()`.
**Warning signs:** Decryption always fails even with the correct key.

### Pitfall 4: scrypt maxmem Too Low
**What goes wrong:** `crypto.scryptSync()` throws "scrypt: memory limit exceeded" because the default maxmem (32 MB) is insufficient for high N values.
**Why it happens:** scrypt memory usage is approximately `128 * N * r` bytes. For N=131072, r=8, that's 128 MiB.
**How to avoid:** Always pass `maxmem: 256 * 1024 * 1024` (256 MiB) to accommodate N up to 2^20. For N=2^17 (default), memory usage is ~128 MiB.
**Warning signs:** scrypt works in tests (low N) but fails in production (high N).

### Pitfall 5: Key Ring Partial Write Corruption
**What goes wrong:** A crash during `writeFileSync` of keyring.json leaves a partially written file that cannot be parsed.
**Why it happens:** `writeFileSync` is not atomic -- it can be interrupted.
**How to avoid:** Write-then-rename pattern: write to `keyring.json.tmp`, then `renameSync()` to `keyring.json`. Rename is atomic on most filesystems (POSIX guarantee). On load, if `keyring.json` is corrupted but `keyring.json.tmp` exists, the temp file may contain valid data from a prior successful write.
**Warning signs:** JSON parse error on vault open after a crash.

### Pitfall 6: Confusing DER Header Bytes Between Ed25519 and X25519
**What goes wrong:** Importing a key with the wrong algorithm's DER header creates an invalid key object or produces incorrect signatures/agreements.
**Why it happens:** Ed25519 OID is `06032b6570` and X25519 OID is `06032b656e` -- they differ by only one byte.
**How to avoid:** Use constants for DER headers. Define `ED25519_SPKI_HEADER` and `X25519_SPKI_HEADER` as readonly Buffers. Always use the correct constant for the algorithm.
**Warning signs:** Signature verification fails on correctly signed data; key agreement produces different secrets on both sides.

### Pitfall 7: Not Validating Key Ring Integrity Before Use
**What goes wrong:** A tampered keyring.json is loaded and used, potentially with attacker-controlled keys.
**Why it happens:** The key ring file is read and trusted without validation.
**How to avoid:** The key ring is encrypted by the master-derived key-wrapping key. If the key ring has been tampered with, AES-256-GCM decryption will fail (auth tag mismatch). This provides integrity verification for free. Additionally, validate the JSON structure against the TypeBox schema after decryption.
**Warning signs:** Successful vault open with tampered keys.

### Pitfall 8: Leaking Passphrase in Error Messages
**What goes wrong:** An error message includes the passphrase or derived key material.
**Why it happens:** Default error handling stringifies the input parameters.
**How to avoid:** Custom error classes that never include sensitive material. Error messages should be generic: "Authentication failed" not "scrypt derivation with passphrase 'abc123' failed."
**Warning signs:** Passphrase visible in logs, error reports, or stack traces.

## Code Examples

Verified patterns from empirical testing on Node.js 22.22.0:

### AES-256-GCM Encrypt/Decrypt Round-Trip
```typescript
// Source: Verified empirically on Node.js 22.22.0
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const key = randomBytes(32);
const plaintext = Buffer.from('sensitive patient data');

// Encrypt (IV generated internally)
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag(); // 16 bytes

// Decrypt
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);
const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
// decrypted.equals(plaintext) === true

// Wrong key throws "Unsupported state or unable to authenticate data"
// Tampered ciphertext throws the same error
```

### Ed25519 Key Generation, Sign, Verify
```typescript
// Source: Verified empirically on Node.js 22.22.0
import { generateKeyPairSync, sign, verify } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const data = Buffer.from(JSON.stringify({ entry_type: 'clinical_encounter', content: '...' }));
const signature = sign(null, data, privateKey);  // null algorithm for Ed25519
// signature.length === 64

const valid = verify(null, data, publicKey, signature);    // true
const invalid = verify(null, Buffer.from('tampered'), publicKey, signature);  // false
```

### X25519 Key Agreement
```typescript
// Source: Verified empirically on Node.js 22.22.0
import { generateKeyPairSync, diffieHellman, createPublicKey } from 'node:crypto';

const alice = generateKeyPairSync('x25519');
const bob = generateKeyPairSync('x25519');

const sharedAlice = diffieHellman({ publicKey: bob.publicKey, privateKey: alice.privateKey });
const sharedBob = diffieHellman({ publicKey: alice.publicKey, privateKey: bob.privateKey });
// sharedAlice.equals(sharedBob) === true
// sharedAlice.length === 32 (suitable as AES-256-GCM key)

// Low-order point rejection (OpenSSL):
const allZeros = Buffer.alloc(32, 0);
const X25519_SPKI_HEADER = Buffer.from('302a300506032b656e032100', 'hex');
const evilPub = createPublicKey({
  key: Buffer.concat([X25519_SPKI_HEADER, allZeros]),
  format: 'der',
  type: 'spki',
});
// diffieHellman({ publicKey: evilPub, privateKey: alice.privateKey }) throws
// "error:1C8000A4:Provider routines::failed during derivation"
```

### scrypt Key Derivation with HKDF Sub-Keys
```typescript
// Source: Verified empirically on Node.js 22.22.0
import { scryptSync, hkdfSync, randomBytes } from 'node:crypto';

const passphrase = 'patient-passphrase';
const salt = randomBytes(32);

const masterKey = scryptSync(passphrase, salt, 32, {
  N: 131072,   // 2^17 (minimum, ~200ms on modern hardware)
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
});

// Derive purpose-specific sub-keys using HKDF
const encryptionKey = Buffer.from(hkdfSync('sha256', masterKey, salt, 'patient-chart:encryption', 32));
const keyWrappingKey = Buffer.from(hkdfSync('sha256', masterKey, salt, 'patient-chart:key-wrapping', 32));

// Deterministic: same passphrase + same salt + same params = same keys
```

### DER Key Import/Export
```typescript
// Source: Verified empirically on Node.js 22.22.0
import { generateKeyPairSync, createPublicKey, createPrivateKey } from 'node:crypto';

// DER header constants
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_HEADER = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_SPKI_HEADER = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_HEADER = Buffer.from('302e020100300506032b656e04220420', 'hex');

// Export to DER
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubDer = publicKey.export({ type: 'spki', format: 'der' });   // 44 bytes
const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }); // 48 bytes

// Extract raw 32-byte key from DER
const rawPubKey = pubDer.subarray(12);  // skip 12-byte SPKI header
const rawPrivKey = privDer.subarray(16); // skip 16-byte PKCS8 header

// Import from DER
const reimportedPub = createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
const reimportedPriv = createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
```

### Vault.json with KDF Parameters
```typescript
// vault.json structure after Phase 2 (extends Phase 1 VaultMetadata)
const vaultMetadata = {
  vault_id: '01953b3c-4a2e-7000-8000-000000000001',
  schema_version: '1',
  created_at: '2026-02-21T14:30:00.123Z',
  kdf: {
    algorithm: 'scrypt',
    N: 131072,
    r: 8,
    p: 1,
    salt: '<base64 encoded 32 bytes>',
    key_length: 32,
  },
};
```

### Typed Error Classes
```typescript
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export class VaultAuthenticationError extends CryptoError {
  constructor() {
    super('Vault authentication failed');
    this.name = 'VaultAuthenticationError';
  }
}

export class KeyRingCorruptedError extends CryptoError {
  constructor() {
    super('Key ring file is corrupted or has been tampered with');
    this.name = 'KeyRingCorruptedError';
  }
}

export class KeyNotFoundError extends CryptoError {
  constructor(keyId: string) {
    super(`Key not found in key ring: ${keyId}`);
    this.name = 'KeyNotFoundError';
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `crypto.createDiffieHellman()` | `crypto.diffieHellman()` (X25519) | Node.js 15+ | Modern ECDH with named curves; simpler API, stronger security |
| Manual HKDF implementation | `crypto.hkdfSync()` | Node.js 15+ | Built-in HKDF; no need for manual HMAC-based expansion |
| `crypto.generateKeyPairSync('ec')` | `crypto.generateKeyPairSync('ed25519')`/`'x25519'` | Node.js 12+ | First-class EdDSA/X25519 support without OpenSSL curve names |
| `crypto.scrypt()` only async | `crypto.scryptSync()` available | Node.js 10.5+ | Synchronous scrypt for simpler key derivation flow |
| PEM format for key storage | DER format (compact binary) | Always available | DER is 44-48 bytes vs ~150+ bytes for PEM; no base64 encoding overhead |

**Deprecated/outdated:**
- `crypto.createDiffieHellman()` with named groups: Use `crypto.diffieHellman()` with KeyObject inputs for X25519
- `crypto.createECDH('curve25519')`: Use `crypto.generateKeyPairSync('x25519')` + `crypto.diffieHellman()` instead
- `require('crypto').webcrypto` for Ed25519: While Web Crypto API is available, the classic `crypto.sign/verify` is more straightforward for server-side usage

## Open Questions

1. **Vault.json schema evolution for KDF parameters**
   - What we know: Phase 1's VaultMetadataSchema has three fields (vault_id, schema_version, created_at). Phase 2 needs to add a `kdf` section.
   - What's unclear: Should the VaultMetadataSchema be extended in-place, or should a new version be created?
   - Recommendation: Extend the schema in-place by adding an optional `kdf` field. Keep `schema_version: '1'` since this is an additive change. The TypeBox schema can use `Type.Optional()` for backward compatibility with existing Phase 1 test fixtures.

2. **AAD (Additional Authenticated Data) usage in AES-GCM**
   - What we know: AES-256-GCM supports optional AAD that is authenticated but not encrypted.
   - What's unclear: Should the Phase 2 encrypt function accept AAD? The PRD's EncryptedPayload does not include an AAD field. Phase 3's ledger writer may want to authenticate unencrypted metadata (entry_type, author) alongside the encrypted payload.
   - Recommendation: Include an optional `aad` parameter in the encrypt/decrypt functions for Phase 2, but do not persist AAD in the EncryptedPayload structure. The caller (Phase 3 ledger writer) can pass entry metadata as AAD when encrypting. If AAD is used, the decrypt function must receive the same AAD or decryption fails (auth tag mismatch). This provides "encrypt payload, authenticate metadata" for free.

3. **SignableContent type definition scope**
   - What we know: The success criteria specify Ed25519 "signing operating on a well-defined SignableContent type (pre-encryption scope)."
   - What's unclear: Should Phase 2 define the full SignableContent type, or just the signing primitive with a generic `Buffer` input?
   - Recommendation: Phase 2 defines the signing primitive accepting `Buffer` input. The `SignableContent` type is the concern of Phase 3 (ledger), where the exact fields to be signed are known. Phase 2's sign/verify functions should work on arbitrary Buffers, allowing Phase 3 to serialize a SignableContent to Buffer and pass it in.

## Sources

### Primary (HIGH confidence)
- Node.js 22.22.0 runtime empirical testing -- all APIs verified by executing them on the project's target Node.js version
- Node.js `node:crypto` documentation (built-in) -- `createCipheriv`, `createDecipheriv`, `generateKeyPairSync`, `sign`, `verify`, `diffieHellman`, `scryptSync`, `hkdfSync`
- patient-chart-PRD.md sections 3.4 (EncryptedPayload), 4.1-4.4 (Key Hierarchy, Key Ring, Key Rotation)
- Phase 1 codebase (src/) -- established patterns for module structure, TypeBox schemas, testing, audit pipeline integration

### Secondary (MEDIUM confidence)
- DER format analysis via empirical key export testing -- confirmed fixed 12-byte (SPKI) and 16-byte (PKCS8) headers for Ed25519/X25519
- X25519 low-order point rejection verified empirically via all-zeros, order-2, order-4, and order-8 points -- OpenSSL rejects all four
- scrypt timing benchmarks: N=2^14 ~26ms, N=2^17 ~200ms, N=2^20 ~1600ms on Apple Silicon (representative of target hardware)

### Tertiary (LOW confidence)
- None -- all findings verified via primary sources (runtime testing and official Node.js docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all APIs verified by executing on Node.js 22.22.0; zero external dependencies needed
- Architecture: HIGH -- module structure follows established Phase 1 patterns; key ring design follows PRD section 4.3
- Pitfalls: HIGH -- identified via empirical testing (IV reuse, maxmem, auth tag ordering, DER header bytes) and node:crypto documentation
- Discretion recommendations: HIGH -- grounded in security best practices, PRD specifications, and practical Node.js runtime constraints

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain -- node:crypto APIs are extremely stable; no upcoming breaking changes expected)
