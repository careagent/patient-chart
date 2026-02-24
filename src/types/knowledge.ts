import { Type, type Static } from '@sinclair/typebox';

/**
 * Clinical status of a condition per FHIR R4 Condition.clinicalStatus value set.
 * Maps to http://terminology.hl7.org/CodeSystem/condition-clinical.
 * Used in condition notes to track whether a diagnosis is currently active,
 * in remission, or has been resolved.
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
 * Verification status of a condition per FHIR R4 Condition.verificationStatus value set.
 * Maps to http://terminology.hl7.org/CodeSystem/condition-ver-status.
 * Captures the diagnostic certainty — from provisional/differential through confirmed,
 * with refuted and entered-in-error for corrections.
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
 * Type of knowledge note, corresponding to the 10 clinical domain subdirectories
 * plus the special problem_list type. Determines which subdirectory a note belongs
 * to and what domain-specific frontmatter fields are relevant.
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
 * YAML frontmatter metadata schema for a knowledge graph note.
 *
 * Every knowledge note (encrypted markdown file in the knowledge/ directory tree)
 * carries this structured metadata in its YAML frontmatter block. The five required
 * fields (id, type, status, created, updated) are present on every note. The ten
 * optional fields cover clinical coding (SNOMED CT, ICD-10), condition lifecycle
 * (clinical_status, verification_status, onset, chronic), provenance (source_entries),
 * and organization (tags).
 *
 * This schema is validated at read time to detect corrupted or tampered notes.
 */
export const KnowledgeNoteMetaSchema = Type.Object({
  /** UUIDv7 note identifier — globally unique, time-ordered */
  id: Type.String({ description: 'UUIDv7 note identifier' }),

  /** Clinical domain type determining subdirectory placement */
  type: NoteTypeSchema,

  /** Lifecycle status of the note itself (not the clinical condition) */
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('inactive'),
    Type.Literal('resolved'),
  ]),

  /** ISO 8601 timestamp of note creation */
  created: Type.String({ description: 'ISO 8601 creation timestamp' }),

  /** ISO 8601 timestamp of last update */
  updated: Type.String({ description: 'ISO 8601 last-updated timestamp' }),

  /** Provenance links back to the immutable ledger (ledger://entry/<id> format) */
  source_entries: Type.Optional(
    Type.Array(Type.String(), { description: 'ledger://entry/<id> provenance links' }),
  ),

  /** Freeform organizational tags for note categorization */
  tags: Type.Optional(Type.Array(Type.String())),

  /** FHIR R4 clinical status — relevant for condition notes */
  clinical_status: Type.Optional(ClinicalStatusSchema),

  /** FHIR R4 verification status — diagnostic certainty for condition notes */
  verification_status: Type.Optional(VerificationStatusSchema),

  /** SNOMED CT concept ID (numeric string, e.g. "73211009" for diabetes mellitus) */
  snomed_ct: Type.Optional(
    Type.String({ description: 'SNOMED CT concept ID (numeric string)' }),
  ),

  /** SNOMED CT fully specified name for human readability */
  snomed_display: Type.Optional(
    Type.String({ description: 'SNOMED CT fully specified name' }),
  ),

  /** ICD-10-CM code (e.g. "E11" for type 2 diabetes mellitus) */
  icd10: Type.Optional(
    Type.String({ description: 'ICD-10-CM code' }),
  ),

  /** ICD-10-CM display name for human readability */
  icd10_display: Type.Optional(
    Type.String({ description: 'ICD-10-CM display name' }),
  ),

  /** ISO 8601 date of condition onset — when the clinical condition began */
  onset: Type.Optional(
    Type.String({ description: 'ISO 8601 date of condition onset' }),
  ),

  /** Whether the condition is chronic (long-term, ongoing management required) */
  chronic: Type.Optional(Type.Boolean()),
});

export type KnowledgeNoteMeta = Static<typeof KnowledgeNoteMetaSchema>;
