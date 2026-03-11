# Phase 9: Knowledge Graph Layer - Research

**Researched:** 2026-02-23
**Domain:** Encrypted knowledge graph storage with Obsidian-compatible markdown, problem-oriented medical records
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Problem List as Central Document
- The patient problem list is the **central document** of the knowledge graph — the spine that everything else links to
- Must be modeled after how top EMRs implement problem lists: research Epic, Cerner/Oracle Health, MEDITECH, athenahealth for best patterns
- Must also be grounded in clinical standards: SNOMED CT and ICD-10 coding systems
- Problem statuses must match EMR categories: active, chronic, resolved, historical, ruled-out (not the simplified active/inactive/resolved from early design)
- Structure of the problem list (single document vs index + individual notes) and whether to include SNOMED/ICD codes in frontmatter: **decided after research** — research what's most useful for an AI agent

#### Three-Layer Architecture
- **Layer 1 — Raw Documents:** Original medical records stored as encrypted ledger entry payloads. Never modified, never deleted.
- **Layer 2 — Structured Ledger:** The 26 typed, hash-chained, signed, immutable entries. Append-only.
- **Layer 3 — Knowledge Graph:** Living, problem-oriented markdown notes. Obsidian-compatible format. Rebuildable from Layers 1 and 2. This is the layer the agent thinks with.

#### Vault Directory Structure
- `knowledge/` directory added as a peer to `ledger/`, `audit/`, `keys/`
- Subdirectories by clinical domain: `conditions/`, `medications/`, `allergies/`, `labs/`, `imaging/`, `procedures/`, `providers/`, `encounters/`, `directives/`, `documents/`
- Folder categories are organizational — the real structure is in `[[wiki links]]` between notes

#### Note Format
- YAML frontmatter for structured metadata (id, type, status, created, updated, source_entries, tags)
- Markdown body with `[[wiki links]]` for relationships (Obsidian-compatible)
- `ledger://entry/<id>` provenance links in frontmatter connecting back to immutable ledger
- Bidirectional links maintained by convention
- Each clinical domain has domain-specific body structure but consistent frontmatter

#### Encryption & Storage
- Per-file encryption using vault's active AES-256-GCM key (same as ledger entries)
- Files stored as `.enc` on disk — `EncryptedPayload` format (ciphertext + IV + auth_tag + key_id)
- Decrypt on read, encrypt on write — no plaintext touches disk
- Key rotation works naturally via key ring's historical key retention
- Filename visibility acceptable for v1 — filename encryption deferred to v2

#### KnowledgeStore API
- `readNote(vaultPath, relativePath)` → decrypted markdown string
- `writeNote(vaultPath, relativePath, content)` → encrypt and save
- `listNotes(vaultPath, folder?)` → list available notes
- No `deleteNote()` — notes are never deleted, only marked `status: inactive` or `status: resolved`
- Atomic writes (write-then-rename pattern, consistent with KeyRing)

#### Scope Boundary
- patient-chart owns: directory creation, encryption/decryption, KnowledgeStore API, audit events
- patient-core owns: clinical intelligence, document processing, knowledge synthesis, rebuild-from-ledger
- The chart stores. The agent interprets.

### Claude's Discretion

- Exact KnowledgeStore method signatures and error types
- Encryption file format details (JSON envelope vs raw binary for .enc files)
- Audit event types for knowledge operations (knowledge_note_created, knowledge_note_updated, etc.)
- Dependency ordering — whether Phase 9 can run independently or needs ledger infrastructure

### Deferred Ideas (OUT OF SCOPE)

- Filename encryption to prevent leaking note existence — v2 concern
- Granular access control on knowledge notes (provider sees medications but not directives) — depends on Phase 4 ACL infrastructure
- Knowledge graph rebuild-from-ledger capability — patient-core responsibility, not patient-chart

</user_constraints>

## Summary

Phase 9 adds a `knowledge/` directory to the vault and a `KnowledgeStore` API for encrypted CRUD on Obsidian-compatible markdown notes. The knowledge graph is a living, problem-oriented medical record layer (Layer 3) built on top of the immutable ledger (Layers 1 and 2). patient-chart provides the storage infrastructure; clinical intelligence belongs to patient-core.

The codebase already has every primitive this phase needs: AES-256-GCM encrypt/decrypt (`src/encryption/aes.ts`), KeyRing for active key lookup and historical key retention (`src/encryption/keyring.ts`), EncryptedPayload type and schema (`src/types/encryption.ts`), atomic write-then-rename pattern (used in `KeyRing.save()`), VaultAuditPipeline for non-blocking audit events (`src/audit/writer.ts`), and TypeBox schema validation (`@sinclair/typebox`). The implementation is straightforward: encrypt markdown content to an `EncryptedPayload` JSON file on disk, decrypt on read, list `.enc` files for directory listing, and emit audit events. No new dependencies are needed.

Research into EMR problem list design (Epic, Cerner/Oracle Health, MEDITECH, FHIR R4), POMR structure, SNOMED CT/ICD-10 coding, and Obsidian format conventions informs the note schema design. The key finding is that the problem list should be an index document (single `problems.md` with one row per problem linking to individual condition notes), SNOMED/ICD codes should be included in frontmatter (critical for AI agent disambiguation), and problem statuses should use a two-axis model (clinicalStatus + verificationStatus) aligned with the FHIR R4 Condition resource.

