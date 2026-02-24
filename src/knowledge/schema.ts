/**
 * Knowledge graph directory structure constants and re-exports.
 *
 * KNOWLEDGE_SUBDIRS defines the 10 clinical domain subdirectories within knowledge/.
 * These map to the NoteType union values (minus 'problem_list', which lives at the
 * knowledge/ root level as the central organizing document).
 */
export const KNOWLEDGE_SUBDIRS = [
  'conditions',
  'medications',
  'allergies',
  'labs',
  'imaging',
  'procedures',
  'providers',
  'encounters',
  'directives',
  'documents',
] as const;

export type KnowledgeSubdir = typeof KNOWLEDGE_SUBDIRS[number];

// Re-export knowledge note metadata schema and type for knowledge module consumers
export { KnowledgeNoteMetaSchema } from '../types/knowledge.js';
export type { KnowledgeNoteMeta } from '../types/knowledge.js';
