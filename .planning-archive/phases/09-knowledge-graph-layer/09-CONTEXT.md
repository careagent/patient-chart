# Phase 9: Knowledge Graph Layer - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a `knowledge/` directory to the vault and a `KnowledgeStore` API for encrypted CRUD operations on Obsidian-compatible markdown notes. The knowledge graph is a living, problem-oriented medical record layer derived from the immutable ledger. patient-chart provides the storage infrastructure — directory creation, per-file encryption/decryption, read/write/list operations, and audit integration. Clinical intelligence (what to write, when to update, how to synthesize) belongs to patient-core, not this phase.

</domain>

<decisions>
## Implementation Decisions

### Problem List as Central Document
- The patient problem list is the **central document** of the knowledge graph — the spine that everything else links to
- Must be modeled after how top EMRs implement problem lists: research Epic, Cerner/Oracle Health, MEDITECH, athenahealth for best patterns
- Must also be grounded in clinical standards: SNOMED CT and ICD-10 coding systems
- Problem statuses must match EMR categories: active, chronic, resolved, historical, ruled-out (not the simplified active/inactive/resolved from early design)
- Structure of the problem list (single document vs index + individual notes) and whether to include SNOMED/ICD codes in frontmatter: **decided after research** — research what's most useful for an AI agent

### Three-Layer Architecture
- **Layer 1 — Raw Documents:** Original medical records stored as encrypted ledger entry payloads. Never modified, never deleted.
- **Layer 2 — Structured Ledger:** The 26 typed, hash-chained, signed, immutable entries. Append-only.
- **Layer 3 — Knowledge Graph:** Living, problem-oriented markdown notes. Obsidian-compatible format. Rebuildable from Layers 1 and 2. This is the layer the agent thinks with.

### Vault Directory Structure
- `knowledge/` directory added as a peer to `ledger/`, `audit/`, `keys/`
- Subdirectories by clinical domain: `conditions/`, `medications/`, `allergies/`, `labs/`, `imaging/`, `procedures/`, `providers/`, `encounters/`, `directives/`, `documents/`
- Folder categories are organizational — the real structure is in `[[wiki links]]` between notes

### Note Format
- YAML frontmatter for structured metadata (id, type, status, created, updated, source_entries, tags)
- Markdown body with `[[wiki links]]` for relationships (Obsidian-compatible)
- `ledger://entry/<id>` provenance links in frontmatter connecting back to immutable ledger
- Bidirectional links maintained by convention
- Each clinical domain has domain-specific body structure but consistent frontmatter

### Encryption & Storage
- Per-file encryption using vault's active AES-256-GCM key (same as ledger entries)
- Files stored as `.enc` on disk — `EncryptedPayload` format (ciphertext + IV + auth_tag + key_id)
- Decrypt on read, encrypt on write — no plaintext touches disk
- Key rotation works naturally via key ring's historical key retention
- Filename visibility acceptable for v1 — filename encryption deferred to v2

### KnowledgeStore API
- `readNote(vaultPath, relativePath)` → decrypted markdown string
- `writeNote(vaultPath, relativePath, content)` → encrypt and save
- `listNotes(vaultPath, folder?)` → list available notes
- No `deleteNote()` — notes are never deleted, only marked `status: inactive` or `status: resolved`
- Atomic writes (write-then-rename pattern, consistent with KeyRing)

### Scope Boundary
- patient-chart owns: directory creation, encryption/decryption, KnowledgeStore API, audit events
- patient-core owns: clinical intelligence, document processing, knowledge synthesis, rebuild-from-ledger
- The chart stores. The agent interprets.

### Claude's Discretion
- Exact KnowledgeStore method signatures and error types
- Encryption file format details (JSON envelope vs raw binary for .enc files)
- Audit event types for knowledge operations (knowledge_note_created, knowledge_note_updated, etc.)
- Dependency ordering — whether Phase 9 can run independently or needs ledger infrastructure

</decisions>

<specifics>
## Specific Ideas

- Knowledge graph modeled after the **Problem-Oriented Medical Record (POMR)** pioneered by Dr. Lawrence Weed — conditions are the organizing spine, everything else hangs off them
- Format must be **Obsidian-compatible** — `[[wiki links]]`, YAML frontmatter, plain `.md` files. Patient can browse with any open-source tool (Logseq, Foam, SiYuan)
- The metformin note example from brainstorming captures the ideal note structure: current state at top, chronological history with linked encounters, clinical considerations at bottom
- **Zero dependencies** — no SQLite, no index files, no external tools. Pure markdown, pure `node:fs`
- Research should cover how Epic, Cerner/Oracle Health, MEDITECH, and athenahealth structure problem lists, plus SNOMED CT and ICD-10 standards, to inform the problem list design

</specifics>

<deferred>
## Deferred Ideas

- Filename encryption to prevent leaking note existence — v2 concern
- Granular access control on knowledge notes (provider sees medications but not directives) — depends on Phase 4 ACL infrastructure
- Knowledge graph rebuild-from-ledger capability — patient-core responsibility, not patient-chart

</deferred>

---

*Phase: 09-knowledge-graph-layer*
*Context gathered: 2026-02-23*