**Primary recommendation:** Build KnowledgeStore as a thin encryption/IO layer (3 methods, ~150 LOC), define TypeBox schemas for note frontmatter, add `knowledge/` with 10 subdirectories to VAULT_SUBDIRS, add 3 audit event types, and export everything from `src/index.ts`. Phase 9 has zero dependency on Phases 3-8 and can execute immediately after Phase 2.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | Node 22+ | File read/write/list/rename | Zero-dependency constraint; already used throughout codebase |
| `node:path` | Node 22+ | Path joining and resolution | Already used in vault/create.ts, vault/discover.ts |
| `node:crypto` | Node 22+ | AES-256-GCM via existing encrypt/decrypt | Already the encryption foundation |
| `@sinclair/typebox` | ~0.34.0 | TypeBox schemas for frontmatter validation | Already used for EncryptedPayload, VaultMetadata, audit types |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ~4.0.0 | Unit testing | Already configured; test KnowledgeStore operations |
| `@vitest/coverage-v8` | ~4.0.0 | Coverage reporting | Already configured; 80% threshold |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `node:fs` for atomic writes | `write-file-atomic` npm package | Would violate zero-dependency constraint; KeyRing already implements write-then-rename |
| YAML parsing in patient-chart | `yaml` npm package | Out of scope; patient-chart stores raw markdown, patient-core parses it |
| SQLite index for notes | `better-sqlite3` | Violates zero-dependency and "pure markdown, pure node:fs" constraint |

**Installation:** No new packages needed. Everything required is already in package.json.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── knowledge/
│   ├── store.ts           # KnowledgeStore class (read/write/list)
│   ├── schema.ts          # KNOWLEDGE_SUBDIRS constant, re-exports
│   └── errors.ts          # KnowledgeStoreError, NoteNotFoundError
├── types/
│   └── knowledge.ts       # TypeBox schemas for note frontmatter (KnowledgeNoteMeta)
├── encryption/            # (existing, unchanged)
├── audit/                 # (existing, unchanged)
├── vault/
│   ├── create.ts          # (modified: add knowledge/ subdirs)
│   └── schema.ts          # (modified: add to VAULT_SUBDIRS)
└── index.ts               # (modified: export KnowledgeStore, types, schemas)
```

### Vault Directory Structure (After Phase 9)

```
vault/
├── vault.json
├── ledger/
├── audit/
├── keys/
├── sync/
├── backup/
├── emergency/
└── knowledge/
    ├── conditions/        # Problem/diagnosis notes (POMR spine)
    ├── medications/       # Active, discontinued, allergic reactions
    ├── allergies/         # Drug, food, environmental allergies
    ├── labs/              # Lab results and trends
    ├── imaging/           # Radiology/imaging reports
    ├── procedures/        # Surgical and clinical procedures
    ├── providers/         # Treating providers and facilities
    ├── encounters/        # Visit/admission summaries
    ├── directives/        # Advance directives, living will, POA
    └── documents/         # Miscellaneous clinical documents
```

### Pattern 1: KnowledgeStore as Encryption/IO Layer

**What:** KnowledgeStore wraps encrypt/decrypt + file I/O into a clean API. It does not parse YAML, does not understand clinical semantics, and does not maintain an index. It is purely a storage layer.

**When to use:** All knowledge note operations.

**Example:**

```typescript
// Source: Derived from existing KeyRing.save() pattern in src/encryption/keyring.ts
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encrypt, decrypt } from '../encryption/aes.js';
import type { EncryptedPayload } from '../types/encryption.js';
import type { VaultAuditPipeline } from '../audit/writer.js';

export class KnowledgeStore {
  constructor(
    private readonly vaultPath: string,
    private readonly getActiveKey: () => { keyId: string; key: Buffer },
    private readonly getKeyById: (keyId: string) => Buffer,
    private readonly pipeline?: VaultAuditPipeline,
  ) {}

  readNote(relativePath: string): string {
    const filePath = join(this.vaultPath, 'knowledge', relativePath + '.enc');
    const raw = readFileSync(filePath, 'utf-8');
    const payload: EncryptedPayload = JSON.parse(raw);
    const key = this.getKeyById(payload.key_id);
    return decrypt(payload, key).toString('utf-8');
  }

  writeNote(relativePath: string, content: string): void {
    const { keyId, key } = this.getActiveKey();
    const payload = encrypt(Buffer.from(content, 'utf-8'), key, keyId);
    const filePath = join(this.vaultPath, 'knowledge', relativePath + '.enc');
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
    renameSync(tmpPath, filePath);
    // Audit event emitted here
  }

  listNotes(folder?: string): string[] {
    const dir = folder
      ? join(this.vaultPath, 'knowledge', folder)
      : join(this.vaultPath, 'knowledge');
    // Recursively list .enc files, strip extension, return relative paths
  }
}
```

### Pattern 2: .enc File Format (JSON Envelope)

**What:** Each knowledge note is stored as a JSON file containing the `EncryptedPayload` structure, with the `.enc` extension.

**When to use:** All encrypted note storage.

**Recommendation:** Use JSON envelope format (not raw binary). This is consistent with the existing `EncryptedPayload` type which uses base64-encoded strings for ciphertext, IV, and auth_tag. The JSON format provides:

1. Self-describing files (key_id embedded for key ring lookup during decryption)
2. Consistency with how KeyRing stores encrypted keys
3. Human-inspectable structure (though contents are encrypted)
4. Simple parsing with `JSON.parse()` + TypeBox validation

**Example on-disk file (`knowledge/conditions/type-2-diabetes.enc`):**

```json
{
  "ciphertext": "base64...",
  "iv": "base64...",
  "auth_tag": "base64...",
  "key_id": "019510a2-..."
}
```

### Pattern 3: Note Frontmatter Schema (Common Fields)

**What:** All knowledge notes share a consistent YAML frontmatter structure. Clinical domain-specific fields live in the markdown body, not in frontmatter.

**Example decrypted note (`knowledge/conditions/type-2-diabetes.md` before encryption):**

```markdown
---
id: "019510b3-7e2a-7def-8123-456789abcdef"
type: condition
status: active
clinical_status: active
verification_status: confirmed
snomed_ct: "44054006"
snomed_display: "Diabetes mellitus type 2"
icd10: "E11"
icd10_display: "Type 2 diabetes mellitus"
onset: "2019-03-15"
created: "2024-01-10T09:30:00.000Z"
updated: "2026-02-20T14:15:00.000Z"
source_entries:
  - "ledger://entry/019510a2-1234-7abc-8def-000000000001"
  - "ledger://entry/019510a2-1234-7abc-8def-000000000042"
