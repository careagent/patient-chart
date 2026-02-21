import { randomBytes } from 'node:crypto';

/**
 * Generates a UUIDv7 (RFC 9562) — time-sortable UUID with embedded
 * millisecond timestamp. Uses only node:crypto, zero external dependencies.
 *
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 * - Bytes 0-5: 48-bit Unix timestamp in milliseconds (big-endian)
 * - Bytes 6-7: 0x7 version nibble + 12 random bits
 * - Bytes 8-9: 0b10 variant bits + 14 random bits
 * - Bytes 10-15: 48 random bits
 *
 * Note: Sub-millisecond monotonicity not guaranteed. For Phase 1, entries
 * are ordered by JSONL position (hash chain), not UUID. Sufficient for
 * unique identification purposes.
 */
export function generateUUIDv7(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  // Fill bytes 0-5 with 48-bit millisecond timestamp (big-endian)
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Set version 7 in the high nibble of byte 6
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;

  // Set RFC 4122 variant (0b10) in the high bits of byte 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  // Format as standard UUID string (8-4-4-4-12)
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
