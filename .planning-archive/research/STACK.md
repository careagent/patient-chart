# Stack Research

**Domain:** Encrypted, append-only, hash-chained health record vault (TypeScript library)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | >=22.12.0 | Runtime | LTS with stable `node:crypto` support for Ed25519, X25519, AES-256-GCM, scrypt. Matches provider-core constraint. [HIGH] |
| TypeScript | ~5.7.x (latest 5.7.3) | Language | Pinned to match provider-core. TS 5.9.3 is current but ecosystem alignment matters more than latest. [HIGH] |
| `node:crypto` | (built-in) | All cryptography | Zero-dep AES-256-GCM, Ed25519, X25519, scrypt, SHA-256. Stability index 2 (Stable). Every algorithm this project needs is available. [HIGH] |
| `node:fs` / `node:path` | (built-in) | File I/O | Append-only JSONL writes via `appendFileSync`, file reads via `readFileSync`. No external I/O library needed. [HIGH] |

### Dev Dependencies

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `@sinclair/typebox` | ~0.34.x (latest 0.34.48) | Schema validation | Runtime JSON Schema validation with static TypeScript type inference. Zero-dep. Proven in provider-core. [HIGH] |
| `tsdown` | ~0.20.x (latest 0.20.3) | Build/bundle | Rolldown-powered bundler for libraries. ESM output, `.d.ts` generation, multiple entry points. Proven in provider-core. [HIGH] |
| `vitest` | ~4.0.x (latest 4.0.18) | Testing | Fast, Vite-powered test runner. Node.js pool runs tests with full `node:crypto` access. Proven in provider-core. [HIGH] |
| `@vitest/coverage-v8` | ~4.0.x (latest 4.0.18) | Coverage | V8-based coverage for 80% threshold enforcement. Must match vitest major version. [HIGH] |
| `typescript` | ~5.7.x (latest 5.7.3) | Type checking | Strict mode, `NodeNext` module resolution. Pinned to ecosystem version. [HIGH] |

### Runtime Dependencies

**None.** Zero runtime npm dependencies. All runtime needs served by Node.js built-ins: `node:crypto`, `node:fs`, `node:path`, `node:os`.

---

## node:crypto API Reference

All APIs below are confirmed stable in Node.js >=22.12.0 (crypto module stability index: 2).

### AES-256-GCM Encryption/Decryption

**Purpose:** Encrypt/decrypt ledger entry payloads and audit entry details.

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypt
function encrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12); // 96-bit IV (NIST-recommended for GCM)
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 128-bit auth tag (default)
  return { ciphertext, iv, authTag };
}

// Decrypt
function decrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
```

**Key details:**
- Key: 32 bytes (256 bits)
- IV: 12 bytes (96 bits) -- NIST SP 800-38D recommended length for GCM
- Auth tag: 16 bytes (128 bits) default -- do not reduce
- Never reuse (key, IV) pairs. Generate a fresh `randomBytes(12)` IV per encryption
- Store IV and auth tag alongside ciphertext (they are not secret)
- `cipher.getAuthTag()` must be called after `cipher.final()`

**Confidence:** HIGH -- `createCipheriv` added in Node.js v0.1.94, GCM mode stable for years.

### Ed25519 Digital Signatures

**Purpose:** Sign ledger entries (pre-encryption) and verify author identity.

```typescript
import { generateKeyPairSync, sign, verify } from 'node:crypto';

// Generate key pair
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

// Sign -- algorithm MUST be null for Ed25519 (it is intrinsic to the key type)
const data = Buffer.from('canonical entry JSON');
const signature = sign(null, data, privateKey);

