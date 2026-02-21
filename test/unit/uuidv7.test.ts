import { describe, it, expect } from 'vitest';
import { generateUUIDv7 } from '../../src/util/uuidv7.js';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUUIDv7', () => {
  it('returns a string matching UUID format', () => {
    expect(generateUUIDv7()).toMatch(UUID_V7_REGEX);
  });

  it('sets version nibble to 7', () => {
    const uuid = generateUUIDv7();
    expect(uuid[14]).toBe('7');
  });

  it('sets variant bits to 0b10xx (8, 9, a, or b)', () => {
    const uuid = generateUUIDv7();
    const variantChar = uuid[19];
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  it('embeds a timestamp close to now', () => {
    const before = Date.now();
    const uuid = generateUUIDv7();
    const after = Date.now();

    // Extract 48-bit timestamp from first 12 hex chars (6 bytes)
    const hex = uuid.replace(/-/g, '');
    const extractedMs = parseInt(hex.slice(0, 12), 16);

    expect(extractedMs).toBeGreaterThanOrEqual(before);
    expect(extractedMs).toBeLessThanOrEqual(after + 1); // +1ms tolerance
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUUIDv7()));
    expect(ids.size).toBe(100);
  });

  it('generates time-sortable UUIDs (later calls produce lexicographically larger values)', () => {
    const first = generateUUIDv7();
    // Small delay to ensure timestamp advances
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }
    const second = generateUUIDv7();
    expect(second > first).toBe(true);
  });
});
