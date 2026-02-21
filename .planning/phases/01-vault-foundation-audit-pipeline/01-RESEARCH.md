# Phase 1: Vault Foundation & Audit Pipeline - Research

**Researched:** 2026-02-21
**Domain:** TypeScript project scaffolding, JSONL hash-chain audit logging, vault directory structure, integrity verification
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational TypeScript package and two core capabilities: vault directory creation with metadata, and the hash-chained JSONL audit pipeline. The technical domain is well-understood because provider-core has a complete, working reference implementation of the hash-chained audit writer pattern (`AuditWriter`, `AuditPipeline`, `IntegrityService`). The patient-chart audit writer mirrors this pattern but adapts it for the vault domain (38 event types, `VaultAuditEntry` schema, non-blocking write semantics with `audit_gap` markers).

The project scaffold must match provider-core conventions exactly: Node >=22.12.0, ES2023 target, ESM with NodeNext resolution, tsdown ~0.20.x, vitest ~4.0.x, TypeBox ~0.34.x, zero runtime npm dependencies. The UUIDv7 requirement for vault identifiers requires a hand-rolled implementation since `crypto.randomUUID()` only generates v4 -- a ~20-line function using `crypto.getRandomValues()` and `Date.now()`, fully compliant with RFC 9562.

**Primary recommendation:** Copy the exact project scaffold from provider-core (package.json, tsconfig.json, tsdown.config.ts, vitest.config.ts), adapt the audit writer pattern from provider-core's `AuditWriter` class, and implement vault directory creation and metadata as a separate module. Define all 38 audit event types upfront using TypeBox schemas to establish the canonical type system from day one.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Match patient-core conventions exactly: Node >=22.12.0, ES2023 target, ESM (`"type": "module"`), NodeNext module resolution
- Apache-2.0 license
- vitest for testing, tsdown for building, TypeScript ~5.7
- Zero runtime npm dependencies -- devDependencies only
- Strict TypeScript (same tsconfig strictness as patient-core)
- patient-core is the sole code consumer of patient-chart; all other access flows through the grant system in Phase 4
- The vault lives outside of any agent -- on the patient's own device/storage, treated as a separate "disc"
- Path is always provided externally by the caller (PatientChart.create(path), PatientChart.open(path))
- The library can discover mounted vaults by scanning for vault.json files (discovery capability)
- The library never assumes or creates a default storage location
- UUIDv7 for vault identifier (time-sortable, embeds creation timestamp)
- vault.json contains: vault UUID, schema version, creation timestamp
- ISO 8601 with millisecond precision: "2026-02-21T14:30:00.123Z" for all timestamps
- Audit write failures surface via optional error callback (onAuditError). If no handler registered, failures are silently swallowed.
- On failure: retry once, then drop the entry
- When an entry is dropped, insert an `audit_gap` marker entry noting the missing event type and timestamp -- chain stays intact, gap is explicitly visible
- Audit failures never block or delay vault operations