// Verify
const isValid = verify(null, data, publicKey, signature);
```

**Key details:**
- `sign(null, data, privateKey)` -- first arg is `null`, not `'ed25519'`. Ed25519 keys self-identify their algorithm
- `verify(null, data, publicKey, signature)` -- returns `boolean`
- Keys are `KeyObject` instances. Export with `publicKey.export({ type: 'spki', format: 'der' })` for storage
- For hex/base64 storage: `publicKey.export({ type: 'spki', format: 'pem' })` or export raw bytes
- Ed25519 signatures are always 64 bytes
- No separate hashing step needed -- Ed25519 uses SHA-512 internally per RFC 8032

**Confidence:** HIGH -- Ed25519 supported via `generateKeyPairSync` since Node.js v13.9.0.

### X25519 Key Agreement

**Purpose:** Derive per-recipient shared secrets for encrypting sync payloads.

```typescript
import { generateKeyPairSync, diffieHellman } from 'node:crypto';

// Each party generates an X25519 key pair
const alice = generateKeyPairSync('x25519');
const bob = generateKeyPairSync('x25519');

// Compute shared secret (both sides produce identical output)
const sharedSecretAlice = diffieHellman({
  privateKey: alice.privateKey,
  publicKey: bob.publicKey,
});

const sharedSecretBob = diffieHellman({
  privateKey: bob.privateKey,
  publicKey: alice.publicKey,
});

// sharedSecretAlice.equals(sharedSecretBob) === true
// Use the shared secret as input to a KDF (e.g., HKDF) to derive an AES-256 key
```

**Key details:**
- `crypto.diffieHellman({ privateKey, publicKey })` -- returns a `Buffer` (shared secret)
- Both keys must have `asymmetricKeyType === 'x25519'`
- Do NOT use `crypto.createDiffieHellman()` or `crypto.createECDH()` for X25519 -- those APIs do not support X25519/X448 curves
- The raw shared secret should be passed through HKDF or SHA-256 before use as an AES key (never use raw DH output directly as an encryption key)
- For sync: vault holds its own X25519 key pair; each sync recipient's X25519 public key is stored in `SyncEndpoint.recipient_public_key`

**Confidence:** HIGH -- `crypto.diffieHellman()` added in Node.js v13.9.0, X25519 key type stable.

### scrypt Key Derivation

**Purpose:** Derive master encryption key from patient passphrase.

```typescript
import { scryptSync, randomBytes } from 'node:crypto';

// Derive key from passphrase
const salt = randomBytes(32); // Store alongside derived key metadata
const derivedKey = scryptSync(passphrase, salt, 32, {
  N: 2 ** 17,  // CPU/memory cost: 131072 (2025 recommendation for sensitive data)
  r: 8,        // Block size
  p: 1,        // Parallelization
  maxmem: 256 * 1024 * 1024, // 256 MB -- must accommodate N * r * 128 bytes
});
```

**Key details:**
- `scryptSync(password, salt, keylen, options)` -- synchronous, returns `Buffer`
- `N` must be a power of 2. Higher = slower + more memory. `2^17` (131072) is the 2025 recommendation for high-security key derivation per OWASP. `2^14` (16384) is the minimum acceptable
- `r = 8` is the standard block size
- `p = 1` unless parallelism is specifically needed
- `maxmem` default is 32 MB -- must be raised for `N > 2^14` to avoid `ERR_CRYPTO_SCRYPT_INVALID_PARAMETER`. Formula: memory = 128 * N * r bytes. For N=2^17, r=8: 128 * 131072 * 8 = 128 MB minimum
- Salt must be unique per vault. 32 bytes is recommended
- Store the salt, N, r, p parameters alongside the vault metadata so the key can be re-derived
- The async `scrypt(password, salt, keylen, options, callback)` is available but `scryptSync` is simpler for vault open/create flows

**Confidence:** HIGH -- `scryptSync` added in Node.js v10.5.0. RFC 7914 compliant.

### SHA-256 Hash Chaining

**Purpose:** Tamper-evident chain linking each JSONL entry to its predecessor.

```typescript
import { createHash } from 'node:crypto';

