import { describe, it, expect } from 'vitest';
import {
  deriveMasterKey,
  deriveSubKey,
  generateSalt,
  DEFAULT_KDF_PARAMS,
} from '../../src/encryption/kdf.js';
import { CryptoError } from '../../src/encryption/errors.js';

describe('deriveMasterKey', () => {
  const passphrase = 'test-patient-passphrase';
  const salt = Buffer.alloc(32, 0xab);

  it('returns a 32-byte Buffer', () => {
    const key = deriveMasterKey(passphrase, salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('is deterministic: same passphrase + salt + params = same key', () => {
    const key1 = deriveMasterKey(passphrase, salt);
    const key2 = deriveMasterKey(passphrase, salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it('produces different keys with different passphrases', () => {
    const key1 = deriveMasterKey('passphrase-a', salt);
    const key2 = deriveMasterKey('passphrase-b', salt);
    expect(key1.equals(key2)).toBe(false);
  });

  it('produces different keys with different salts', () => {
    const salt1 = Buffer.alloc(32, 0x01);
    const salt2 = Buffer.alloc(32, 0x02);
    const key1 = deriveMasterKey(passphrase, salt1);
    const key2 = deriveMasterKey(passphrase, salt2);
    expect(key1.equals(key2)).toBe(false);
  });

  it('enforces minimum N of 2^17 (131072) — throws CryptoError if N < 131072', () => {
    expect(() => deriveMasterKey(passphrase, salt, { N: 1024 })).toThrow(CryptoError);
    expect(() => deriveMasterKey(passphrase, salt, { N: 1024 })).toThrow(
      /scrypt cost parameter N must be at least 131072/,
    );
  });

  it('with default params uses N=131072, r=8, p=1', () => {
    expect(DEFAULT_KDF_PARAMS.N).toBe(131072);
    expect(DEFAULT_KDF_PARAMS.r).toBe(8);
    expect(DEFAULT_KDF_PARAMS.p).toBe(1);
    expect(DEFAULT_KDF_PARAMS.algorithm).toBe('scrypt');
    expect(DEFAULT_KDF_PARAMS.key_length).toBe(32);
  });
});

describe('deriveSubKey', () => {
  const masterKey = Buffer.alloc(32, 0xcc);
  const salt = Buffer.alloc(32, 0xdd);

  it('produces a 32-byte Buffer', () => {
    const subKey = deriveSubKey(masterKey, salt, 'patient-chart:encryption');
    expect(Buffer.isBuffer(subKey)).toBe(true);
    expect(subKey.length).toBe(32);
  });

  it('with different info strings produces different keys (domain separation)', () => {
    const key1 = deriveSubKey(masterKey, salt, 'patient-chart:encryption');
    const key2 = deriveSubKey(masterKey, salt, 'patient-chart:key-wrapping');
    expect(key1.equals(key2)).toBe(false);
  });

  it('is deterministic: same master + salt + info = same sub-key', () => {
    const key1 = deriveSubKey(masterKey, salt, 'patient-chart:encryption');
    const key2 = deriveSubKey(masterKey, salt, 'patient-chart:encryption');
    expect(key1.equals(key2)).toBe(true);
  });
});

describe('generateSalt', () => {
  it('returns a 32-byte Buffer of random bytes', () => {
    const salt = generateSalt();
    expect(Buffer.isBuffer(salt)).toBe(true);
    expect(salt.length).toBe(32);

    // Two calls should produce different salts (probabilistic, but ~impossible to collide)
    const salt2 = generateSalt();
    expect(salt.equals(salt2)).toBe(false);
  });
});