### Claude's Discretion
- Export structure and entry point design (technical packaging)
- Actor identity model for Phase 1 bootstrapping (before access control exists)
- Whether to define all 38 event types upfront or only Phase 1 types (type evolution strategy)
- Audit entry metadata typing approach (strict per-event vs flexible record)
- Audit write mode (synchronous vs buffered) -- durability vs performance tradeoff
- Linting/formatting tooling setup
- vault.json patient identity field approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALT-01 | pnpm TypeScript project with tsdown build, vitest testing, zero runtime npm dependencies | Provider-core reference scaffold (package.json, tsconfig.json, tsdown.config.ts, vitest.config.ts) verified and documented. Exact versions confirmed: TypeScript ~5.7, tsdown ~0.20, vitest ~4.0, TypeBox ~0.34. |
| VALT-02 | Vault directory structure creation with all required subdirectories (ledger/, audit/, keys/, sync/, backup/, emergency/) | PRD section 12.1 defines exact structure. Implementation uses `node:fs` mkdirSync with `{ recursive: true }`. |
| VALT-03 | Vault metadata file (vault.json) with creation timestamp, schema version, vault UUID | UUIDv7 requires hand-rolled ~20-line implementation (no native Node.js support). TypeBox schema validates vault.json structure. |
| AUDT-01 | Hash-chained JSONL append-only audit log with SHA-256 chain from genesis | Provider-core's `AuditWriter` is the direct reference implementation. Pattern: `appendFileSync(path, JSON.stringify(entry) + '\n')`, hash = `createHash('sha256').update(line).digest('hex')`. |
| AUDT-02 | 38 vault event types covering lifecycle, ledger, access, write gate, read gate, sync, emergency, keys, and backup | PRD section 3.9 defines all 38 `VaultEventType` values. TypeBox `Type.Union([Type.Literal(...)])` pattern from provider-core entry-schema.ts. |
| AUDT-03 | Every vault operation generates an audit event | In Phase 1, only vault lifecycle events are operational (vault_created, vault_opened, vault_closed, vault_integrity_checked/failed). The type system defines all 38 for forward compatibility; actual event emission for other categories comes in later phases. |
| AUDT-04 | Audit chain integrity verification detects any tampering | Provider-core's `verifyChain()` method is the direct reference. Detects: inserted entries (hash mismatch), modified entries (hash mismatch), deleted entries (hash mismatch), malformed JSON, genesis entry with non-null prev_hash. |
| AUDT-05 | Audit never blocks vault operations (audit write failures do not prevent ledger writes) | Non-blocking pattern: try/catch around append, retry once, drop on second failure, insert `audit_gap` marker, surface error via optional `onAuditError` callback. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.7.x | Language | Matches provider-core; strict mode with all `no*` checks enabled |
| node:crypto | Built-in | SHA-256 hashing, randomBytes for UUIDv7 | Zero deps; `createHash('sha256')` for chain hashing |
| node:fs | Built-in | File I/O (appendFileSync, readFileSync, mkdirSync, existsSync, writeFileSync) | Zero deps; synchronous API for atomic append |
| node:path | Built-in | Path manipulation | Zero deps |
| @sinclair/typebox | ~0.34.x | TypeBox schema definitions for VaultAuditEntry, VaultEventType, AuditActor, vault.json | devDependency only; runtime validation via `Value.Check()` |

### Supporting (devDependencies)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsdown | ~0.20.x | ESM build with .d.ts generation | `pnpm build` -- produces dist/ with ESM + declaration files |
| vitest | ~4.0.x | Test runner | `pnpm test` -- globals enabled, test/**/*.test.ts pattern |
| @vitest/coverage-v8 | ~4.0.x | Code coverage | 80% thresholds on lines, branches, functions, statements |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled UUIDv7 | `uuid` npm package | Would add a runtime dependency; violates zero-deps constraint. Hand-rolling is ~20 lines. |
| appendFileSync | async appendFile | Sync is simpler for hash-chain integrity (no interleaving risk). Provider-core uses sync. Performance is not a concern at audit-write volume. |
| TypeBox | Zod | TypeBox is already established in the ecosystem (provider-core uses it). Both are devDependencies, but consistency matters. |

**Installation:**
```bash
pnpm add -D typescript@~5.7.0 tsdown@~0.20.0 vitest@~4.0.0 @vitest/coverage-v8@~4.0.0 @sinclair/typebox@~0.34.0
```

## Architecture Patterns

