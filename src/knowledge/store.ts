import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { encrypt, decrypt } from '../encryption/aes.js';
import { EncryptedPayloadSchema } from '../types/encryption.js';
import type { EncryptedPayload } from '../types/encryption.js';
import {
  NoteNotFoundError,
  NoteCorruptedError,
  PathTraversalError,
} from './errors.js';
import type { VaultAuditPipeline } from '../audit/writer.js';

/**
 * Encrypted knowledge note store — the core API of the knowledge graph layer.
 *
 * A thin encryption/IO layer that encrypts markdown notes to EncryptedPayload
 * JSON files on disk and decrypts them on read. Composes existing primitives
 * (encrypt/decrypt, atomic write-then-rename, audit pipeline) into a clean
 * 4-method API: writeNote, readNote, listNotes, noteExists.
 *
 * All file operations are synchronous (consistent with codebase convention).
 * No plaintext ever touches disk — content is encrypted before writing and
 * decrypted only in memory after reading.
 */
export class KnowledgeStore {
  private readonly knowledgeDir: string;

  /**
   * @param vaultPath - Absolute path to the vault root directory.
   * @param getActiveKey - Returns the active encryption key and its ID.
   * @param getKeyById - Returns a decrypted key by ID (supports rotated keys).
   * @param pipeline - Optional audit pipeline for emitting knowledge events.
   */
  constructor(
    private readonly vaultPath: string,
    private readonly getActiveKey: () => { keyId: string; key: Buffer },
    private readonly getKeyById: (keyId: string) => Buffer,
    private readonly pipeline?: VaultAuditPipeline,
  ) {
    this.knowledgeDir = resolve(join(vaultPath, 'knowledge'));
  }

  /**
   * Encrypt and write a markdown note to disk.
   *
   * Uses atomic write-then-rename to prevent partial writes. Emits
   * knowledge_note_created or knowledge_note_updated audit event based
   * on whether the note already exists.
   *
   * @param relativePath - Path relative to knowledge/ (without .enc extension).
   * @param content - Markdown content to encrypt and store.
   * @throws {PathTraversalError} If the path escapes the knowledge/ directory.
   */
  writeNote(relativePath: string, content: string): void {
    const filePath = this.validatePath(relativePath);
    const existed = existsSync(filePath);

    const { keyId, key } = this.getActiveKey();
    const payload = encrypt(Buffer.from(content, 'utf-8'), key, keyId);

    // Ensure parent directory exists
    mkdirSync(dirname(filePath), { recursive: true });

    // Atomic write: write to temp file, then rename
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(payload));
    renameSync(tmpPath, filePath);

    // Emit audit event
    this.pipeline?.write({
      event_type: existed ? 'knowledge_note_updated' : 'knowledge_note_created',
      actor: { type: 'system', id: 'system', display_name: 'System' },
      outcome: 'success',
      details: { path: relativePath },
    });
  }

  /**
   * Read and decrypt a knowledge note from disk.
   *
   * Parses the EncryptedPayload JSON, validates against schema, looks up the
   * correct key by key_id (supporting rotated keys), decrypts, and returns
   * the original markdown string. Emits knowledge_note_read audit event.
   *
   * @param relativePath - Path relative to knowledge/ (without .enc extension).
   * @returns The decrypted markdown content.
   * @throws {PathTraversalError} If the path escapes the knowledge/ directory.
   * @throws {NoteNotFoundError} If the note file does not exist.
   * @throws {NoteCorruptedError} If the file is invalid JSON, fails schema
   *   validation, or decryption fails.
   */
  readNote(relativePath: string): string {
    const filePath = this.validatePath(relativePath);

    if (!existsSync(filePath)) {
      throw new NoteNotFoundError(relativePath);
    }

    let raw: string;
    let payload: EncryptedPayload;

    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      throw new NoteCorruptedError(relativePath);
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NoteCorruptedError(relativePath);
    }

    // Validate against EncryptedPayload schema
    if (!Value.Check(EncryptedPayloadSchema, parsed)) {
      throw new NoteCorruptedError(relativePath);
    }

    payload = parsed;

    // Decrypt using the key_id from the payload (supports rotated keys)
    let key: Buffer;
    try {
      key = this.getKeyById(payload.key_id);
    } catch {
      throw new NoteCorruptedError(relativePath);
    }

    try {
      const plaintext = decrypt(payload, key);
      this.pipeline?.write({
        event_type: 'knowledge_note_read',
        actor: { type: 'system', id: 'system', display_name: 'System' },
        outcome: 'success',
        details: { path: relativePath },
      });
      return plaintext.toString('utf-8');
    } catch {
      throw new NoteCorruptedError(relativePath);
    }
  }

  /**
   * List all knowledge notes in the vault or a specific folder.
   *
   * Recursively walks the directory tree and returns .enc files as relative
   * paths without the .enc extension. Results are sorted alphabetically.
   *
   * @param folder - Optional subfolder within knowledge/ to list.
   * @returns Array of relative paths (without .enc extension), sorted alphabetically.
   */
  listNotes(folder?: string): string[] {
    let searchDir: string;

    if (folder !== undefined) {
      // Validate folder path (add a dummy filename for path validation)
      const testPath = resolve(join(this.knowledgeDir, folder));
      if (!testPath.startsWith(this.knowledgeDir)) {
        throw new PathTraversalError(folder);
      }
      searchDir = testPath;
    } else {
      searchDir = this.knowledgeDir;
    }

    if (!existsSync(searchDir)) {
      return [];
    }

    const results: string[] = [];
    this.walkDir(searchDir, searchDir, results);
    return results.sort();
  }

  /**
   * Check whether a knowledge note exists on disk.
   *
   * @param relativePath - Path relative to knowledge/ (without .enc extension).
   * @returns true if the .enc file exists, false otherwise.
   * @throws {PathTraversalError} If the path escapes the knowledge/ directory.
   */
  noteExists(relativePath: string): boolean {
    const filePath = this.validatePath(relativePath);
    return existsSync(filePath);
  }

  /**
   * Validate that a relative path resolves within the knowledge/ directory.
   * Returns the resolved absolute path to the .enc file.
   *
   * @throws {PathTraversalError} If the resolved path escapes knowledge/.
   */
  private validatePath(relativePath: string): string {
    const filePath = resolve(join(this.knowledgeDir, relativePath + '.enc'));

    if (!filePath.startsWith(this.knowledgeDir + '/') && filePath !== this.knowledgeDir) {
      throw new PathTraversalError(relativePath);
    }

    return filePath;
  }

  /**
   * Recursively walk a directory tree, collecting .enc file paths.
   */
  private walkDir(dir: string, baseDir: string, results: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        this.walkDir(fullPath, baseDir, results);
      } else if (entry.isFile() && entry.name.endsWith('.enc')) {
        // Strip .enc extension and make relative to baseDir
        const rel = relative(baseDir, fullPath);
        results.push(rel.replace(/\.enc$/, ''));
      }
    }
  }
}
