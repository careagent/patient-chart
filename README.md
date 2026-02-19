# @careagent/patient-chart

**The patient's complete, locally-held, encrypted, longitudinal health record.**

@careagent/patient-chart is the Patient Chart vault — a sovereign, independently persistent data store that lives on the patient's local machine and outlives any application that reads from or writes to it. It is not part of the CareAgent. It is not a feature of OpenClaw. It is the permanent record of truth at the foundation of the CareAgent ecosystem.

---

## The Irreducible Risk Hypothesis

> *The assumption of risk by a licensed provider is the irreducible and non-delegable foundation of clinical practice. While all clinical actions may be delegated to agents acting under provider authority, the risk associated with those actions cannot be transferred. Therefore, AI can only be fully realized in healthcare through a provider-owned model in which the agent, as an extension of the provider, is credentialed and insured through the same mechanisms that govern said provider.*

The Patient Chart is the direct architectural consequence of this principle. If providers bear personal liability for their agents' actions, and patients own their own health data, the record cannot live on provider infrastructure. It lives with the patient — permanently, structurally, and by design.

---

## What This Package Does

@careagent/patient-chart is a pnpm package that provides the encrypted, append-only vault and local API that the patient CareAgent and authorized applications use to read from and write to the patient's clinical record.

It:

- Maintains the patient's complete longitudinal health record as an immutable, append-only ledger
- Enforces write access — only credentialed provider CareAgents with established, consented relationships can write clinical entries
- Enforces read access — governed by the patient's access control list
- Drives the authorized access sync engine — propagating new entries to authorized recipients automatically
- Manages the break-glass emergency access protocol configured by the patient
- Logs every access event, write event, sync event, and blocked action in an immutable audit record

The patient's CareAgent (@careagent/patient-core) is the primary interface to the vault. But the vault exists and is accessible independently of whether the CareAgent is running.

---

## Core Principle: The Record Belongs to the Patient

In traditional healthcare, the patient's clinical record lives inside a hospital system or EMR controlled by the provider. The patient has limited access, limited control, and no ability to take their complete record with them.

@careagent/patient-chart inverts this entirely. The record lives with the patient. Providers write to it through credentialed access the patient grants. The patient controls who else can read it. No provider, no organization, and no infrastructure layer can alter or delete what has been written.

---

## Architecture

### The Vault Is Independent of the CareAgent

The CareAgent is a reasoning and communication layer. The Patient Chart is the persistent record of truth. These are distinct responsibilities and must not be conflated — if the CareAgent needs to be updated, reinstalled, or replaced, the patient's complete clinical record must not be at risk.

The vault is initialized during patient onboarding and persists independently. The patient's CareAgent reads from and writes to it through the local API. Any other authorized application does the same.

### Immutability

The Patient Chart is an append-only, immutable ledger. Clinical data can be added and amended, but it cannot be deleted or altered. Every entry is:

- Timestamped at the moment of writing
- Cryptographically signed by the writing agent's identity
- Chained to the previous entry (hash chaining)
- Permanently retained regardless of relationship status

Neither the provider nor the patient can alter the narrative after the fact. The record is tamper-proof and legally defensible.

> **Dev platform note:** Cryptographic integrity, hash chaining, and digital signatures are architected for but not fully hardened in the current dev phase. The append-only data model and logging patterns are established now. Production hardening is a future requirement.

### Write Access

Only credentialed provider CareAgents with established, consented relationships can write clinical entries to the Patient Chart. Write access is:

- Granted explicitly by the patient at the time the care relationship is established
- Stored in the Patient Chart care network record
- Scoped to the relationship — a specialist writes only to entries within their scope
- Revocable by the patient at any time, immediately terminating the provider's write access

The patient's own CareAgent also has write access — for onboarding data, access grant management, emergency access configuration, and audit log entries.

No other entity has write access. Not the Neuron. Not Axon. Not any third-party application.

### Read Access

Read access is governed by the patient's access control list:

- **Patient's CareAgent** — full read access at all times
- **Authorized individuals** — family members, caregivers, legal counsel, healthcare power of attorney — granted read access by the patient with defined scope and optional time limits
- **Authorized organizations** — insurance companies, long-term care facilities, or others granted structured read access by the patient
- **Third-party applications** — authorized applications on the patient's local machine can read through the local API with patient-granted access
- **Emergency access** — break-glass protocol grants defined parties read access when the patient is incapacitated

Every access event is logged in the vault's audit record.

### The Local API

The Patient Chart exposes a local API consumed by:

- The patient's CareAgent (@careagent/patient-core)
- Authorized third-party patient-facing applications
- Emergency access interfaces

The API is read/write for credentialed agents, read-only for authorized access grant recipients, and strictly enforces the access control list on every request. See `docs/api.md` for the full API reference.

---

## Installation

The Patient Chart vault is initialized during patient onboarding via @careagent/patient-core:

```bash
careagent init
```

This creates the encrypted vault at the configured local path, initializes the append-only ledger, writes the patient's onboarding data, and registers the vault location in `CANS.md`.

---

## Local Development