tags:
  - endocrine
  - chronic
  - a1c-monitoring
---

# Type 2 Diabetes Mellitus

## Current State

- **Status:** Active, Chronic
- **Last A1C:** 7.2% (2026-01-15)
- **Current regimen:** [[medications/metformin]] 1000mg BID, [[medications/jardiance]] 10mg daily
- **Managing provider:** [[providers/dr-sarah-chen]]

## History

### 2026-01-15 — Follow-up Visit
**Encounter:** [[encounters/2026-01-15-pcp]]
- A1C improved from 7.8% to 7.2%
- Continue current regimen
- Recheck A1C in 3 months

### 2024-06-10 — Jardiance Added
**Encounter:** [[encounters/2024-06-10-pcp]]
- A1C 7.8%, metformin alone insufficient
- Added [[medications/jardiance]] 10mg daily
- Discussed SGLT2 inhibitor cardiovascular benefits

### 2019-03-15 — Initial Diagnosis
**Encounter:** [[encounters/2019-03-15-pcp]]
- Fasting glucose 180 mg/dL, A1C 8.4%
- Started [[medications/metformin]] 500mg BID, titrated to 1000mg
- Referred to diabetes education

## Clinical Considerations

- Monitor renal function annually (SGLT2 inhibitor)
- [[conditions/diabetic-retinopathy-screening|Retinopathy screening]] due annually
- Cardiovascular risk: see [[conditions/essential-hypertension]]
```

### Pattern 4: Problem List as Index Document

**What:** A single `knowledge/conditions/problems.md` serves as the central index (the POMR spine). Each problem is a row in a markdown table linking to its individual condition note.

**Recommendation: Use a hybrid model — index document + individual condition notes.**

This is the optimal structure for an AI agent because:

1. **The index gives the agent a single-read overview** of the entire patient problem landscape. An AI agent scanning for relevant context can read one file and understand every active, chronic, and resolved problem immediately.
2. **Individual notes give depth per problem.** When the agent needs detail on a specific condition, it follows the wiki link to a rich, cross-referenced document.
3. **The index is cheap to update.** Adding or changing a problem status means updating one row in the table and the individual note's frontmatter. No need to rewrite a massive monolithic document.
4. **Wiki links from the index to notes and back create the graph.** This mirrors how EMRs work: the problem list is a summary view, and clicking a problem opens the full problem detail.

**Example (`knowledge/conditions/problems.md`):**

```markdown
---
id: "019510b3-0000-7def-8000-000000000000"
type: problem_list
updated: "2026-02-20T14:15:00.000Z"
---

# Problem List

## Active Problems

| Problem | SNOMED | ICD-10 | Status | Onset | Note |
|---------|--------|--------|--------|-------|------|
| Type 2 Diabetes Mellitus | 44054006 | E11 | Active, Chronic | 2019-03 | [[conditions/type-2-diabetes]] |
| Essential Hypertension | 59621000 | I10 | Active, Chronic | 2018-06 | [[conditions/essential-hypertension]] |
| Acute Bronchitis | 10509002 | J20.9 | Active | 2026-02 | [[conditions/acute-bronchitis-2026-02]] |

## Resolved Problems

| Problem | SNOMED | ICD-10 | Status | Onset | Resolved | Note |
|---------|--------|--------|--------|-------|----------|------|
| Right Ankle Sprain | 44465007 | S93.401A | Resolved | 2025-08 | 2025-10 | [[conditions/right-ankle-sprain-2025]] |

## Ruled-Out Problems