### Recommended Project Structure (Phase 1 only)
```
src/
├── index.ts               # Package entry point -- re-exports public API
├── vault/
│   ├── create.ts           # Vault directory creation + vault.json writing
│   ├── discover.ts         # Vault discovery (scan for vault.json files)
│   └── schema.ts           # TypeBox schemas for vault.json
├── audit/
│   ├── writer.ts           # Hash-chained JSONL audit writer (mirrors provider-core)
│   ├── integrity.ts        # Audit chain verification
│   └── schema.ts           # TypeBox schemas for VaultAuditEntry, VaultEventType, AuditActor
├── types/
│   ├── index.ts            # Re-exports all public types
│   ├── audit.ts            # VaultAuditEntry, VaultEventType, AuditActor type definitions
│   └── vault.ts            # VaultMetadata type definition
└── util/
    └── uuidv7.ts           # UUIDv7 generation (hand-rolled, zero deps)
test/
├── unit/
│   ├── audit-writer.test.ts
│   ├── audit-integrity.test.ts
│   ├── vault-create.test.ts
│   ├── vault-discover.test.ts
│   └── uuidv7.test.ts
└── fixtures/
    └── (test data files)
```

### Pattern 1: Hash-Chained JSONL Append (from provider-core)
**What:** Each audit entry contains a `prev_hash` field that is the SHA-256 hex digest of the previous line's raw JSON string. Genesis entry has `prev_hash: null`.
**When to use:** Every audit write operation.
**Example:**
```typescript
// Source: provider-core/src/audit/writer.ts (adapted)
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export class AuditWriter {
  private lastHash: string | null = null;

  constructor(private readonly logPath: string) {
    this.lastHash = this.recoverLastHash();
  }

  append(entry: Omit<VaultAuditEntry, 'prev_hash'>): void {
    const enriched: VaultAuditEntry = {
      ...entry,
      prev_hash: this.lastHash,
    };
    const line = JSON.stringify(enriched);
    const currentHash = createHash('sha256').update(line).digest('hex');
    appendFileSync(this.logPath, line + '\n', { flag: 'a' });
    this.lastHash = currentHash;
  }
}
```

### Pattern 2: Non-Blocking Audit with Gap Markers
**What:** Audit writes must never block vault operations. On failure: retry once, then drop and insert an `audit_gap` marker.
**When to use:** Every audit write call from vault operations.
**Example:**
```typescript
// Non-blocking audit wrapper
class VaultAuditPipeline {
  private writer: AuditWriter;
  private onError?: (error: Error) => void;

  write(entry: Omit<VaultAuditEntry, 'prev_hash' | 'id' | 'timestamp'>): void {
    const enriched = {
      id: generateUUIDv7(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    try {
      this.writer.append(enriched);
    } catch (firstError) {
      // Retry once
      try {
        this.writer.append(enriched);
      } catch (secondError) {
        // Drop the entry, insert gap marker
        try {
          this.writer.append({
            id: generateUUIDv7(),
            timestamp: new Date().toISOString(),
            event_type: 'audit_gap' as VaultEventType,
            actor: { type: 'system', id: 'system', display_name: 'System' },
            outcome: 'error',
            details: {
              dropped_event_type: enriched.event_type,
              dropped_timestamp: enriched.timestamp,
              error: secondError instanceof Error ? secondError.message : String(secondError),
            },
          });
        } catch {
          // Gap marker also failed -- silently swallow
        }
        this.onError?.(secondError instanceof Error ? secondError : new Error(String(secondError)));
      }
    }
  }
}
```

### Pattern 3: UUIDv7 Generation (RFC 9562 compliant, zero deps)
**What:** Time-sortable UUID with embedded millisecond timestamp, generated using only `node:crypto`.
**When to use:** Vault ID generation, audit entry IDs.
**Example:**
```typescript
// Source: RFC 9562 / antonz.org/uuidv7 reference implementation
import { randomBytes } from 'node:crypto';

export function generateUUIDv7(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  // Fill first 6 bytes with 48-bit millisecond timestamp
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Set version (7) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Format as standard UUID string
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

### Pattern 4: TypeBox Schema Definition (from provider-core)
**What:** Define schemas using TypeBox `Type.Object()`, `Type.Union()`, `Type.Literal()`, and extract TypeScript types with `Static<>`.
**When to use:** All data model definitions (VaultAuditEntry, VaultEventType, AuditActor, VaultMetadata).
**Example:**
```typescript
// Source: provider-core/src/audit/entry-schema.ts (adapted)
import { Type, type Static } from '@sinclair/typebox';

