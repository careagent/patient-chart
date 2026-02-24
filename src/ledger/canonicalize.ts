import type { SignableContent } from '../types/ledger.js';

/**
 * Produces a deterministic byte representation of SignableContent for Ed25519 signing.
 * Keys are sorted recursively at every nesting level to ensure identical output
 * regardless of object construction order.
 */
export function canonicalize(signable: SignableContent): Buffer {
  const json = JSON.stringify(signable, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
  return Buffer.from(json, 'utf-8');
}
