/**
 * Base error class for all ledger operation failures.
 * Subclasses provide specific failure modes for caller-friendly error handling.
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Thrown when the ledger file is malformed, corrupted, or has been tampered with.
 * The vault should fail hard -- no silent degradation or recovery attempts.
 */
export class LedgerCorruptedError extends LedgerError {
  constructor() {
    super('Ledger file is corrupted or has been tampered with');
    this.name = 'LedgerCorruptedError';
  }
}

/**
 * Thrown when an Ed25519 signature fails verification for a specific entry.
 * Includes the entry ID for precise diagnosis.
 */
export class SignatureVerificationError extends LedgerError {
  constructor(entryId: string) {
    super(`Signature verification failed for entry: ${entryId}`);
    this.name = 'SignatureVerificationError';
  }
}

/**
 * Thrown when the hash chain is broken at a specific entry index.
 * Indicates tampering or corruption between entries.
 */
export class ChainVerificationError extends LedgerError {
  constructor(entryIndex: number) {
    super(`Hash chain verification failed at entry index: ${entryIndex}`);
    this.name = 'ChainVerificationError';
  }
}