| Problem | SNOMED | ICD-10 | Status | Evaluated | Note |
|---------|--------|--------|--------|-----------|------|
| Celiac Disease | 396331005 | K90.0 | Ruled-Out | 2024-11 | [[conditions/celiac-workup-2024]] |
```

**Why SNOMED/ICD codes belong in frontmatter:**
1. **AI disambiguation:** "Diabetes" is ambiguous; SNOMED 44054006 unambiguously means Type 2 Diabetes Mellitus. An agent processing clinical documents can match SNOMED codes directly.
2. **Cross-system interoperability:** SNOMED CT is the mandated US EHR terminology for problem lists (ONC Meaningful Use). ICD-10-CM is the billing/coding standard. Having both enables mapping in both directions.
3. **Machine-readable without parsing body text:** Frontmatter is trivially parseable YAML; the body markdown requires NLP.
4. **Standard practice:** Epic, Cerner, and MEDITECH all store SNOMED CT concept IDs as the primary problem identifier, with ICD-10-CM mappings via the NLM's SNOMED CT to ICD-10-CM map.

### Anti-Patterns to Avoid

- **Parsing YAML in patient-chart:** The KnowledgeStore stores and retrieves raw markdown strings. YAML parsing, frontmatter extraction, and clinical interpretation are patient-core responsibilities. The chart is a dumb pipe.
- **Building an in-memory index:** No SQLite, no JSON index files, no in-memory caches. The file system IS the index. `listNotes()` reads the directory. patient-core can build indexes from the notes if needed.
- **Storing unencrypted temp files:** The atomic write pattern must write encrypted content to the `.tmp` file. Never write plaintext to disk, not even temporarily.
- **Coupling to ledger entry types:** KnowledgeStore has no dependency on ledger entry schemas. It stores arbitrary markdown strings. The mapping between ledger entries and knowledge notes is patient-core's job.

## EMR Problem List Research

### Problem Status Model: Two-Axis Design

Research across Epic, Cerner/Oracle Health, MEDITECH, and the FHIR R4 standard reveals that modern EMRs use a **two-axis status model** for problems, not a single status field. This maps directly to the user's requirement for active, chronic, resolved, historical, and ruled-out statuses.

**Axis 1: Clinical Status** (how the condition is behaving clinically)

| Status | Meaning | Source |
|--------|---------|--------|
| `active` | Condition is currently being managed | FHIR R4, Epic, Cerner, MEDITECH |
| `inactive` | Condition not currently relevant but not resolved | FHIR R4 |
| `resolved` | Condition is resolved/no longer present | FHIR R4, Epic, MEDITECH |
| `recurrence` | Previously resolved condition that has returned | FHIR R4 |
| `remission` | Condition improving but not fully resolved | FHIR R4 |

**Axis 2: Verification Status** (how certain we are about the diagnosis)

| Status | Meaning | Source |
|--------|---------|--------|
| `confirmed` | Diagnosis verified by sufficient clinical evidence | FHIR R4 |
| `provisional` | Working diagnosis, not yet confirmed | FHIR R4 |
| `differential` | One of several possible diagnoses | FHIR R4 |
| `refuted` | Diagnosis ruled out | FHIR R4 |
| `entered-in-error` | Record was entered incorrectly | FHIR R4 |

**Mapping user requirements to the two-axis model:**

| User Requirement | Clinical Status | Verification Status | Chronic Flag |
|------------------|-----------------|---------------------|--------------|
| Active | `active` | `confirmed` | `false` |
| Chronic | `active` | `confirmed` | `true` |
| Resolved | `resolved` | `confirmed` | - |
| Historical | `inactive` | `confirmed` | - |
| Ruled-Out | - | `refuted` | - |

This two-axis model is superior to a flat status list because:
1. It captures nuance: a condition can be active but only provisionally diagnosed
2. It aligns with the FHIR R4 standard (HL7 Condition resource), which is the interoperability standard mandated by ONC
3. It matches how Epic and Cerner actually store problem data
4. An AI agent benefits from knowing BOTH the clinical state and diagnostic certainty

**Recommendation:** Use `clinical_status` and `verification_status` as separate frontmatter fields, plus a boolean `chronic` tag. Map the user's five categories as shown above.

### Epic Problem List Structure

From the Epic EHI Export Specification (`PROBLEM_LIST` table), key fields include:

| Field | Purpose | Relevant to patient-chart |
|-------|---------|--------------------------|
| `PROBLEM_LIST_ID` | Unique identifier | Maps to `id` in frontmatter |
| `DX_ID_DX_NAME` | Diagnosis name (links to DX master file with SNOMED/ICD codes) | Maps to `snomed_display` / `icd10_display` |
| `NOTED_DATE` | Date problem was first noted | Maps to `onset` |
| `RESOLVED_DATE` | Date problem was resolved | Maps to markdown body history |
| `DATE_OF_ENTRY` | Date entered into system | Maps to `created` |
| `PROBLEM_STATUS_C_NAME` | Active, Resolved, or Deleted | Maps to `clinical_status` |
| `CHRONIC_YN` | Boolean chronic flag | Maps to `chronic` tag |
| `PRIORITY` | Problem priority/ranking | Captured by position in problem list index |
| `SHOW_IN_MYC_YN` | Patient portal visibility | Not applicable for v1 |

Epic uses SNOMED CT as the reference terminology through IMO (Intelligent Medical Objects) term mappings. When a clinician selects a familiar term, the corresponding SNOMED CT concept is automatically selected.

### SNOMED CT and ICD-10-CM Coding

**SNOMED CT (Systematized Nomenclature of Medicine -- Clinical Terms):**
- ~370,934 concepts organized in hierarchies
- Concept IDs are unique numeric identifiers (e.g., 44054006 = Type 2 Diabetes Mellitus, 59621000 = Essential Hypertension)
- ConceptIDs have no implicit hierarchical meaning
- The CORE Problem List Subset (~16,874 terms covering 95% of problem list usage) is curated by NLM for problem list coding
- Hierarchy categories for problem lists: Clinical Findings, Procedures, Situations, Events

**ICD-10-CM (International Classification of Diseases, 10th Revision, Clinical Modification):**
- 3-7 character alphanumeric codes: first character always alpha, second always numeric, 3-7 may be alpha or numeric
- Decimal after first 3 characters: `XXX.XXXX`
- Categories (3 chars) describe general type; subcategories (4-5 chars) add specificity
- Placeholder "X" used when fewer than 6 characters but 7th character extension needed
- Examples: E11 = Type 2 diabetes, I10 = Essential hypertension, J20.9 = Acute bronchitis unspecified

**Relationship between the two:**
- SNOMED CT is the clinical terminology (what clinicians document)
- ICD-10-CM is the billing/administrative terminology (what gets sent to payers)
- The NLM maintains a SNOMED CT to ICD-10-CM mapping table
- Both should be stored: SNOMED for clinical precision, ICD-10 for administrative completeness

### Problem-Oriented Medical Record (POMR) Structure

Lawrence Weed's POMR (1964) has four core components:
1. **Defined database** of patient information
2. **Problem list** — the organizing spine, with problems defined at the level the clinician understands them
3. **Plans of action** for each problem
4. **Progress notes** on each problem (SOAP: Subjective, Objective, Assessment, Plan)

The knowledge graph maps directly to this structure:
- Layer 1 (raw documents) = the database
- Layer 2 (structured ledger) = the permanent record
- Layer 3 (knowledge graph) = the problem list + plans + progress notes

### Obsidian Format Conventions

**Properties (frontmatter):**
- YAML block at top of file between `---` delimiters
- Supported types: text, list, number, checkbox, date, datetime
- Wiki links in frontmatter must be quoted: `sources: - "[[path/to/note]]"`
- Date format: ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss.sssZ`)
- One YAML block per file, blank line after closing `---`