export const VaultEventTypeSchema = Type.Union([
  Type.Literal('vault_created'),
  Type.Literal('vault_opened'),
  Type.Literal('vault_closed'),
  Type.Literal('vault_integrity_checked'),
  Type.Literal('vault_integrity_failed'),
  // ... all 38 event types
]);

export type VaultEventType = Static<typeof VaultEventTypeSchema>;

export const AuditActorSchema = Type.Object({
  type: Type.Union([
    Type.Literal('patient_agent'),
    Type.Literal('provider_agent'),
    Type.Literal('emergency_party'),
    Type.Literal('application'),
    Type.Literal('system'),
  ]),
  id: Type.String(),
  display_name: Type.String(),
});

export type AuditActor = Static<typeof AuditActorSchema>;
```

### Anti-Patterns to Avoid
- **Async file writes for hash chains:** Using `appendFile` (async) risks interleaved writes that break the chain. Use `appendFileSync` for chain integrity. Provider-core uses sync writes.
- **Reading entire file to get last hash on every write:** Recover the last hash once in the constructor and track in memory thereafter. Only re-read on construction/restart.
- **Hashing the parsed object instead of the raw line:** The hash must be computed on the exact JSON string that was written to disk, not on a re-serialized object. Parse ordering differences would break the chain.
- **Throwing errors from audit writes:** Audit must never throw to the caller. All errors are caught internally and surfaced through the optional callback.
- **Using `crypto.randomUUID()` for vault IDs:** This generates v4 (random), not v7 (time-sortable). Use the hand-rolled UUIDv7 function.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema validation | Custom validators | TypeBox `Value.Check()` + `Value.Errors()` | TypeBox generates JSON Schema compliant validators with TypeScript inference |
| Test coverage | Custom coverage tracking | @vitest/coverage-v8 | V8-based coverage with threshold enforcement built into vitest config |
| ESM build pipeline | Custom tsc + packaging | tsdown | Handles ESM output, .d.ts generation, source maps, clean builds |
| JSON serialization | Custom serializers | `JSON.stringify()` + `JSON.parse()` | Built-in, deterministic for simple objects (no custom toJSON needed for these types) |

**Key insight:** The entire hash-chain JSONL pattern is already proven in provider-core. The audit writer implementation should closely mirror `provider-core/src/audit/writer.ts` (122 lines total). The novel aspects in patient-chart are: (1) the non-blocking wrapper with gap markers, (2) the 38-type event vocabulary, and (3) UUIDv7 identifiers.

## Common Pitfalls

### Pitfall 1: JSON Serialization Non-Determinism
**What goes wrong:** If the same object is serialized differently (key order changes), the hash chain breaks on verification because the hash was computed on a specific string.
**Why it happens:** `JSON.stringify()` preserves insertion order of object keys, but if you construct objects differently on write vs. read, order may differ.
**How to avoid:** Always compute the hash on the raw line string read from the file, never on a re-serialized parsed object. The provider-core pattern does this correctly -- `createHash('sha256').update(lines[i]).digest('hex')` operates on the raw string.
**Warning signs:** Chain verification fails on entries that "look correct" when parsed.

### Pitfall 2: Newline Handling in JSONL
**What goes wrong:** Trailing newlines, empty lines, or `\r\n` vs `\n` cause hash mismatches or parsing failures.
**Why it happens:** Different platforms, editors, or file operations may introduce inconsistent line endings.
**How to avoid:** Always write `line + '\n'` (never `\r\n`). On read, use `.trimEnd()` before splitting, and filter empty lines. Provider-core does exactly this: `content.split('\n')` with empty line filtering.
**Warning signs:** Chain verification fails on the last entry, or entry count disagrees.

### Pitfall 3: Concurrent Append Corruption
**What goes wrong:** Multiple processes or async operations append to the same JSONL file simultaneously, interleaving partial writes.
**Why it happens:** JSONL files are single-writer by design, but nothing prevents opening two instances.
**How to avoid:** Use synchronous writes (`appendFileSync`). For Phase 1, document the single-writer constraint. File locking is deferred to Phase 5 (noted in STATE.md blockers).
**Warning signs:** Malformed JSON lines, broken hash chains at seemingly random positions.

### Pitfall 4: audit_gap Event Type Not in the 38-Type Enum
**What goes wrong:** The `audit_gap` marker entry uses an event type that may not be in the `VaultEventType` union, causing schema validation failure on the gap marker itself.
**Why it happens:** The PRD defines 38 event types but `audit_gap` is not among them -- it was introduced in the CONTEXT.md discussion.
**How to avoid:** Add `audit_gap` as a 39th event type in the VaultEventType schema. It is explicitly part of the design from the user discussion.
**Warning signs:** Gap markers fail TypeBox validation; runtime errors when trying to write gap entries.

### Pitfall 5: UUIDv7 Monotonicity in Batch Operations
**What goes wrong:** Multiple UUIDv7s generated within the same millisecond may not be strictly ordered because the random portion has no monotonic counter.
**Why it happens:** `Date.now()` has millisecond resolution; if two UUIDs are generated in the same millisecond, order depends on random bytes.
**How to avoid:** For Phase 1, this is acceptable -- audit entries are ordered by their position in the JSONL file (hash chain), not by UUID. The UUID is an identifier, not a sort key. If strict monotonicity is needed later, add a sub-millisecond counter.
**Warning signs:** None for Phase 1 -- this only matters if UUIDs are used for ordering.

### Pitfall 6: Recovery After Partial Write
**What goes wrong:** A crash during `appendFileSync` leaves a partial JSON line at the end of the file, which breaks both the last-hash recovery and the chain verification.
**Why it happens:** `appendFileSync` is not atomic -- it can be interrupted by process termination.
**How to avoid:** The `recoverLastHash()` method should handle this: attempt to parse the last line, and if it fails, truncate the corrupted partial line before recovering. Chain verification should also handle trailing malformed lines gracefully.
**Warning signs:** Chain recovery fails on startup after a crash.

## Code Examples

### vault.json Structure (TypeBox schema)
```typescript
// Source: PRD section 12.1 + CONTEXT.md decisions
import { Type, type Static } from '@sinclair/typebox';