This project uses [pnpm](https://pnpm.io) as its package manager.

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Clone and install dependencies
git clone https://github.com/careagent/patient-chart
cd patient-chart
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```

> **Dev platform note:** All development uses synthetic data. No real patient data or PHI is used at this stage.

---

## CLI Commands

The Patient Chart vault is managed through the @careagent/patient-core CLI:

```bash
careagent init              # Initialize the vault during patient onboarding
careagent status            # Show vault status, sync status, access grant summary
```

Direct vault commands:

```bash
careagent chart status      # Vault integrity status and entry count
careagent chart backup      # Trigger a manual backup to configured destinations
careagent chart access      # List active access grants and sync status
```

---

## What the Patient Chart Contains

The Patient Chart is the patient's complete longitudinal health record:

- All clinical encounter documentation written by credentialed provider CareAgents
- Medications, allergies, diagnoses, problem lists
- Imaging results, laboratory results, pathology reports
- Surgical and procedural history
- The care network record — all provider and organization relationships, consent grants, relationship establishment and termination events
- The access control list — all authorized individuals and organizations, their permission levels, sync configurations, and revocation history
- Emergency access configuration — the break-glass protocol configured by the patient
- All `AUDIT.log` entries from the patient's CareAgent

---

## Authorized Access Sync

When the patient grants read-only access to an individual or organization, the grant is a living view — not a one-time snapshot. The vault drives a sync engine that propagates new entries to all authorized recipients automatically.

Sync behavior:

- Every new entry written to the vault triggers a sync check against the active access list
- Updates are propagated to each authorized recipient according to their sync configuration
- Every sync event is recorded in the vault's audit log
- If a recipient is unreachable, updates queue and retry when connectivity restores
- When access is revoked, sync stops immediately — no new entries propagate after revocation

Recipients retain what they already hold at the time of revocation. The immutable record of what was shared and when is always present in the audit log.

---

## Backup

Because the Patient Chart is a discrete, encrypted, portable artifact, the patient controls their backup strategy entirely:

- **Local backup** — external drive, NAS, home server
- **Personal cloud storage** — encrypted backup to iCloud, Google Drive, Dropbox, or any storage the patient trusts. The vault is encrypted before it leaves the device; the storage provider never sees the contents.
- **Distributed storage** — IPFS or similar decentralized storage where the patient holds the keys
- **Trusted person** — an encrypted copy held by a trusted individual or executor for emergency or end-of-life access
- **Organization backup** — a patient may opt in to give a trusted organization's Neuron a backup copy. Always opt-in, never a default.

The patient's CareAgent manages the backup schedule and reports sync status through `careagent status`.

---

## Emergency Access

The Patient Chart includes a configurable break-glass emergency access protocol defined by the patient in advance:

- **Who** is authorized to trigger emergency access
- **How** to authenticate the break-glass request
- **Where** the break-glass credentials are held — a backup location, a trusted person, or a designated Neuron
- **Scope and time limits** of emergency access

When triggered, authorized parties can read the Patient Chart without the patient's active CareAgent participation. Every emergency access event is logged with full detail — who triggered it, when, what was accessed, and for how long.

---

## Relationship to the Ecosystem

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

---

## Repository Structure

```
careagent/patient-chart/
├── src/
│   ├── index.ts              # Vault entry point and local API
│   ├── ledger/               # Append-only immutable ledger implementation
│   ├── encryption/           # Vault encryption and key management
│   ├── access/               # Access control list enforcement
│   ├── sync/                 # Authorized access sync engine
│   ├── backup/               # Backup management and scheduling
│   ├── emergency/            # Break-glass emergency access protocol
│   └── audit/                # Vault-level audit logging
├── test/                     # Test suites
├── docs/
│   ├── api.md                # Full local API reference
│   ├── architecture.md       # Vault architecture and data model
│   └── backup.md             # Backup options and configuration
└── package.json              # pnpm package
```

---

## Contributing

CareAgent is released under Apache 2.0. Contributions are welcome from clinicians, developers, patient advocates, and anyone committed to building trustworthy clinical AI infrastructure.

Before contributing, read the architecture guide in `docs/architecture.md` and the contribution guidelines in `CONTRIBUTING.md`.

---

## Related Repositories

| Repository | Purpose |
|-----------|---------|
| [careagent/patient-core](https://github.com/careagent/patient-core) | Patient-side CareAgent plugin — primary interface to the vault |
| [careagent/provider-core](https://github.com/careagent/provider-core) | Provider-side CareAgent plugin — writes to the vault via credentialed access |
| [careagent/neuron](https://github.com/careagent/neuron) | Organization-level Axon node — optional authorized sync endpoint |
| [careagent/axon](https://github.com/careagent/axon) | Open foundation network layer and protocol |
| [careagent/patient-skills](https://github.com/careagent/patient-skills) | Patient clinical skills registry |

---

## License

Apache 2.0. See [LICENSE](LICENSE).

The patient's permanent, sovereign ownership of their own health record is not a policy decision — it is a structural property of this architecture. Every line of code in this repository is open, auditable, and improvable by the community it serves.
