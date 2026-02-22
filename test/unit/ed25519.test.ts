import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  sign,
  verifySignature,
  exportEd25519PublicKey,
  exportEd25519PrivateKey,
  importEd25519PublicKey,
  importEd25519PrivateKey,
} from '../../src/encryption/ed25519.js';

describe('Ed25519 Digital Signatures', () => {
  it('generateEd25519KeyPair returns publicKey and privateKey KeyObjects', () => {
    const pair = generateEd25519KeyPair();
    expect(pair).toHaveProperty('publicKey');
    expect(pair).toHaveProperty('privateKey');
    expect(pair.publicKey.type).toBe('public');
    expect(pair.privateKey.type).toBe('private');
  });

  it('sign returns a 64-byte Buffer', () => {
    const pair = generateEd25519KeyPair();
    const data = Buffer.from('hello world');
    const signature = sign(data, pair.privateKey);
    expect(Buffer.isBuffer(signature)).toBe(true);
    expect(signature.length).toBe(64);
  });

  it('sign + verifySignature round-trip returns true on original data', () => {
    const pair = generateEd25519KeyPair();
    const data = Buffer.from('patient chart entry data');
    const signature = sign(data, pair.privateKey);
    expect(verifySignature(data, signature, pair.publicKey)).toBe(true);
  });

  it('verifySignature returns false on tampered data', () => {
    const pair = generateEd25519KeyPair();
    const data = Buffer.from('original data');
    const signature = sign(data, pair.privateKey);
    const tampered = Buffer.from('tampered data');
    expect(verifySignature(tampered, signature, pair.publicKey)).toBe(false);
  });

  it('verifySignature returns false with wrong public key', () => {
    const pair1 = generateEd25519KeyPair();
    const pair2 = generateEd25519KeyPair();
    const data = Buffer.from('signed by pair1');
    const signature = sign(data, pair1.privateKey);
    expect(verifySignature(data, signature, pair2.publicKey)).toBe(false);
  });

  it('sign uses null algorithm (Ed25519 internal SHA-512)', () => {
    // Ed25519 signatures are always exactly 64 bytes and deterministic.
    // Signing the same data with the same key always produces the same signature.
    const pair = generateEd25519KeyPair();
    const data = Buffer.from('deterministic signing test');
    const sig1 = sign(data, pair.privateKey);
    const sig2 = sign(data, pair.privateKey);
    expect(sig1.equals(sig2)).toBe(true);
    expect(sig1.length).toBe(64);
  });

  it('exportEd25519PublicKey returns 44-byte DER Buffer', () => {
    const pair = generateEd25519KeyPair();
    const der = exportEd25519PublicKey(pair.publicKey);
    expect(Buffer.isBuffer(der)).toBe(true);
    expect(der.length).toBe(44);
  });

  it('exportEd25519PrivateKey returns 48-byte DER Buffer', () => {
    const pair = generateEd25519KeyPair();
    const der = exportEd25519PrivateKey(pair.privateKey);
    expect(Buffer.isBuffer(der)).toBe(true);
    expect(der.length).toBe(48);
  });

  it('export + import round-trip: sign with original, verify with reimported — succeeds', () => {
    const pair = generateEd25519KeyPair();
    const data = Buffer.from('round-trip test data');
    const signature = sign(data, pair.privateKey);

    // Export and reimport
    const pubDer = exportEd25519PublicKey(pair.publicKey);
    const privDer = exportEd25519PrivateKey(pair.privateKey);
    const reimportedPub = importEd25519PublicKey(pubDer);
    const reimportedPriv = importEd25519PrivateKey(privDer);

    // Verify with reimported public key
    expect(verifySignature(data, signature, reimportedPub)).toBe(true);

    // Sign with reimported private key, verify with original public key
    const sig2 = sign(data, reimportedPriv);
    expect(verifySignature(data, sig2, pair.publicKey)).toBe(true);
  });

  it('DER public key starts with Ed25519 SPKI header (302a300506032b6570032100)', () => {
    const pair = generateEd25519KeyPair();
    const der = exportEd25519PublicKey(pair.publicKey);
    const expectedHeader = Buffer.from('302a300506032b6570032100', 'hex');
    expect(der.subarray(0, expectedHeader.length).equals(expectedHeader)).toBe(true);
  });

  it('sign handles large data (1MB) without error', () => {
    const pair = generateEd25519KeyPair();
    const largeData = Buffer.alloc(1024 * 1024, 0x42);
    const signature = sign(largeData, pair.privateKey);
    expect(signature.length).toBe(64);
    expect(verifySignature(largeData, signature, pair.publicKey)).toBe(true);
  });
});
