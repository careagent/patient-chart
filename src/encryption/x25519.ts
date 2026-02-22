import {
  generateKeyPairSync,
  diffieHellman,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';
import { CryptoError } from './errors.js';

/**
 * X25519 SPKI DER header (12 bytes).
 * ASN.1: SEQUENCE { SEQUENCE { OID 1.3.101.110 }, BIT STRING ... }
 */
export const X25519_SPKI_HEADER: Readonly<Buffer> = Buffer.from(
  '302a300506032b656e032100',
  'hex',
);

/**
 * X25519 PKCS8 DER header (16 bytes).
 * ASN.1: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.110 }, OCTET STRING { OCTET STRING ... } }
 */
export const X25519_PKCS8_HEADER: Readonly<Buffer> = Buffer.from(
  '302e020100300506032b656e04220420',
  'hex',
);

/**
 * Generate an X25519 key pair for Diffie-Hellman key agreement.
 *
 * Used for per-recipient encrypted sync payloads — each recipient's
 * X25519 public key enables computing a unique shared secret without
 * sharing the vault's master key.
 *
 * @returns Object with publicKey and privateKey KeyObjects
 */
export function generateX25519KeyPair(): {
  publicKey: KeyObject;
  privateKey: KeyObject;
} {
  return generateKeyPairSync('x25519');
}

/**
 * Compute a shared secret via X25519 Diffie-Hellman key agreement.
 *
 * Both sides compute the same 32-byte shared secret:
 * - Alice: computeSharedSecret(alicePrivate, bobPublic)
 * - Bob:   computeSharedSecret(bobPrivate, alicePublic)
 *
 * The result is suitable as an AES-256-GCM key directly.
 *
 * OpenSSL automatically rejects low-order X25519 public keys
 * (all-zeros, order-2, order-4, order-8) with an error that is
 * wrapped in CryptoError for a consistent error surface.
 *
 * @param ownPrivateKey - Own X25519 private key
 * @param peerPublicKey - Peer's X25519 public key
 * @returns 32-byte shared secret Buffer
 * @throws CryptoError if key agreement fails (e.g., low-order public key)
 */
export function computeSharedSecret(
  ownPrivateKey: KeyObject,
  peerPublicKey: KeyObject,
): Buffer {
  try {
    return diffieHellman({ publicKey: peerPublicKey, privateKey: ownPrivateKey });
  } catch (err) {
    throw new CryptoError(
      `X25519 key agreement failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Export an X25519 public key to DER SPKI format (44 bytes).
 *
 * @param key - X25519 public KeyObject
 * @returns DER-encoded SPKI public key Buffer
 */
export function exportX25519PublicKey(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' });
}

/**
 * Export an X25519 private key to DER PKCS8 format (48 bytes).
 *
 * @param key - X25519 private KeyObject
 * @returns DER-encoded PKCS8 private key Buffer
 */
export function exportX25519PrivateKey(key: KeyObject): Buffer {
  return key.export({ type: 'pkcs8', format: 'der' });
}

/**
 * Import an X25519 public key from DER SPKI format.
 *
 * @param der - DER-encoded SPKI public key (44 bytes)
 * @returns X25519 public KeyObject
 */
export function importX25519PublicKey(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Import an X25519 private key from DER PKCS8 format.
 *
 * @param der - DER-encoded PKCS8 private key (48 bytes)
 * @returns X25519 private KeyObject
 */
export function importX25519PrivateKey(der: Buffer): KeyObject {
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
