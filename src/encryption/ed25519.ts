import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';

/**
 * Ed25519 SPKI DER header (12 bytes).
 * ASN.1: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING ... }
 */
export const ED25519_SPKI_HEADER: Readonly<Buffer> = Buffer.from(
  '302a300506032b6570032100',
  'hex',
);

/**
 * Ed25519 PKCS8 DER header (16 bytes).
 * ASN.1: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING ... } }
 */
export const ED25519_PKCS8_HEADER: Readonly<Buffer> = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

/**
 * Generate an Ed25519 key pair for digital signatures.
 *
 * Used for vault identity (ledger entry signing) — every entry is
 * cryptographically signed by its author for tamper-proof integrity.
 *
 * @returns Object with publicKey and privateKey KeyObjects
 */
export function generateEd25519KeyPair(): {
  publicKey: KeyObject;
  privateKey: KeyObject;
} {
  return generateKeyPairSync('ed25519');
}

/**
 * Sign data using an Ed25519 private key.
 *
 * Ed25519 uses internal SHA-512 per RFC 8032 — the algorithm parameter
 * is always null (no external digest).
 *
 * @param data - Data to sign (any length)
 * @param privateKey - Ed25519 private key
 * @returns 64-byte signature Buffer
 */
export function sign(data: Buffer, privateKey: KeyObject): Buffer {
  return cryptoSign(null, data, privateKey);
}

/**
 * Verify an Ed25519 signature against data and a public key.
 *
 * @param data - Original data that was signed
 * @param signature - 64-byte signature to verify
 * @param publicKey - Ed25519 public key of the signer
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(
  data: Buffer,
  signature: Buffer,
  publicKey: KeyObject,
): boolean {
  return cryptoVerify(null, data, publicKey, signature);
}

/**
 * Export an Ed25519 public key to DER SPKI format (44 bytes).
 *
 * @param key - Ed25519 public KeyObject
 * @returns DER-encoded SPKI public key Buffer
 */
export function exportEd25519PublicKey(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' });
}

/**
 * Export an Ed25519 private key to DER PKCS8 format (48 bytes).
 *
 * @param key - Ed25519 private KeyObject
 * @returns DER-encoded PKCS8 private key Buffer
 */
export function exportEd25519PrivateKey(key: KeyObject): Buffer {
  return key.export({ type: 'pkcs8', format: 'der' });
}

/**
 * Import an Ed25519 public key from DER SPKI format.
 *
 * @param der - DER-encoded SPKI public key (44 bytes)
 * @returns Ed25519 public KeyObject
 */
export function importEd25519PublicKey(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Import an Ed25519 private key from DER PKCS8 format.
 *
 * @param der - DER-encoded PKCS8 private key (48 bytes)
 * @returns Ed25519 private KeyObject
 */
export function importEd25519PrivateKey(der: Buffer): KeyObject {
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