function hashLine(jsonLine: string): string {
  return createHash('sha256').update(jsonLine).digest('hex');
}
```

**Key details:**
- Hash the complete JSON string (post-serialization), not the parsed object
- Genesis entry has `prev_hash: null`
- Each subsequent entry stores `prev_hash = SHA-256(previous entry's JSON line)`
- Verification: read lines sequentially, compute hash of each line, compare to next entry's `prev_hash`
- This is the exact pattern used in provider-core's `AuditWriter` (see reference implementation below)

**Confidence:** HIGH -- `createHash('sha256')` stable since Node.js v0.1.92.

### randomBytes / randomUUID

**Purpose:** Generate IVs, salts, key IDs, and entry UUIDs.

```typescript
import { randomBytes, randomUUID } from 'node:crypto';

const iv = randomBytes(12);         // 96-bit IV for AES-256-GCM
const salt = randomBytes(32);       // 256-bit salt for scrypt
const keyId = randomUUID();         // UUID v4 for key ring entries
const entryId = randomUUID();       // UUID v4 for ledger entries
```

**Confidence:** HIGH -- `randomBytes` since v0.5.8, `randomUUID` since v14.17.0.

---

## TypeBox Schema Patterns

Using `@sinclair/typebox` ~0.34.x for schema validation with static TypeScript type inference.

### Import Structure

```typescript
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
```

- `Type` -- schema builder (Type.Object, Type.Union, Type.Literal, etc.)
- `Static<typeof schema>` -- extracts TypeScript type from a schema
- `Value.Check(schema, data)` -- runtime validation (returns boolean)
- `Value.Errors(schema, data)` -- returns `ValueErrorIterator` with validation error details

### Pattern: Discriminated Union for Entry Types

The 26 `LedgerEntryType` values as a TypeBox union of literals:

```typescript
export const LedgerEntryType = Type.Union([
  Type.Literal('clinical_encounter'),
  Type.Literal('clinical_medication'),
  Type.Literal('clinical_allergy'),
  Type.Literal('clinical_diagnosis'),
  Type.Literal('clinical_problem_list'),
  Type.Literal('clinical_lab_result'),
  Type.Literal('clinical_imaging_result'),
  Type.Literal('clinical_pathology'),
  Type.Literal('clinical_procedure'),
  Type.Literal('clinical_amendment'),
  Type.Literal('care_relationship_established'),
  Type.Literal('care_relationship_terminated'),
  Type.Literal('care_relationship_suspended'),
  Type.Literal('access_grant_created'),
  Type.Literal('access_grant_modified'),
  Type.Literal('access_grant_revoked'),
  Type.Literal('access_grant_expired'),
  Type.Literal('emergency_config_set'),
  Type.Literal('emergency_access_triggered'),
  Type.Literal('emergency_access_ended'),
  Type.Literal('patient_note'),
  Type.Literal('patient_directive'),
  Type.Literal('patient_preference'),
  Type.Literal('vault_initialized'),
  Type.Literal('key_rotation'),
  Type.Literal('sync_record'),
  Type.Literal('backup_record'),
]);

export type LedgerEntryTypeValue = Static<typeof LedgerEntryType>;
```

### Pattern: Nested Object with Optional Fields

For complex types like `AccessGrant` with nested `GranteeIdentity`, `AccessScope`, and optional `TimeLimits`:

```typescript
const GranteeIdentity = Type.Object({
  type: Type.Union([
    Type.Literal('provider'),
    Type.Literal('individual'),
    Type.Literal('organization'),
    Type.Literal('application'),
  ]),
  id: Type.String(),
  display_name: Type.String(),
  public_key: Type.Optional(Type.String()),
});

const AccessScope = Type.Object({
  entry_types: Type.Union([
    Type.Array(LedgerEntryType),
    Type.Literal('all'),
  ]),
  date_range: Type.Optional(Type.Object({
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
  })),
  author_filter: Type.Optional(Type.Array(Type.String())),
});

const TimeLimits = Type.Object({
  effective_from: Type.String(),
  expires_at: Type.Optional(Type.String()),
  auto_renew: Type.Boolean(),
});

const AccessGrant = Type.Object({
  grant_id: Type.String(),
  grantee: GranteeIdentity,
  role: AccessRole,
  scope: AccessScope,
  time_limits: Type.Optional(TimeLimits),
  sync: Type.Optional(SyncConfig),
});

export type AccessGrantType = Static<typeof AccessGrant>;
```

### Pattern: Hash-Chained Entry with Nullable Field

The `prev_hash` field is `string | null` -- use `Type.Union([Type.String(), Type.Null()])`:

```typescript
const LedgerEntry = Type.Object({
  id: Type.String(),
  timestamp: Type.String(),
  entry_type: LedgerEntryType,
  author: EntryAuthor,
  prev_hash: Type.Union([Type.String(), Type.Null()]),
  signature: Type.String(),
  encrypted_payload: EncryptedPayload,
  metadata: EntryMetadata,
});
```

### Pattern: Runtime Validation

```typescript
import { Value } from '@sinclair/typebox/value';

function validateEntry(data: unknown): asserts data is LedgerEntryType {
  if (!Value.Check(LedgerEntrySchema, data)) {
    const errors = [...Value.Errors(LedgerEntrySchema, data)];
    throw new Error(`Invalid ledger entry: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
  }
}
```

### Pattern: Flexible Details with Type.Record

For audit entry `details` field that accepts arbitrary key-value data:

```typescript
const details = Type.Optional(Type.Record(Type.String(), Type.Unknown()));
```

This matches provider-core's `entry-schema.ts` pattern exactly.

**Confidence:** HIGH -- patterns verified against provider-core's `entry-schema.ts` and TypeBox 0.34.x docs.

---

## tsdown Configuration

### Multi-Entry Point Library Build

For patient-chart's two exports (`.` and `./types`):

```typescript
// tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',        // Main entry: PatientChart class + all types
    'src/types/index.ts',  // Types-only entry for consumers
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
});
```

### Corresponding package.json Exports

```json
{
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./types": {
      "import": "./dist/types/index.js",
      "types": "./dist/types/index.d.ts"
    }
  },
  "engines": {
    "node": ">=22.12.0"
  }
}
```

### Key Configuration Decisions

| Setting | Value | Why |
|---------|-------|-----|
| `format` | `['esm']` | ESM-only. Node.js >=22 has full ESM support. No CJS needed for internal ecosystem package. Matches provider-core. |
| `dts` | `true` | Auto-generates `.d.ts` declaration files. Consumers get full type information. |
| `clean` | `true` | Removes `dist/` before each build. Prevents stale artifacts. |
| `sourcemap` | `true` | Source maps for debugging. |
| `external` | Not needed | No runtime dependencies to externalize. tsdown auto-externalizes `dependencies` and `peerDependencies` from package.json, but this package has none. Node built-ins (`node:crypto`, `node:fs`, etc.) are automatically treated as external. |

**Confidence:** HIGH -- configuration pattern mirrors provider-core's proven `tsdown.config.ts`.

---

## vitest Configuration

### Configuration File

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
```

