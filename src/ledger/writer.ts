import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { generateUUIDv7 } from '../util/uuidv7.js';
import { encrypt } from '../encryption/aes.js';
import { sign } from '../encryption/ed25519.js';
import { canonicalize } from './canonicalize.js';
import type {
  LedgerEntry,
  LedgerEntryType,
  EntryAuthor,
  EntryMetadata,
  SignableContent,
} from '../types/ledger.js';

/**
 * Append-only ledger writer that produces signed, encrypted, hash-chained entries.
 *
 * Pipeline per entry:
 *   1. Build metadata and SignableContent
 *   2. Canonicalize SignableContent -> deterministic bytes
 *   3. Sign canonical bytes with Ed25519
 *   4. Encrypt plaintext with AES-256-GCM (metadata as AAD)
 *   5. Inject prev_hash from lastHash (hash chain)
 *   6. Serialize to JSON, append to JSONL file
 *   7. Update lastHash to SHA-256 of the written JSON line
 *
 * Constructor recovers lastHash from an existing file via crash-recovery
 * pattern: walk backward from end, skip malformed trailing lines.
 */
export class LedgerWriter {
  private lastHash: string | null = null;
  private entryCount = 0;

  constructor(private readonly entriesPath: string) {
    this.lastHash = this.recoverLastHash();
  }

  /**
   * Write a new ledger entry.
   *
   * @param content - Arbitrary JSON-serializable payload to encrypt.
   * @param entryType - One of the 26 ledger entry types.
   * @param author - Entry author with identity information and public key.
   * @param getActiveKey - Function returning the active encryption key and its ID.
   * @param signingKey - Ed25519 private key for signing.
   * @param opts - Optional: { amends } to reference an amended entry UUID.
   * @returns The complete LedgerEntry as written to disk.
   */
  writeEntry(
    content: unknown,
    entryType: LedgerEntryType,
    author: EntryAuthor,
    getActiveKey: () => { keyId: string; key: Buffer },
    signingKey: KeyObject,
    opts?: { amends?: string },
  ): LedgerEntry {
    const id = generateUUIDv7();
    const timestamp = new Date().toISOString();

    // Build metadata -- only include defined optional fields
    const metadata: EntryMetadata = {
      schema_version: '1',
      entry_type: entryType,
      author_type: author.type,
      author_id: author.id,
      payload_size: 0,
    };

    if (opts?.amends !== undefined) {
      metadata.amends = opts.amends;
    }

    // Serialize payload
    const plaintext = JSON.stringify(content);
    metadata.payload_size = Buffer.byteLength(plaintext, 'utf-8');

    // Build SignableContent
    const signable: SignableContent = {
      id,
      timestamp,
      entry_type: entryType,
      author,
      payload: plaintext,
      metadata,
    };

    // Canonicalize for deterministic signing
    const canonical = canonicalize(signable);

    // Sign
    const signature = sign(canonical, signingKey);

    // Encrypt with metadata as AAD
    const { keyId, key } = getActiveKey();
    const aad = Buffer.from(JSON.stringify(metadata), 'utf-8');
    const encryptedPayload = encrypt(Buffer.from(plaintext, 'utf-8'), key, keyId, aad);

    // Build entry without prev_hash first, then inject
    const entry: LedgerEntry = {
      id,
      timestamp,
      entry_type: entryType,
      author,
      prev_hash: this.lastHash,
      signature: signature.toString('base64'),
      encrypted_payload: encryptedPayload,
      metadata,
    };

    // Serialize and append
    const line = JSON.stringify(entry);
    appendFileSync(this.entriesPath, line + '\n', { flag: 'a' });

    // Update hash chain
    this.lastHash = createHash('sha256').update(line).digest('hex');
    this.entryCount++;

    return entry;
  }

  /**
   * Get the SHA-256 hash of the last written JSON line, or null if no entries.
   */
  getLastHash(): string | null {
    return this.lastHash;
  }

  /**
   * Get the count of entries written by this writer instance.
   * Useful for triggering file rotation in future phases.
   */
  getEntryCount(): number {
    return this.entryCount;
  }

  /**
   * Recovers the last valid hash from an existing JSONL file.
   * Handles crash recovery: walks backward from end, skipping malformed
   * trailing lines to find the last parseable JSON line.
   */
  private recoverLastHash(): string | null {
    if (!existsSync(this.entriesPath)) return null;

    const content = readFileSync(this.entriesPath, 'utf-8').trimEnd();
    if (!content) return null;

    const lines = content.split('\n').filter((l) => l.trim());

    // Walk from end, find last valid (parseable) line
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        JSON.parse(lines[i]!);
        return createHash('sha256').update(lines[i]!).digest('hex');
      } catch {
        // Malformed last line (crash during write) -- try the line before
        continue;
      }
    }
    return null;
  }
}
