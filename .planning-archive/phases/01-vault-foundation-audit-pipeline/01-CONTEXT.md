# Phase 1: Vault Foundation & Audit Pipeline - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Buildable, testable TypeScript package with vault directory creation, hash-chained audit writer, and chain integrity verification. Establishes the canonical JSONL append pattern that every subsequent component inherits. No encryption, no access control, no ledger — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### Project scaffold
- Match patient-core conventions exactly: Node >=22.12.0, ES2023 target, ESM (`"type": "module"`), NodeNext module resolution
- Apache-2.0 license
- vitest for testing, tsdown for building, TypeScript ~5.7
- Zero runtime npm dependencies — devDependencies only
- Strict TypeScript (same tsconfig strictness as patient-core)
- patient-core is the sole code consumer of patient-chart; all other access (surrogates, providers, family) flows through the grant system in Phase 4, not through direct code imports

### Vault location & storage model
- The vault lives outside of any agent — on the patient's own device/storage, treated as a separate "disc"
- Path is always provided externally by the caller (PatientChart.create(path), PatientChart.open(path))
- The library can discover mounted vaults by scanning for vault.json files (discovery capability)
- The library never assumes or creates a default storage location

### Vault metadata (vault.json)
- UUIDv7 for vault identifier (time-sortable, embeds creation timestamp)
- Contains: vault UUID, schema version, creation timestamp
- Patient identity in vault.json at Claude's discretion (security model consideration)

### Audit timestamps
- ISO 8601 with millisecond precision: "2026-02-21T14:30:00.123Z"
- Consistent across audit and ledger (establishes the convention for all phases)

### Non-blocking audit — failure handling
- Audit write failures surface via optional error callback (onAuditError). If no handler registered, failures are silently swallowed.
- On failure: retry once, then drop the entry
- When an entry is dropped, insert an `audit_gap` marker entry noting the missing event type and timestamp — chain stays intact, gap is explicitly visible
- Audit failures never block or delay vault operations

### Claude's Discretion
- Export structure and entry point design (technical packaging)
- Actor identity model for Phase 1 bootstrapping (before access control exists)
- Whether to define all 38 event types upfront or only Phase 1 types (type evolution strategy)
- Audit entry metadata typing approach (strict per-event vs flexible record)
- Audit write mode (synchronous vs buffered) — durability vs performance tradeoff
- Linting/formatting tooling setup
- vault.json patient identity field approach

</decisions>

<specifics>
## Specific Ideas

- "The vault needs to live outside of the care agent and personal agent completely — as a separate 'disc' on the patient's personal computer or phone or hard drive"
- patient-core is the only code consumer; the architecture is patient-sovereign where the patient controls who accesses their vault through grants
- Discovery of mounted vaults (scanning for vault.json) should be a capability of the library

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-vault-foundation-audit-pipeline*
*Context gathered: 2026-02-21*
