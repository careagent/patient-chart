# @careagent/patient-chart

> Source: [github.com/careagent/patient-chart](https://github.com/careagent/patient-chart)

Patient-sovereign, encrypted, append-only health record vault. A TypeScript library that stores a patient's complete longitudinal health record as an immutable, hash-chained, encrypted ledger on their local machine. Part of the CareAgent ecosystem.

## Why

Traditional healthcare keeps patient records within provider-controlled systems. This project inverts that model — the record resides with the patient, providers access it through granted credentials, and the patient maintains read control. No entity can alter or delete existing entries.

## Features

- **Encrypted vault** — AES-256-GCM with scrypt key derivation
- **Key management** — Rotatable key ring with historical retention
- **Digital signatures** — Ed25519 for ledger tamper-proofing
- **Key agreement** — X25519 Diffie-Hellman for encrypted sync
- **Immutable audit trail** — Hash-chained JSONL with integrity verification
- **Self-contained** — Uses only Node.js built-in crypto and fs modules with no external service dependencies
- **Programmatic API only** — Library-based, no HTTP exposure

## Installation

```bash
pnpm add @careagent/patient-chart
```

Requires Node.js >= 22.12.0.

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | ~5.7 | Language |
| Node.js | >=22.12.0 | Runtime |
| pnpm | latest | Package manager |
| vitest | ~4.0 | Testing |
| tsdown | ~0.20 | Build (ESM) |
| @sinclair/typebox | ~0.34 | Schema validation |

## Development

```bash
git clone https://github.com/careagent/patient-chart
cd patient-chart
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

Apache 2.0
