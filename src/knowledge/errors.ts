/**
 * Base error class for all knowledge store operation failures.
 * Subclasses provide specific failure modes for caller-friendly error handling.
 */
export class KnowledgeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeStoreError';
  }
}

/**
 * Thrown when reading a knowledge note that does not exist on disk.
 * The relativePath is included in the message for diagnostics.
 */
export class NoteNotFoundError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Knowledge note not found: ${relativePath}`);
    this.name = 'NoteNotFoundError';
  }
}

/**
 * Thrown when a knowledge note file fails EncryptedPayload schema validation
 * or decryption — indicates corruption or tampering.
 */
export class NoteCorruptedError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Knowledge note corrupted or tampered with: ${relativePath}`);
    this.name = 'NoteCorruptedError';
  }
}

/**
 * Thrown when a relativePath resolves outside the knowledge/ directory.
 * Prevents directory traversal attacks via paths like "../ledger/secret".
 */
export class PathTraversalError extends KnowledgeStoreError {
  constructor(relativePath: string) {
    super(`Path traversal detected: ${relativePath}`);
    this.name = 'PathTraversalError';
  }
}