export const VaultMetadataSchema = Type.Object({
  vault_id: Type.String({ description: 'UUIDv7 vault identifier' }),
  schema_version: Type.Literal('1'),
  created_at: Type.String({ description: 'ISO 8601 with ms precision' }),
});

export type VaultMetadata = Static<typeof VaultMetadataSchema>;
```

### Vault Directory Creation
```typescript
// Source: PRD section 12.1
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VAULT_SUBDIRS = ['ledger', 'audit', 'keys', 'sync', 'backup', 'emergency'] as const;

export function createVault(vaultPath: string): VaultMetadata {
  if (existsSync(join(vaultPath, 'vault.json'))) {
    throw new Error(`Vault already exists at ${vaultPath}`);
  }

  // Create all subdirectories
  for (const subdir of VAULT_SUBDIRS) {
    mkdirSync(join(vaultPath, subdir), { recursive: true });
  }

  const metadata: VaultMetadata = {
    vault_id: generateUUIDv7(),
    schema_version: '1',
    created_at: new Date().toISOString(),
  };

  writeFileSync(join(vaultPath, 'vault.json'), JSON.stringify(metadata, null, 2));
  return metadata;
}
```

### Chain Verification (from provider-core, adapted)
```typescript
// Source: provider-core/src/audit/writer.ts verifyChain() method
verifyChain(): { valid: boolean; entries: number; brokenAt?: number; error?: string } {
  if (!existsSync(this.logPath)) {
    return { valid: true, entries: 0 };
  }
  const content = readFileSync(this.logPath, 'utf-8').trimEnd();
  if (!content) return { valid: true, entries: 0 };

  const lines = content.split('\n');
  let expectedPrevHash: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let parsed: VaultAuditEntry;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { valid: false, entries: i, brokenAt: i, error: `Malformed JSON at line ${i + 1}` };
    }
    if (parsed.prev_hash !== expectedPrevHash) {
      return {
        valid: false, entries: i, brokenAt: i,
        error: `Chain broken at entry ${i}: expected prev_hash ${expectedPrevHash}, got ${parsed.prev_hash}`,
      };
    }
    expectedPrevHash = createHash('sha256').update(lines[i]).digest('hex');
  }
  return { valid: true, entries: lines.filter(l => l.trim()).length };
}
```

### provider-core tsconfig.json (exact reference to copy)
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

## Discretion Recommendations

Research-informed recommendations for areas marked as "Claude's Discretion":

### 1. Export Structure
**Recommendation:** Single entry point (`"."`) exporting all public types and the vault/audit API. No need for `"./types"` sub-export in Phase 1 since there are no external consumers yet. Add `"./types"` in Phase 3+ when provider-core needs type-only imports.

### 2. Actor Identity Model for Phase 1
**Recommendation:** Use a simplified actor model where the system is the only actor type exercised in Phase 1. Define the full `AuditActor` type with all 5 actor types (patient_agent, provider_agent, emergency_party, application, system), but Phase 1 tests only exercise `system` actors. This avoids rework when later phases add real actor types.

### 3. Define All 38 Event Types Upfront
**Recommendation:** Define all 38 (plus `audit_gap` = 39) event types in the TypeBox schema from day one. Reasoning: (a) the PRD has the complete list, (b) TypeBox unions are cheap to define, (c) it prevents breaking changes when later phases add event emission, (d) it allows TypeScript exhaustiveness checking from the start. The audit writer accepts any valid event type; which events are actually emitted is controlled by the calling code in each phase.

### 4. Audit Entry Metadata Typing
**Recommendation:** Use `Record<string, unknown>` for the `details` field, matching provider-core's pattern. Per-event-type strict metadata typing would require discriminated unions and adds complexity without proportional benefit at this stage. The hash chain guarantees integrity; schema evolution can tighten `details` typing in later phases if needed.

### 5. Audit Write Mode
**Recommendation:** Synchronous writes (`appendFileSync`), matching provider-core exactly. Reasoning: (a) hash chain integrity requires sequential writes, (b) audit volume is low (dozens to hundreds of entries per session, not thousands per second), (c) synchronous writes are simpler to reason about for chain correctness, (d) the non-blocking requirement is about not blocking *vault operations*, not about async I/O -- the try/catch wrapper handles this.

### 6. Linting/Formatting
**Recommendation:** Defer linting/formatting setup. Provider-core does not include ESLint or Prettier in its devDependencies. Keep the stack minimal for Phase 1. Add linting in a later phase if desired.

### 7. vault.json Patient Identity Field
**Recommendation:** Omit patient identity from vault.json in Phase 1. vault.json should contain only `vault_id`, `schema_version`, and `created_at`. Patient identity is a security concern -- a vault.json file that reveals the patient's identity on disk before encryption is available (Phase 2) creates an information leak. Patient identity can be added as an encrypted ledger entry in Phase 3+.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| UUIDv4 (random) | UUIDv7 (time-sortable, RFC 9562) | RFC 9562 published May 2024 | Vault IDs embed creation timestamp; natural sort order; no `uuid` npm dep needed with hand-rolled impl |
| Vitest v3 coverage | Vitest 4.0 AST-aware V8 coverage | Vitest 4.0 release 2025 | More accurate coverage reports; `experimentalAstAwareRemapping` removed (now default) |
| tsup | tsdown ~0.20 | 2025 | Faster builds, better .d.ts generation via Rolldown; same config surface |
| TypeBox ~0.33 | TypeBox ~0.34 | 2025 | Stable API; `Type.Union([Type.Literal(...)])` pattern unchanged |

**Deprecated/outdated:**
- `crypto.randomUUID()` generates v4 only -- do not use for vault IDs
- Vitest `experimentalAstAwareRemapping` config option -- removed in v4, now always enabled

## Open Questions

1. **`audit_gap` as a formal event type**
   - What we know: CONTEXT.md explicitly describes inserting an `audit_gap` marker on dropped entries. The PRD's 38 event types do not include `audit_gap`.
   - What's unclear: Whether `audit_gap` should be the 39th VaultEventType or handled differently.
   - Recommendation: Add it as a formal event type. It must pass TypeBox validation when written to the chain. Making it a 39th type is the cleanest approach.

2. **Vault discovery implementation scope**
   - What we know: CONTEXT.md says "The library can discover mounted vaults by scanning for vault.json files."
   - What's unclear: How deep to scan, what paths to scan, and whether this belongs in Phase 1 or a later phase.
   - Recommendation: Include a minimal `discoverVaults(searchPaths: string[]): VaultMetadata[]` function in Phase 1 that scans provided directories (not recursive by default) for `vault.json` files. Keep it simple.

3. **ISO 8601 millisecond precision enforcement**
   - What we know: CONTEXT.md specifies "2026-02-21T14:30:00.123Z" format.
   - What's unclear: Whether `new Date().toISOString()` always produces millisecond precision (it does in V8/Node.js -- always 3 decimal places).
   - Recommendation: Use `new Date().toISOString()` directly. Node.js V8 engine always produces `YYYY-MM-DDTHH:mm:ss.sssZ` format. No custom formatting needed. (HIGH confidence)

## Sources

### Primary (HIGH confidence)
- `provider-core/src/audit/writer.ts` -- AuditWriter reference implementation (122 lines, hash-chain JSONL pattern)
- `provider-core/src/audit/entry-schema.ts` -- TypeBox schema pattern for audit entries
- `provider-core/src/audit/pipeline.ts` -- AuditPipeline wrapper with session management
- `provider-core/src/audit/integrity-service.ts` -- Background integrity verification service
- `provider-core/package.json` -- devDependency versions and build scripts
- `provider-core/tsconfig.json` -- Exact TypeScript configuration to replicate
- `provider-core/vitest.config.ts` -- Vitest 4.0 configuration with 80% coverage thresholds
- `provider-core/tsdown.config.ts` -- tsdown ESM build configuration
- `patient-chart/patient-chart-PRD.md` -- Complete TypeScript interfaces (VaultAuditEntry, VaultEventType, AuditActor)

### Secondary (MEDIUM confidence)
- [antonz.org/uuidv7](https://antonz.org/uuidv7/) -- UUIDv7 reference implementation in 33 languages, verified against RFC 9562
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) -- AST-aware coverage changes
- [tsdown.dev CLI reference](https://tsdown.dev/reference/cli) -- tsdown configuration options

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources (provider-core codebase and official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- exact versions verified in provider-core package.json and confirmed with npm/docs
- Architecture: HIGH -- pattern directly copied from working provider-core implementation
- Pitfalls: HIGH -- identified from actual provider-core code patterns and known JSONL/hash-chain edge cases
- UUIDv7: HIGH -- RFC 9562 reference implementation verified; Node.js lack of native v7 confirmed via MDN and Node.js docs

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable domain -- file I/O and hashing patterns do not change frequently)