**Wiki links:**
- Format: `[[path/to/note]]` or `[[path/to/note|display text]]`
- No file extension needed in the link
- Paths relative to vault root
- Used for bidirectional linking in the markdown body

**Compatibility notes:**
- Files must be `.md` extension for Obsidian recognition
- On disk our files are `.enc` (encrypted); the `.md` extension is part of the *content*, not the on-disk filename
- When decrypted and dumped for Obsidian browsing, consumer tools (patient-core) would write the decrypted content to `.md` files

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM encryption | Custom cipher wrapper | Existing `encrypt()`/`decrypt()` from `src/encryption/aes.ts` | Already tested, handles IV generation, auth tags, key validation |
| Atomic file writes | Custom fsync/lock logic | Write-then-rename pattern from `KeyRing.save()` | Already proven in codebase, handles crash safety |
| Key lookup by ID | Custom key management | `KeyRing.getEncryptionKey(keyId)` and `KeyRing.getActiveEncryptionKey()` | Handles historical keys, rotation, wrong-key errors |
| Audit event emission | Custom logging | `VaultAuditPipeline.write()` | Non-blocking, retry-with-gap-marker semantics, hash-chained |
| Schema validation | Manual type checking | `@sinclair/typebox` Value.Check() | Already used for EncryptedPayload, VaultMetadata validation |
| UUIDv7 generation | External uuid library | `generateUUIDv7()` from `src/util/uuidv7.ts` | Already implemented, time-sortable |

**Key insight:** Phase 9 is almost entirely composition of existing primitives. The "new code" is thin glue connecting encrypt/decrypt + file I/O + audit pipeline into a KnowledgeStore class. The complexity lives in the note *schema design* (frontmatter structure, clinical domain templates), not in the implementation.

## Common Pitfalls

### Pitfall 1: Plaintext Leakage Through Temp Files

**What goes wrong:** Writing plaintext to a `.tmp` file before encrypting and renaming exposes sensitive medical data on disk, even momentarily.
**Why it happens:** Developers might serialize the markdown first, then encrypt in a separate step.
**How to avoid:** The atomic write pattern must encrypt FIRST, then write the encrypted JSON to `.tmp`, then rename. The sequence is: `content -> encrypt(Buffer.from(content)) -> writeFileSync(tmpPath, JSON.stringify(payload)) -> renameSync(tmpPath, filePath)`.
**Warning signs:** Any `writeFileSync` call where the content argument is a plaintext string rather than a JSON-stringified `EncryptedPayload`.

### Pitfall 2: Key ID Mismatch on Read

**What goes wrong:** Reading an `.enc` file encrypted with a rotated key fails because the code uses the active key instead of the key referenced in the file's `key_id` field.
**Why it happens:** The natural assumption is "use the active key for everything."
**How to avoid:** On read, parse the `EncryptedPayload` JSON first, extract `key_id`, then call `keyRing.getEncryptionKey(payload.key_id)` to get the correct (possibly historical) key. On write, always use `keyRing.getActiveEncryptionKey()`.
**Warning signs:** `KeyNotFoundError` when reading notes encrypted before a key rotation.

### Pitfall 3: VAULT_SUBDIRS Breakage

**What goes wrong:** Adding `knowledge/` subdirectories to `VAULT_SUBDIRS` without considering that the constant is used by `createVault()` to `mkdirSync` all directories. Adding 10 subdirectories (conditions/, medications/, etc.) means `createVault()` must create nested paths.
**Why it happens:** The existing VAULT_SUBDIRS are all single-level (`ledger`, `audit`, `keys`).
**How to avoid:** Use `mkdirSync(path, { recursive: true })` which already handles nested creation. The existing `createVault()` already uses `{ recursive: true }`. Add the nested paths as `'knowledge/conditions'`, `'knowledge/medications'`, etc.
**Warning signs:** Tests failing with `ENOENT` errors when creating vaults.

### Pitfall 4: Filename Collision in listNotes

**What goes wrong:** `listNotes()` returns filenames without the `.enc` extension, but two files could theoretically exist: `foo.enc` and `foo.bar.enc`, where stripping `.enc` gives `foo` and `foo.bar`. This is not actually a collision but could confuse path resolution.
**Why it happens:** Extension stripping logic needs to be precise.
**How to avoid:** Only strip the final `.enc` suffix. Use `path.replace(/\.enc$/, '')` or `basename(path, '.enc')`. Never strip interior dots.
**Warning signs:** `readNote` failing to find files that `listNotes` reported.

### Pitfall 5: Coupling KnowledgeStore to VaultEventType

