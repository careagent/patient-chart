import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../src/ledger/canonicalize.js';
import type { SignableContent } from '../../src/types/ledger.js';

/**
 * Helper to create a valid SignableContent with sensible defaults.
 * Override any field via the partial parameter.
 */
function makeSignable(overrides: Partial<SignableContent> = {}): SignableContent {
  return {
    id: '01961234-5678-7abc-8def-0123456789ab',
    timestamp: '2026-02-24T12:00:00.000Z',
    entry_type: 'clinical_encounter',
    author: {
      type: 'provider_agent',
      id: 'provider-1',
      display_name: 'Dr. Smith',
      public_key: 'AAAA',
    },
    payload: '{"diagnosis":"Healthy"}',
    metadata: {
      schema_version: '1',
      entry_type: 'clinical_encounter',
      author_type: 'provider_agent',
      author_id: 'provider-1',
      payload_size: 23,
    },
    ...overrides,
  };
}

describe('canonicalize', () => {
  it('produces deterministic output regardless of key insertion order', () => {
    // Object A: natural order
    const a = makeSignable();

    // Object B: deliberately reversed key insertion order
    const b: SignableContent = {
      metadata: a.metadata,
      payload: a.payload,
      author: {
        public_key: a.author.public_key,
        display_name: a.author.display_name,
        id: a.author.id,
        type: a.author.type,
      },
      entry_type: a.entry_type,
      timestamp: a.timestamp,
      id: a.id,
    };

    expect(canonicalize(a).equals(canonicalize(b))).toBe(true);
  });

  it('sorts keys in nested objects (author, metadata)', () => {
    const signable = makeSignable();
    const result = canonicalize(signable);
    const parsed = JSON.parse(result.toString('utf-8')) as Record<string, unknown>;

    // Top-level keys should be sorted
    const topKeys = Object.keys(parsed);
    expect(topKeys).toEqual([...topKeys].sort());

    // Author keys should be sorted
    const authorKeys = Object.keys(parsed['author'] as Record<string, unknown>);
    expect(authorKeys).toEqual([...authorKeys].sort());

    // Metadata keys should be sorted
    const metaKeys = Object.keys(parsed['metadata'] as Record<string, unknown>);
    expect(metaKeys).toEqual([...metaKeys].sort());
  });

  it('produces identical output on repeated calls (roundtrip stability)', () => {
    const signable = makeSignable();
    const first = canonicalize(signable);
    const second = canonicalize(signable);
    expect(first.equals(second)).toBe(true);
  });

  it('handles optional metadata fields correctly', () => {
    const withoutOptional = makeSignable();
    const withAmends = makeSignable({
      metadata: {
        ...withoutOptional.metadata,
        amends: '01960000-0000-7000-8000-000000000001',
      },
    });
    const withSynced = makeSignable({
      metadata: {
        ...withoutOptional.metadata,
        synced_entry: '01960000-0000-7000-8000-000000000002',
      },
    });

    // All should produce valid output
    const resultBase = canonicalize(withoutOptional);
    const resultAmends = canonicalize(withAmends);
    const resultSynced = canonicalize(withSynced);

    expect(resultBase.length).toBeGreaterThan(0);
    expect(resultAmends.length).toBeGreaterThan(0);
    expect(resultSynced.length).toBeGreaterThan(0);

    // Each should differ from the others
    expect(resultBase.equals(resultAmends)).toBe(false);
    expect(resultBase.equals(resultSynced)).toBe(false);
    expect(resultAmends.equals(resultSynced)).toBe(false);
  });

  it('correctly encodes UTF-8 characters in the payload', () => {
    const signable = makeSignable({
      payload: '{"note":"Patient reports \u00fc\u00e4\u00f6 and \u2764\ufe0f"}',
    });

    const result = canonicalize(signable);
    const decoded = result.toString('utf-8');

    expect(decoded).toContain('\u00fc\u00e4\u00f6');
    expect(decoded).toContain('\u2764\ufe0f');
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