### Testing Crypto Operations: Patterns

**Pattern 1: Deterministic key fixtures for reproducible tests**

Pre-generate key pairs and store them as test fixtures. Crypto key generation is non-deterministic, so tests that verify signing, encryption, and key agreement need stable keys:

```typescript
// test/fixtures/keys.ts
import { generateKeyPairSync } from 'node:crypto';

// Generate once, export for all tests. These are test-only keys.
export const patientKeys = generateKeyPairSync('ed25519');
export const providerKeys = generateKeyPairSync('ed25519');
export const syncKeys = {
  vault: generateKeyPairSync('x25519'),
  recipient: generateKeyPairSync('x25519'),
};

// For deterministic scrypt tests, use a fixed passphrase and salt
export const TEST_PASSPHRASE = 'test-vault-passphrase-do-not-use';
export const TEST_SALT = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes, fixed
```

**Pattern 2: Encrypt-decrypt round-trip tests**

```typescript
describe('AES-256-GCM', () => {
  it('encrypt then decrypt recovers original plaintext', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('patient health record data');
    const { ciphertext, iv, authTag } = encrypt(plaintext, key);
    const recovered = decrypt(ciphertext, key, iv, authTag);
    expect(recovered).toEqual(plaintext);
  });

  it('decrypt with wrong key throws', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const { ciphertext, iv, authTag } = encrypt(Buffer.from('data'), key);
    expect(() => decrypt(ciphertext, wrongKey, iv, authTag)).toThrow();
  });

  it('decrypt with tampered ciphertext throws', () => {
    const key = randomBytes(32);
    const { ciphertext, iv, authTag } = encrypt(Buffer.from('data'), key);
    ciphertext[0] ^= 0xff; // Flip one byte
    expect(() => decrypt(ciphertext, key, iv, authTag)).toThrow();
  });
});
```