**What goes wrong:** Adding new audit event types (e.g., `knowledge_note_created`) requires modifying the existing `VaultEventTypeSchema` union in `src/types/audit.ts`. This is a breaking change if downstream consumers have exhaustive type checks.
**Why it happens:** The VaultEventType is a closed TypeBox union of literals.
**How to avoid:** This is unavoidable (the events must be added), but do it deliberately. Add the new literals to the existing union, document the addition, and test that audit pipeline accepts them.
**Warning signs:** TypeScript compilation errors from exhaustive switch/case statements in consumer code.

### Pitfall 6: Directory Traversal in relativePath

**What goes wrong:** A malicious or buggy caller passes `../../keys/keyring.json` as `relativePath` to `readNote()`, and the store reads/overwrites files outside the `knowledge/` directory.
**Why it happens:** Path concatenation without validation.
**How to avoid:** Validate that the resolved path is within the `knowledge/` directory. After `join(vaultPath, 'knowledge', relativePath)`, check that the result starts with `join(vaultPath, 'knowledge')`. Reject paths containing `..` segments.
**Warning signs:** Any test where `readNote` or `writeNote` can access files outside `knowledge/`.

## Code Examples

Verified patterns from the existing codebase:

### Encrypt and Write a Note (Atomic)

```typescript
// Source: Pattern derived from src/encryption/keyring.ts lines 211-243
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { encrypt } from '../encryption/aes.js';

function writeEncryptedNote(
  vaultPath: string,
  relativePath: string,
  content: string,
  key: Buffer,
  keyId: string,
): void {
  const payload = encrypt(Buffer.from(content, 'utf-8'), key, keyId);
  const filePath = join(vaultPath, 'knowledge', relativePath + '.enc');

  // Ensure parent directory exists (handles new subdomain folders)
  mkdirSync(dirname(filePath), { recursive: true });

  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
  renameSync(tmpPath, filePath);
}
```

### Read and Decrypt a Note

```typescript
// Source: Pattern derived from src/encryption/keyring.ts lines 135-200
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decrypt } from '../encryption/aes.js';
import { Value } from '@sinclair/typebox/value';
import { EncryptedPayloadSchema, type EncryptedPayload } from '../types/encryption.js';

function readEncryptedNote(
  vaultPath: string,
  relativePath: string,
  getKey: (keyId: string) => Buffer,
): string {
  const filePath = join(vaultPath, 'knowledge', relativePath + '.enc');
  const raw = readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!Value.Check(EncryptedPayloadSchema, parsed)) {
    throw new Error('Corrupted knowledge note: invalid encrypted payload');
  }

  const payload = parsed as EncryptedPayload;
  const key = getKey(payload.key_id);
  return decrypt(payload, key).toString('utf-8');
}
```

### List Notes in a Directory

```typescript
// Source: Pattern derived from node:fs readdirSync usage
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listEncryptedNotes(
  vaultPath: string,
  folder?: string,
): string[] {
  const baseDir = join(vaultPath, 'knowledge');
  const searchDir = folder ? join(baseDir, folder) : baseDir;
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.enc')) {
        // Return path relative to knowledge/, without .enc extension
        const relative = fullPath.slice(baseDir.length + 1).replace(/\.enc$/, '');
        results.push(relative);
      }
    }
  }

  walk(searchDir);
  return results.sort();
}
```

### Path Validation (Directory Traversal Prevention)

```typescript
// Source: Security best practice for path validation
import { join, resolve } from 'node:path';

function validateKnowledgePath(vaultPath: string, relativePath: string): string {
  const knowledgeRoot = join(vaultPath, 'knowledge');
  const resolved = resolve(knowledgeRoot, relativePath + '.enc');

  if (!resolved.startsWith(knowledgeRoot)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }

  return resolved;
}
```

### Audit Event Types for Knowledge Operations

```typescript
// Source: Pattern from src/types/audit.ts VaultEventTypeSchema
// Add these 3 literals to the existing VaultEventTypeSchema union:

Type.Literal('knowledge_note_created'),  // New note written for first time
Type.Literal('knowledge_note_updated'),  // Existing note overwritten
Type.Literal('knowledge_note_read'),     // Note decrypted and read
```

### KnowledgeStore Error Types

```typescript
// Source: Pattern from src/encryption/errors.ts
export class KnowledgeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeStoreError';
  }
}

export class NoteNotFoundError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Knowledge note not found: ${relativePath}`);
    this.name = 'NoteNotFoundError';
  }
}

export class NoteCorruptedError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Knowledge note corrupted or tampered with: ${relativePath}`);
    this.name = 'NoteCorruptedError';
  }
}

export class PathTraversalError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Path traversal detected: ${relativePath}`);
    this.name = 'PathTraversalError';
  }
}
```

### TypeBox Schema for Note Frontmatter Metadata

```typescript
// Source: Pattern from src/types/encryption.ts and src/types/vault.ts
import { Type, type Static } from '@sinclair/typebox';

/**
 * Clinical status of a condition (FHIR R4 Condition.clinicalStatus).
 */
export const ClinicalStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('inactive'),
  Type.Literal('resolved'),
  Type.Literal('recurrence'),
  Type.Literal('remission'),
]);

export type ClinicalStatus = Static<typeof ClinicalStatusSchema>;

/**
 * Verification status of a condition (FHIR R4 Condition.verificationStatus).
 */
export const VerificationStatusSchema = Type.Union([
  Type.Literal('confirmed'),
  Type.Literal('provisional'),
  Type.Literal('differential'),
  Type.Literal('refuted'),
  Type.Literal('entered-in-error'),
]);

export type VerificationStatus = Static<typeof VerificationStatusSchema>;

