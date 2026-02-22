import { scryptSync, hkdfSync, randomBytes } from 'node:crypto';
import { CryptoError } from './errors.js';

/** Minimum allowed scrypt cost parameter (2^17). */
const MIN_N = 131072;

/**
 * Default KDF parameters for new vaults.
 * Salt is omitted — it is generated per vault via generateSalt().
 */
export const DEFAULT_KDF_PARAMS = {
  algorithm: 'scrypt' as const,
  N: MIN_N,
  r: 8,
  p: 1,
  key_length: 32,
} as const;

/**
 * Optional overrides for scrypt cost parameters.
 */
export interface DeriveOptions {
  /** CPU/memory cost parameter. Default 131072 (2^17), minimum 131072. */
  N?: number;
  /** Block size parameter. Default 8. */
  r?: number;
  /** Parallelization parameter. Default 1. */
  p?: number;
}

/**
 * Derive a 32-byte master key from a patient passphrase and salt using scrypt.
 *
 * The master key is used as Input Keying Material for HKDF to produce
 * purpose-specific sub-keys (encryption, key-wrapping, etc.).
 *
 * @param passphrase - Patient passphrase (any non-empty string)
 * @param salt - Cryptographically random salt (use generateSalt())
 * @param options - Optional scrypt cost parameter overrides
 * @returns 32-byte master key as Buffer
 * @throws CryptoError if N < 131072
 */
export function deriveMasterKey(
  passphrase: string,
  salt: Buffer,
  options?: DeriveOptions,
): Buffer {
  const N = options?.N ?? DEFAULT_KDF_PARAMS.N;
  const r = options?.r ?? DEFAULT_KDF_PARAMS.r;
  const p = options?.p ?? DEFAULT_KDF_PARAMS.p;

  if (N < MIN_N) {
    throw new CryptoError(
      `scrypt cost parameter N must be at least ${MIN_N}, got ${N}`,
    );
  }

  return scryptSync(passphrase, salt, 32, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
}

/**
 * Derive a purpose-specific sub-key from a master key using HKDF-SHA256.
 *
 * The info parameter provides domain separation — different info strings
 * produce cryptographically independent keys from the same master key.
 * Common info values: 'patient-chart:encryption', 'patient-chart:key-wrapping'.
 *
 * @param masterKey - Master key derived from deriveMasterKey()
 * @param salt - Salt bytes (can be the same salt used for scrypt)
 * @param info - Domain separation string (e.g., 'patient-chart:encryption')
 * @param length - Desired key length in bytes (default 32)
 * @returns Derived sub-key as Buffer
 */
export function deriveSubKey(
  masterKey: Buffer,
  salt: Buffer,
  info: string,
  length?: number,
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, salt, info, length ?? 32),
  );
}

/**
 * Generate a cryptographically random salt.
 *
 * @param length - Salt length in bytes (default 32)
 * @returns Random salt as Buffer
 */
export function generateSalt(length?: number): Buffer {
  return randomBytes(length ?? 32);
}