**Pattern 3: Temp directory for JSONL file tests (from provider-core)**

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Ledger Writer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'patient-chart-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends entries with valid hash chain', () => {
    // Write to tmpDir, verify chain integrity
  });
});
```

**Pattern 4: Signature verification tests**

```typescript
describe('Ed25519', () => {
  it('sign then verify succeeds', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const data = Buffer.from('entry content');
    const sig = sign(null, data, privateKey);
    expect(verify(null, data, publicKey, sig)).toBe(true);
  });

  it('verify with wrong public key fails', () => {
    const keys1 = generateKeyPairSync('ed25519');
    const keys2 = generateKeyPairSync('ed25519');
    const data = Buffer.from('entry content');
    const sig = sign(null, data, keys1.privateKey);
    expect(verify(null, data, keys2.publicKey, sig)).toBe(false);
  });

  it('verify with tampered data fails', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const data = Buffer.from('entry content');
    const sig = sign(null, data, privateKey);
    expect(verify(null, Buffer.from('tampered'), publicKey, sig)).toBe(false);
  });
});
```

**Pattern 5: X25519 key agreement tests**

```typescript
describe('X25519 Key Agreement', () => {
  it('both parties derive the same shared secret', () => {
    const alice = generateKeyPairSync('x25519');
    const bob = generateKeyPairSync('x25519');
    const secretA = diffieHellman({ privateKey: alice.privateKey, publicKey: bob.publicKey });
    const secretB = diffieHellman({ privateKey: bob.privateKey, publicKey: alice.publicKey });
    expect(secretA).toEqual(secretB);
  });

  it('different key pairs produce different shared secrets', () => {
    const alice = generateKeyPairSync('x25519');
    const bob = generateKeyPairSync('x25519');
    const charlie = generateKeyPairSync('x25519');
    const secretAB = diffieHellman({ privateKey: alice.privateKey, publicKey: bob.publicKey });
    const secretAC = diffieHellman({ privateKey: alice.privateKey, publicKey: charlie.publicKey });
    expect(secretAB).not.toEqual(secretAC);
  });
});
```

**Pattern 6: scrypt determinism tests**

```typescript
describe('scrypt KDF', () => {
  it('same passphrase and salt produce identical key', () => {
    const salt = Buffer.from('fixed-test-salt-32-bytes-long!!');
    const key1 = scryptSync('passphrase', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const key2 = scryptSync('passphrase', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    expect(key1).toEqual(key2);
  });

  it('different passphrases produce different keys', () => {
    const salt = Buffer.from('fixed-test-salt-32-bytes-long!!');
    const key1 = scryptSync('passphrase1', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const key2 = scryptSync('passphrase2', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    expect(key1).not.toEqual(key2);
  });
});
```

**Important vitest note for crypto tests:** Use vitest's default `pool: 'forks'` (Node.js pool), NOT `pool: 'threads'`. The Node.js pool provides full `node:crypto` access without any polyfill issues. Do not set `environment: 'jsdom'` or `environment: 'happy-dom'` -- crypto tests must run in the Node.js environment.

**Confidence:** HIGH -- patterns derived from provider-core's audit.test.ts and standard node:crypto testing practices.

---

## JSONL File Handling Patterns

### Append-Only Write Pattern

From provider-core's `AuditWriter` -- the reference implementation for hash-chained JSONL:

```typescript
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

class LedgerWriter {
  private lastHash: string | null = null;

  constructor(private readonly filePath: string) {
    this.lastHash = this.recoverLastHash();
  }

  append(entry: Omit<LedgerEntry, 'prev_hash'>): void {
    const enriched: LedgerEntry = { ...entry, prev_hash: this.lastHash };
    const line = JSON.stringify(enriched);
    appendFileSync(this.filePath, line + '\n', { flag: 'a' });
    this.lastHash = createHash('sha256').update(line).digest('hex');
  }

  private recoverLastHash(): string | null {
    if (!existsSync(this.filePath)) return null;
    const content = readFileSync(this.filePath, 'utf-8').trimEnd();
    if (!content) return null;
    const lines = content.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1];
    if (!lastLine) return null;
    return createHash('sha256').update(lastLine).digest('hex');
  }
}
```

### Chain Verification Pattern

```typescript
verifyChain(): { valid: boolean; entries: number; brokenAt?: number; error?: string } {
  if (!existsSync(this.filePath)) return { valid: true, entries: 0 };
  const content = readFileSync(this.filePath, 'utf-8').trimEnd();
  if (!content) return { valid: true, entries: 0 };

  const lines = content.split('\n');
  let expectedPrevHash: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parsed = JSON.parse(lines[i]);
    if (parsed.prev_hash !== expectedPrevHash) {
      return { valid: false, entries: i, brokenAt: i, error: `Chain broken at entry ${i}` };
    }
    expectedPrevHash = createHash('sha256').update(lines[i]).digest('hex');
  }
  return { valid: true, entries: lines.filter(l => l.trim()).length };
}
```

### Key Decisions for JSONL Handling

| Decision | Rationale |
|----------|-----------|
| `appendFileSync` not `appendFile` | Synchronous ensures entry is flushed before returning. Audit integrity is more important than async performance. Matches provider-core. |
| `{ flag: 'a' }` | Append mode. Creates file if missing. Never truncates. |
| One JSON object per line, terminated by `\n` | Standard JSONL format. Each line is independently parseable. No multi-line entries. |
| Hash the serialized JSON string, not the object | `JSON.stringify` output is the canonical form. Hashing the string ensures byte-exact reproducibility. |
| `readFileSync` for chain recovery on startup | Read entire file to find last hash. For patient vault sizes (thousands, not millions of entries), this is acceptable. |
| Trailing `\n` after every entry | Ensures clean line separation. `trimEnd()` on read handles any trailing whitespace. |

**Confidence:** HIGH -- exact pattern from provider-core's proven `AuditWriter`.

---

## Installation

```bash
# Initialize project
pnpm init

# Dev dependencies only -- zero runtime deps
pnpm add -D typescript@~5.7.0 tsdown@~0.20.0 vitest@~4.0.0 @vitest/coverage-v8@~4.0.0 @sinclair/typebox@~0.34.0
```

### package.json Scripts

```json
{
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
```

Mirrors provider-core's `package.json` scripts exactly.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@sinclair/typebox` ~0.34.x | `typebox` 1.1.0 (new package name) | TypeBox 1.0 was released under the new `typebox` package name. 0.34.x types are forward-compatible with 1.0. However, provider-core uses `@sinclair/typebox` ~0.34.x, so patient-chart should match for ecosystem consistency. Migrate to `typebox` 1.x when the ecosystem migrates together. |
| `@sinclair/typebox` ~0.34.x | `zod` 4.x | Zod is popular but adds a runtime dependency. TypeBox is zero-dep, produces standard JSON Schema, and is already the ecosystem choice. |
| `node:crypto` built-in | `tweetnacl`, `libsodium-wrappers` | External crypto libraries add runtime dependencies. `node:crypto` covers every algorithm we need (AES-256-GCM, Ed25519, X25519, scrypt, SHA-256) with FIPS-compliant OpenSSL backing. Only consider external libs if targeting browsers (we are not). |
| `tsdown` ~0.20.x | `tsup` ~8.x | tsup is the predecessor. tsdown is the successor from the same team (VoidZero), built on Rolldown (Rust). Faster builds, same config API. Ecosystem is on tsdown. |
| `tsdown` ~0.20.x | `tsc` (TypeScript compiler) | tsc emits correct output but does not bundle, tree-shake, or handle multiple entry points cleanly. tsdown does all of these with zero config. |
| `vitest` ~4.0.x | `jest` ~30.x | Jest requires more configuration for ESM, TypeScript, and node:crypto. Vitest is ESM-native, TypeScript-native, and faster. Ecosystem standard. |
| `appendFileSync` | Streaming writes (`createWriteStream`) | Streaming is better for high-throughput scenarios (millions of entries/second). For a patient vault (hundreds of entries per session), sync append is simpler and guarantees flush-on-return. If performance becomes an issue at scale, switch to buffered async writes. |
| TypeScript ~5.7.x | TypeScript ~5.9.x (latest) | 5.9.3 is the latest release. However, provider-core pins ~5.7.x. Ecosystem alignment prevents `tsc` behavior discrepancies across packages. Update when the whole ecosystem updates. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **External crypto libraries** (`tweetnacl`, `libsodium-wrappers`, `crypto-js`, `noble-ed25519`) | Adds runtime dependencies. Violates zero-dep constraint. `node:crypto` provides everything needed with OpenSSL backing. External libs are for browser targets. | `node:crypto` for all cryptographic operations |
| **Database drivers** (`better-sqlite3`, `pg`, `level`) | Adds runtime dependency. Hash-chained JSONL is the storage layer by design. Databases add complexity, attack surface, and dependency management. | `node:fs` + JSONL files |
| **`crypto.createECDH()` for X25519** | `createECDH` does not support X25519/X448 curves. It only works with standard NIST curves (secp256k1, secp384r1, etc.). | `crypto.diffieHellman({ privateKey, publicKey })` with X25519 `KeyObject` instances |
| **`crypto.createSign()` / `crypto.createVerify()` for Ed25519** | These streaming APIs work but are unnecessarily verbose for Ed25519 which does not use a separate hash step. | `crypto.sign(null, data, key)` and `crypto.verify(null, data, key, sig)` -- the one-shot APIs are cleaner |
| **`node:crypto` webcrypto (`crypto.subtle`)** | The Web Crypto API in Node.js is less ergonomic for server-side use. Requires `await` for every operation. Does not support scrypt. `KeyObject` is easier to serialize/export than `CryptoKey`. | `node:crypto` top-level APIs (`createCipheriv`, `sign`, `verify`, `generateKeyPairSync`, etc.) |
| **External UUID libraries** (`uuid`, `nanoid`) | Adds runtime dependency. `crypto.randomUUID()` is built into Node.js >=14.17.0 and generates RFC 4122 v4 UUIDs. | `crypto.randomUUID()` |
| **JSON schema validators** (`ajv`) | Adds runtime dependency. TypeBox's `Value.Check()` and `Value.Errors()` provide built-in validation. TypeBox schemas ARE JSON Schema objects, so ajv is redundant. | `@sinclair/typebox/value` for validation |
| **`environment: 'jsdom'` in vitest** | jsdom does not provide real `node:crypto`. Tests using `createCipheriv`, `sign`, `generateKeyPairSync` etc. will fail or require polyfills. | Default Node.js environment (`pool: 'forks'`) |
| **`fs.promises` for append operations** | Async file append does not guarantee ordering when multiple writes are in-flight. The sync `appendFileSync` pattern ensures each entry is fully written before the next begins, preserving hash chain integrity. | `appendFileSync` with `{ flag: 'a' }` |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `tsdown@~0.20.x` | Node.js >=20.19 | tsdown requires Node.js 20.19+. Our constraint of >=22.12.0 satisfies this. |
| `vitest@~4.0.x` | Node.js >=20.0, Vite >=6.0 | Vitest 4.0 requires Vite 6+ (pulled as dependency). Our Node constraint satisfies. |
| `@vitest/coverage-v8@~4.0.x` | `vitest@~4.0.x` | Must match vitest major version. Pin with same `~4.0.x` range. |
| `@sinclair/typebox@~0.34.x` | TypeScript >=4.0 | No Node.js version constraint. Works with any TS version. |
| `typescript@~5.7.x` | Node.js >=14.17 | No issues with Node.js 22. |
| `node:crypto` Ed25519/X25519 | Node.js >=13.9.0 | `generateKeyPairSync('ed25519')`, `sign(null,...)`, `verify(null,...)`, `diffieHellman()` all available. |
| `node:crypto` scrypt | Node.js >=10.5.0 | `scryptSync` stable. |
| `node:crypto` AES-256-GCM | Node.js >=0.1.94 | `createCipheriv('aes-256-gcm',...)` has existed since early Node.js. |
| `crypto.randomUUID()` | Node.js >=14.17.0 | Stable. Returns RFC 4122 v4 UUID string. |

---

## Key Encoding & Storage Patterns

### Storing KeyObjects for Persistence

`KeyObject` instances cannot be directly serialized to JSON. Export them for storage:

```typescript
// Export for storage (PEM format, human-readable)
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Export as DER (binary, more compact, base64-encode for JSON storage)
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });

// Re-import from PEM
import { createPublicKey, createPrivateKey } from 'node:crypto';
const restored = createPublicKey(publicKeyPem);

// Re-import from DER
const restoredFromDer = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
```

**Recommendation:** Use DER format with base64 encoding for JSON storage (compact, unambiguous). Use PEM for human-readable contexts (debugging, config files).

### Base64 Encoding Convention

For the `EncryptedPayload` interface (`ciphertext`, `iv`, `auth_tag` as base64 strings):

```typescript
// Encode
const ciphertextB64 = ciphertext.toString('base64');
const ivB64 = iv.toString('base64');
const authTagB64 = authTag.toString('base64');

// Decode
const ciphertext = Buffer.from(ciphertextB64, 'base64');
const iv = Buffer.from(ivB64, 'base64');
const authTag = Buffer.from(authTagB64, 'base64');
```

---

## Sources

- [Node.js v25.6.1 Crypto Documentation](https://nodejs.org/api/crypto.html) -- API signatures for all crypto functions [HIGH]
- [tsdown Official Documentation](https://tsdown.dev/guide/) -- Configuration, entry points, dependencies [HIGH]
- [tsdown Entry Options](https://tsdown.dev/options/entry) -- Multiple entry point configuration [HIGH]
- [tsdown Dependencies](https://tsdown.dev/options/dependencies) -- External/bundle behavior [HIGH]
- [Vitest 4.0 Release Blog](https://vitest.dev/blog/vitest-4) -- Breaking changes, new features [HIGH]
- [TypeBox GitHub Repository](https://github.com/sinclairzx81/typebox) -- API reference, schema patterns [HIGH]
- [TypeBox npm (@sinclair/typebox)](https://www.npmjs.com/package/@sinclair/typebox) -- Version 0.34.48 confirmed [HIGH]
- [Node.js GitHub Issue #44317](https://github.com/nodejs/node/issues/44317) -- X25519 key agreement via `crypto.diffieHellman()` [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/src/audit/writer.ts` -- Hash-chained JSONL pattern [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/src/audit/entry-schema.ts` -- TypeBox schema pattern [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/package.json` -- Package structure [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/tsdown.config.ts` -- Build config [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/vitest.config.ts` -- Test config [HIGH]
- Provider-core reference: `/Users/medomatic/Documents/Projects/provider-core/test/integration/audit.test.ts` -- Crypto test patterns [HIGH]
- npm registry (local `npm view`) -- Version verification for all packages [HIGH]

---
*Stack research for: Encrypted append-only hash-chained health record vault (TypeScript/Node.js)*
*Researched: 2026-02-21*