/**
 * Knowledge note type — corresponds to a clinical domain folder.
 */
export const NoteTypeSchema = Type.Union([
  Type.Literal('condition'),
  Type.Literal('medication'),
  Type.Literal('allergy'),
  Type.Literal('lab'),
  Type.Literal('imaging'),
  Type.Literal('procedure'),
  Type.Literal('provider'),
  Type.Literal('encounter'),
  Type.Literal('directive'),
  Type.Literal('document'),
  Type.Literal('problem_list'),
]);

export type NoteType = Static<typeof NoteTypeSchema>;

/**
 * Common frontmatter metadata for all knowledge notes.
 * Domain-specific fields (snomed_ct, icd10, onset, etc.) are optional
 * and only present on condition-type notes.
 */
export const KnowledgeNoteMetaSchema = Type.Object({
  id: Type.String({ description: 'UUIDv7 note identifier' }),
  type: NoteTypeSchema,
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('inactive'),
    Type.Literal('resolved'),
  ], { description: 'Lifecycle status of the note itself' }),
  created: Type.String({ description: 'ISO 8601 creation timestamp' }),
  updated: Type.String({ description: 'ISO 8601 last-updated timestamp' }),
  source_entries: Type.Optional(Type.Array(Type.String(), {
    description: 'ledger://entry/<id> provenance links',
  })),
  tags: Type.Optional(Type.Array(Type.String())),
  // Condition-specific (optional)
  clinical_status: Type.Optional(ClinicalStatusSchema),
  verification_status: Type.Optional(VerificationStatusSchema),
  snomed_ct: Type.Optional(Type.String({ description: 'SNOMED CT concept ID (numeric string)' })),
  snomed_display: Type.Optional(Type.String({ description: 'SNOMED CT fully specified name' })),
  icd10: Type.Optional(Type.String({ description: 'ICD-10-CM code (e.g., E11, I10)' })),
  icd10_display: Type.Optional(Type.String({ description: 'ICD-10-CM display name' })),
  onset: Type.Optional(Type.String({ description: 'ISO 8601 date of condition onset' })),
  chronic: Type.Optional(Type.Boolean({ description: 'Whether this is a chronic condition' })),
});

export type KnowledgeNoteMeta = Static<typeof KnowledgeNoteMetaSchema>;
```

## Discretion Recommendations

### 1. KnowledgeStore Method Signatures

**Recommendation:**

```typescript
class KnowledgeStore {
  constructor(
    vaultPath: string,
    getActiveKey: () => { keyId: string; key: Buffer },
    getKeyById: (keyId: string) => Buffer,
    pipeline?: VaultAuditPipeline,
  )

