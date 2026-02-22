# @careagent/patient-chart

Patient-sovereign, encrypted, append-only health record vault. A TypeScript library that stores a patient's complete longitudinal health record as an immutable, hash-chained, encrypted ledger on their local machine.

Part of the [CareAgent](https://github.com/careagent) ecosystem.

## Why

In traditional healthcare, the patient's record lives inside hospital systems controlled by providers. The patient has limited access, limited control, and no portability.

**patient-chart** inverts this. The record lives with the patient. Providers write to it through credentialed access the patient grants. The patient controls who can read it. No provider, organization, or infrastructure layer can alter or delete what has been written.

## Features

- **Encrypted vault** — AES-256-GCM encryption with scrypt key derivation from a patient passphrase
- **Key management** — Rotatable key ring with historical key retention for decrypting old entries
- **Digital signatures** — Ed25519 signing/verification for tamper-proof ledger integrity
- **Key agreement** — X25519 Diffie-Hellman for per-recipient encrypted sync payloads
- **Immutable audit trail** — Hash-chained JSONL audit log with integrity verification
- **Zero runtime dependencies** — All crypto via `node:crypto`, all I/O via `node:fs`
- **Programmatic API only** — No HTTP, no network surface. Consumed as a library by `@careagent/patient-core` and authorized applications

## Install

```bash
pnpm add @careagent/patient-chart
```

Requires Node.js >= 22.12.0.

## Usage

```typescript
import {
  // Vault
  createVault, discoverVault,

  // Encryption
  encrypt, decrypt,
  deriveMasterKey, deriveSubKey, generateSalt, DEFAULT_KDF_PARAMS,
  KeyRing,

  // Signing
  generateEd25519KeyPair, sign, verifySignature,

  // Key agreement
  generateX25519KeyPair, computeSharedSecret,
} from '@careagent/patient-chart';
```

## Development

```bash
git clone https://github.com/careagent/patient-chart
cd patient-chart
pnpm install

pnpm test        # Run tests with coverage
pnpm typecheck   # Type-check without emitting
pnpm build       # Build to dist/
```

## Project Structure

```
src/
  index.ts            # Package entry point (barrel exports)
  vault/              # Vault creation and discovery
  encryption/         # AES-256-GCM, Ed25519, X25519, KDF, KeyRing
  audit/              # Hash-chained JSONL audit pipeline
  types/              # TypeBox schemas and TypeScript types
  util/               # UUIDv7 generation
test/
  unit/               # Unit tests (vitest)
```

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | ~5.7 | Language |
| Node.js | >=22.12.0 | Runtime |
| pnpm | latest | Package manager |
| vitest | ~4.0 | Testing |
| tsdown | ~0.20 | Build (ESM) |
| @sinclair/typebox | ~0.34 | Runtime schema validation |

## Roadmap

- [x] **Phase 1** — Vault foundation and audit pipeline
- [x] **Phase 2** — Encryption and key management
- [ ] **Phase 3** — Immutable ledger (hash-chained, encrypted, signed entries)
- [ ] **Phase 4** — Access control (ACL as ledger entries, read/write gates)
- [ ] **Phase 5** — Local API, sync engine, and emergency access
- [ ] **Phase 6** — Backup management
- [ ] **Phase 7** — Integration testing
- [ ] **Phase 8** — Documentation and release

## Related Repositories

| Repository | Purpose |
|-----------|---------|
| [@careagent/patient-core](https://github.com/careagent/patient-core) | Patient-side CareAgent — primary consumer of the vault |
| [@careagent/provider-core](https://github.com/careagent/provider-core) | Provider-side CareAgent — writes to the vault via credentialed access |
| [@careagent/axon](https://github.com/careagent/axon) | Open foundation network layer |

## License

[Apache 2.0](LICENSE)
