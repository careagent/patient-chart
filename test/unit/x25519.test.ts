import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  computeSharedSecret,
  exportX25519PublicKey,
  exportX25519PrivateKey,
  importX25519PublicKey,
  importX25519PrivateKey,
} from '../../src/encryption/x25519.js';
import { CryptoError } from '../../src/encryption/errors.js';
import { createPublicKey } from 'node:crypto';

describe('X25519 Key Agreement', () => {
  it('generateX25519KeyPair returns publicKey and privateKey KeyObjects', () => {
    const pair = generateX25519KeyPair();
    expect(pair).toHaveProperty('publicKey');
    expect(pair).toHaveProperty('privateKey');
    expect(pair.publicKey.type).toBe('public');
    expect(pair.privateKey.type).toBe('private');
  });

  it('computeSharedSecret returns a 32-byte Buffer', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const secret = computeSharedSecret(alice.privateKey, bob.publicKey);
    expect(Buffer.isBuffer(secret)).toBe(true);
    expect(secret.length).toBe(32);
  });

  it('both sides produce identical shared secret', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const secretAlice = computeSharedSecret(alice.privateKey, bob.publicKey);
    const secretBob = computeSharedSecret(bob.privateKey, alice.publicKey);
    expect(secretAlice.equals(secretBob)).toBe(true);
  });

  it('different key pairs produce different shared secrets', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const charlie = generateX25519KeyPair();
    const secretAB = computeSharedSecret(alice.privateKey, bob.publicKey);
    const secretAC = computeSharedSecret(alice.privateKey, charlie.publicKey);
    expect(secretAB.equals(secretAC)).toBe(false);
  });

  it('low-order public key (all-zeros 32 bytes) is rejected with an error', () => {
    const alice = generateX25519KeyPair();
    // Construct an all-zeros X25519 public key via DER SPKI format
    const x25519SpkiHeader = Buffer.from('302a300506032b656e032100', 'hex');
    const zeroKey = Buffer.alloc(32, 0x00);
    const zeroDer = Buffer.concat([x25519SpkiHeader, zeroKey]);
    const lowOrderPub = createPublicKey({
      key: zeroDer,
      format: 'der',
      type: 'spki',
    });
    expect(() => computeSharedSecret(alice.privateKey, lowOrderPub)).toThrow(
      CryptoError,
    );
  });

  it('exportX25519PublicKey returns 44-byte DER Buffer', () => {
    const pair = generateX25519KeyPair();
    const der = exportX25519PublicKey(pair.publicKey);
    expect(Buffer.isBuffer(der)).toBe(true);
    expect(der.length).toBe(44);
  });

  it('exportX25519PrivateKey returns 48-byte DER Buffer', () => {
    const pair = generateX25519KeyPair();
    const der = exportX25519PrivateKey(pair.privateKey);
    expect(Buffer.isBuffer(der)).toBe(true);
    expect(der.length).toBe(48);
  });

  it('export + import round-trip: compute shared secret with reimported keys — same result', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();

    const secretOriginal = computeSharedSecret(alice.privateKey, bob.publicKey);

    // Export and reimport Alice's keys
    const alicePubDer = exportX25519PublicKey(alice.publicKey);
    const alicePrivDer = exportX25519PrivateKey(alice.privateKey);
    const reimportedAlicePub = importX25519PublicKey(alicePubDer);
    const reimportedAlicePriv = importX25519PrivateKey(alicePrivDer);

    // Compute with reimported keys
    const secretReimported = computeSharedSecret(
      reimportedAlicePriv,
      bob.publicKey,
    );
    expect(secretReimported.equals(secretOriginal)).toBe(true);

    // Compute from Bob's side with reimported Alice public key
    const secretBob = computeSharedSecret(bob.privateKey, reimportedAlicePub);
    expect(secretBob.equals(secretOriginal)).toBe(true);
  });

  it('DER public key starts with X25519 SPKI header (302a300506032b656e032100)', () => {
    const pair = generateX25519KeyPair();
    const der = exportX25519PublicKey(pair.publicKey);
    const expectedHeader = Buffer.from('302a300506032b656e032100', 'hex');
    expect(der.subarray(0, expectedHeader.length).equals(expectedHeader)).toBe(
      true,
    );
  });

  it('computeSharedSecret wraps OpenSSL errors in CryptoError', () => {
    const alice = generateX25519KeyPair();
    // Construct an all-zeros X25519 public key (low-order point)
    const x25519SpkiHeader = Buffer.from('302a300506032b656e032100', 'hex');
    const zeroKey = Buffer.alloc(32, 0x00);
    const zeroDer = Buffer.concat([x25519SpkiHeader, zeroKey]);
    const lowOrderPub = createPublicKey({
      key: zeroDer,
      format: 'der',
      type: 'spki',
    });

    try {
      computeSharedSecret(alice.privateKey, lowOrderPub);
      // Should not reach here
      expect.unreachable('Expected CryptoError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CryptoError);
      expect((err as CryptoError).name).toBe('CryptoError');
    }
  });
});