  readNote(relativePath: string): string
  writeNote(relativePath: string, content: string): void
  listNotes(folder?: string): string[]
  noteExists(relativePath: string): boolean
}
```

**Rationale:** Constructor takes key-access functions (not the KeyRing directly) for loose coupling. The caller (PatientChart facade in Phase 5) provides the functions, KnowledgeStore never holds a reference to the KeyRing. `noteExists()` added as a convenience check (wraps `existsSync`). All methods are synchronous (consistent with the rest of the codebase which uses `readFileSync`, `writeFileSync`, etc.).

### 2. Encryption File Format

**Recommendation:** JSON envelope (not raw binary).

Store `.enc` files as JSON-stringified `EncryptedPayload` objects. This is consistent with how the key ring stores encrypted keys and provides self-describing files with embedded `key_id` for key ring lookup.

### 3. Audit Event Types

**Recommendation:** Add three event types to `VaultEventTypeSchema`:

| Event Type | When Emitted | Details Fields |
|------------|--------------|----------------|
| `knowledge_note_created` | First write to a new note path | `{ path, note_type }` |
| `knowledge_note_updated` | Overwrite of an existing note | `{ path, note_type }` |
| `knowledge_note_read` | Note decrypted and returned | `{ path }` |

Three events (not two, not five) because:
- Create vs update distinction enables tracking note provenance
- Read auditing is essential for medical record access logging (HIPAA)
- No delete event needed (notes are never deleted per decision)
- No list event needed (listing is a directory operation, not a data access event)

### 4. Dependency Ordering

**Recommendation:** Phase 9 can execute immediately after Phase 2 (the current state).

**Dependencies satisfied by Phase 2:**
- AES-256-GCM encrypt/decrypt (Phase 2)
- KeyRing with active key and historical key lookup (Phase 2)
- EncryptedPayload type and schema (Phase 2)
- VaultAuditPipeline (Phase 1)
- createVault with VAULT_SUBDIRS (Phase 1)
- TypeBox schemas (Phase 1)

**No dependency on Phases 3-8:**
- Phase 9 does not read or write ledger entries (that's patient-core's rebuild job)
- Phase 9 does not need access control (deferred to v2)
- Phase 9 does not need the PatientChart facade (KnowledgeStore is a standalone class)
- Phase 9 does not need sync, backup, or emergency access

**Conclusion:** Phase 9 can be inserted into the roadmap as executable NOW, parallel to or before Phase 3. The `Depends on: Phase 8` in the roadmap should be updated to `Depends on: Phase 2`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single flat problem status (active/inactive/resolved) | Two-axis status (clinicalStatus + verificationStatus) | FHIR R4 (2019) | Captures diagnostic uncertainty; enables ruled-out, provisional states |
| ICD-9-CM coding | ICD-10-CM coding | October 2015 (US mandate) | 7x more codes, greater specificity, alpha-numeric format |
| Proprietary EMR terminologies | SNOMED CT as reference terminology | ONC Meaningful Use Stage 2 (2014) | Standardized problem list coding across Epic, Cerner, MEDITECH |
| POMR as paper-based system | Digital POMR with wiki-linked knowledge graphs | Emerging (2023-2026) | AI agents can navigate problem-oriented records as linked documents |

**Deprecated/outdated:**
- ICD-9-CM: Replaced by ICD-10-CM in October 2015; should not be stored
- Single-axis problem status: The simplified active/inactive/resolved model does not capture diagnostic uncertainty (provisional, differential, ruled-out)

## Open Questions

1. **Should `writeNote` distinguish create vs update internally?**
   - What we know: The audit events differentiate `knowledge_note_created` from `knowledge_note_updated`. KnowledgeStore needs to check `existsSync()` before writing to determine which audit event to emit.
   - What's unclear: Whether this creates a TOCTOU race condition (file created between existence check and write).
   - Recommendation: Use `existsSync()` before write. The TOCTOU risk is acceptable because: (a) patient-chart is single-process, (b) worst case is logging "created" instead of "updated" which is a minor audit inaccuracy, not a data loss risk.

2. **Should `readNote` validate the EncryptedPayload schema before decrypting?**
   - What we know: The KeyRing `load()` validates with `Value.Check(KeyRingDataSchema, data)`.
   - What's unclear: Whether the performance cost of validation on every read is worth it.
   - Recommendation: Yes, validate. Schema check is microsecond-level overhead and catches corruption/tampering before attempting decryption. Throw `NoteCorruptedError` on validation failure.

3. **Subdirectory creation strategy: at vault creation or on first write?**
   - What we know: `createVault()` creates all VAULT_SUBDIRS. Adding 10 knowledge subdirectories to VAULT_SUBDIRS creates them at vault creation time.
   - What's unclear: Whether creating 10 potentially empty subdirectories at vault creation time is desirable.
   - Recommendation: Create all subdirectories at vault creation time (consistent with existing pattern where `ledger/`, `audit/`, etc. are created even if unused). This is simpler and avoids race conditions. Add `'knowledge'`, `'knowledge/conditions'`, `'knowledge/medications'`, etc. to VAULT_SUBDIRS.

## Sources

### Primary (HIGH confidence)
- Existing codebase (`src/encryption/aes.ts`, `src/encryption/keyring.ts`, `src/types/encryption.ts`, `src/vault/create.ts`, `src/vault/schema.ts`, `src/audit/writer.ts`, `src/types/audit.ts`) - Verified patterns for encrypt/decrypt, atomic writes, audit events, TypeBox schemas
- [FHIR R4 Condition Resource](https://hl7.org/fhir/R4/condition.html) - clinicalStatus, verificationStatus value sets, problem-list-item category
- [FHIR R4 Condition Clinical Status ValueSet](https://www.hl7.org/fhir/R4/valueset-condition-clinical.html) - active, recurrence, relapse, inactive, remission, resolved
- [FHIR R4 Condition Verification Status ValueSet](https://hl7.org/fhir/R4/valueset-condition-ver-status.html) - unconfirmed, provisional, differential, confirmed, refuted, entered-in-error

### Secondary (MEDIUM confidence)
- [Epic EHI Export Specification - PROBLEM_LIST](https://open.epic.com/EHITables/GetTable/PROBLEM_LIST.htm) - Problem statuses (Active, Resolved, Deleted), CHRONIC_YN flag, NOTED_DATE, RESOLVED_DATE
- [Epic FHIR Condition Resource](https://open.epic.com/Clinical/Condition) - Condition types (Problems, Encounter Diagnosis, Health Concerns)
- [NLM SNOMED CT CORE Problem List Subset](https://www.nlm.nih.gov/research/umls/Snomed/core_subset.html) - ~16,874 terms covering 95% of problem list usage, four hierarchies
- [SNOMED CT Wikipedia](https://en.wikipedia.org/wiki/SNOMED_CT) - ~370,934 concepts, numeric ConceptIDs, relationship types
- [ICD-10-CM Code Structure - SEER Training](https://training.seer.cancer.gov/icd10cm/icd10cm-code-structure.html) - 3-7 character alphanumeric format
- [SNOMED CT 101 - IMO Health](https://www.imohealth.com/resources/snomed-ct-101-a-guide-to-the-international-terminology-system/) - Concept ID format, hierarchy organization
- [Obsidian Properties Documentation](https://help.obsidian.md/Editing+and+formatting/Properties) - Supported types: text, list, number, checkbox, date, datetime
- [POMR Components - Springer](https://link.springer.com/chapter/10.1007/978-981-97-4189-2_4) - POMR four-component structure

### Tertiary (LOW confidence)
- [Oracle Health Condition API](https://docs.healtheintent.com/api/v1/condition/) - Oracle Health/Cerner condition status values (limited public documentation)
- [MEDITECH Problem List Optimization](https://home.meditech.com/en/d/events/pages/optimizationproblemlistfaqs.htm) - Status changes, External problems header
- [athenahealth Problem List API](https://docs.athenahealth.com/api/api-ref/problem-list) - API endpoint exists but detailed schema not publicly accessible

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All primitives already exist in the codebase; zero new dependencies needed
- Architecture: HIGH - KnowledgeStore is thin glue over existing encrypt/decrypt + file I/O + audit; directory structure is user-decided
- EMR/Clinical standards: MEDIUM-HIGH - FHIR R4 is authoritative; Epic EHI specification is official; SNOMED/ICD standards are well-documented; Cerner/MEDITECH/athenahealth details less publicly available
- Pitfalls: HIGH - Derived from codebase analysis and standard security practices

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable domain; clinical standards and encryption primitives do not change frequently)
