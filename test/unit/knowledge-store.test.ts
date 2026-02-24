import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KnowledgeStore } from '../../src/knowledge/store.js';
import { encrypt } from '../../src/encryption/aes.js';
import {
  NoteNotFoundError,
  NoteCorruptedError,
  PathTraversalError,
} from '../../src/knowledge/errors.js';
import type { VaultAuditPipeline } from '../../src/audit/writer.js';
import type { VaultEventType, AuditActor } from '../../src/types/audit.js';

/**
 * TDD test suite for KnowledgeStore — encrypted knowledge note CRUD.
 *
 * Uses real encrypt/decrypt with a randomly generated 32-byte key
 * in a temporary vault directory for each test.
 */

// Shared test key infrastructure
const testKey = randomBytes(32);
const testKeyId = 'test-key-001';

function makeGetActiveKey() {
  return () => ({ keyId: testKeyId, key: testKey });
}

function makeGetKeyById() {
  return (keyId: string) => {
    if (keyId === testKeyId) return testKey;
    throw new Error(`Unknown key: ${keyId}`);
  };
}

// Mock audit pipeline that records events
interface RecordedEvent {
  event_type: VaultEventType;
  actor: AuditActor;
  outcome: 'success' | 'error' | 'info';
  details: Record<string, unknown>;
}

function createMockPipeline(): { pipeline: VaultAuditPipeline; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const pipeline = {
    write(entry: Omit<RecordedEvent, never>) {
      events.push(entry as RecordedEvent);
    },
  } as unknown as VaultAuditPipeline;
  return { pipeline, events };
}

describe('KnowledgeStore', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), 'vault-'));
    mkdirSync(join(vaultPath, 'knowledge'), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // ===== writeNote =====

  describe('writeNote', () => {
    it('encrypts content and writes a .enc file to disk', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());
      const content = '# Diabetes\nType 2 diabetes mellitus';

      store.writeNote('conditions/diabetes', content);

      const filePath = join(vaultPath, 'knowledge', 'conditions', 'diabetes.enc');
      const raw = readFileSync(filePath, 'utf-8');
      const payload = JSON.parse(raw);

      // Must be a valid EncryptedPayload
      expect(payload).toHaveProperty('ciphertext');
      expect(payload).toHaveProperty('iv');
      expect(payload).toHaveProperty('auth_tag');
      expect(payload).toHaveProperty('key_id');
      expect(payload.key_id).toBe(testKeyId);

      // Content on disk must NOT contain plaintext
      expect(raw).not.toContain('Diabetes');
      expect(raw).not.toContain('mellitus');
    });

    it('creates parent directories recursively', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/subcategory/deep/note', 'deep note content');

      const filePath = join(vaultPath, 'knowledge', 'conditions', 'subcategory', 'deep', 'note.enc');
      const raw = readFileSync(filePath, 'utf-8');
      expect(JSON.parse(raw)).toHaveProperty('ciphertext');
    });

    it('overwrites existing note atomically', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/diabetes', 'v1 content');
      store.writeNote('conditions/diabetes', 'v2 content');

      const content = store.readNote('conditions/diabetes');
      expect(content).toBe('v2 content');
    });

    it('throws PathTraversalError for ../../keys/keyring path', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(() => store.writeNote('../../keys/keyring', 'evil')).toThrow(PathTraversalError);
    });

    it('throws PathTraversalError for ../../../etc/passwd path', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(() => store.writeNote('../../../etc/passwd', 'evil')).toThrow(PathTraversalError);
    });

    it('emits knowledge_note_created audit event for new note', () => {
      const { pipeline, events } = createMockPipeline();
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById(), pipeline);

      store.writeNote('conditions/diabetes', '# Diabetes');

      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe('knowledge_note_created');
    });

    it('emits knowledge_note_updated audit event when overwriting existing note', () => {
      const { pipeline, events } = createMockPipeline();
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById(), pipeline);

      store.writeNote('conditions/diabetes', 'v1');
      store.writeNote('conditions/diabetes', 'v2');

      expect(events).toHaveLength(2);
      expect(events[0]!.event_type).toBe('knowledge_note_created');
      expect(events[1]!.event_type).toBe('knowledge_note_updated');
    });
  });

  // ===== readNote =====

  describe('readNote', () => {
    it('decrypts an encrypted note and returns the original markdown', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());
      const content = '# Metformin\n\nDose: 500mg twice daily\n\n## History\n- Started 2024-01-15';

      store.writeNote('medications/metformin', content);
      const result = store.readNote('medications/metformin');

      expect(result).toBe(content);
    });

    it('throws NoteNotFoundError for non-existent note', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(() => store.readNote('nonexistent')).toThrow(NoteNotFoundError);
    });

    it('throws NoteCorruptedError for invalid JSON .enc file', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      // Write invalid JSON directly
      const filePath = join(vaultPath, 'knowledge', 'corrupted.enc');
      writeFileSync(filePath, 'not valid json{{{');

      expect(() => store.readNote('corrupted')).toThrow(NoteCorruptedError);
    });

    it('throws NoteCorruptedError for valid JSON but invalid EncryptedPayload schema', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      // Write valid JSON but not an EncryptedPayload
      const filePath = join(vaultPath, 'knowledge', 'bad-schema.enc');
      writeFileSync(filePath, JSON.stringify({ foo: 'bar', baz: 42 }));

      expect(() => store.readNote('bad-schema')).toThrow(NoteCorruptedError);
    });

    it('throws NoteCorruptedError when decryption fails (wrong key)', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      // Write with a different key
      const otherKey = randomBytes(32);
      const payload = encrypt(Buffer.from('secret', 'utf-8'), otherKey, 'other-key-id');
      const filePath = join(vaultPath, 'knowledge', 'wrong-key.enc');
      mkdirSync(join(vaultPath, 'knowledge'), { recursive: true });
      writeFileSync(filePath, JSON.stringify(payload));

      // getKeyById will throw for unknown key, which should be caught as NoteCorruptedError
      expect(() => store.readNote('wrong-key')).toThrow(NoteCorruptedError);
    });

    it('throws PathTraversalError for ../../keys/keyring path', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(() => store.readNote('../../keys/keyring')).toThrow(PathTraversalError);
    });

    it('emits knowledge_note_read audit event', () => {
      const { pipeline, events } = createMockPipeline();
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById(), pipeline);

      store.writeNote('conditions/diabetes', '# Diabetes');
      events.length = 0; // Clear write event

      store.readNote('conditions/diabetes');

      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe('knowledge_note_read');
    });

    it('supports reading notes encrypted with rotated keys', () => {
      // Simulate key rotation: write with key A, then read with getKeyById that knows key A
      const keyA = randomBytes(32);
      const keyAId = 'rotated-key-a';

      const getActiveKey = () => ({ keyId: keyAId, key: keyA });
      const getKeyById = (keyId: string) => {
        if (keyId === keyAId) return keyA;
        if (keyId === testKeyId) return testKey;
        throw new Error(`Unknown key: ${keyId}`);
      };

      const store = new KnowledgeStore(vaultPath, getActiveKey, getKeyById);
      store.writeNote('conditions/old-note', 'written with old key');

      // Read should use getKeyById with the key_id from the payload
      const result = store.readNote('conditions/old-note');
      expect(result).toBe('written with old key');
    });
  });

  // ===== listNotes =====

  describe('listNotes', () => {
    it('returns all .enc files as relative paths without extension', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/diabetes', '# Diabetes');
      store.writeNote('conditions/hypertension', '# Hypertension');
      store.writeNote('medications/metformin', '# Metformin');

      const result = store.listNotes();
      expect(result).toEqual([
        'conditions/diabetes',
        'conditions/hypertension',
        'medications/metformin',
      ]);
    });

    it('returns notes relative to specified folder', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/diabetes', '# Diabetes');
      store.writeNote('conditions/hypertension', '# Hypertension');
      store.writeNote('medications/metformin', '# Metformin');

      const result = store.listNotes('conditions');
      expect(result).toEqual(['diabetes', 'hypertension']);
    });

    it('returns empty array when no notes exist', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(store.listNotes()).toEqual([]);
    });

    it('returns empty array for non-existent folder', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(store.listNotes('nonexistent')).toEqual([]);
    });

    it('returns results sorted alphabetically', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('z-note', 'z');
      store.writeNote('a-note', 'a');
      store.writeNote('m-note', 'm');

      const result = store.listNotes();
      expect(result).toEqual(['a-note', 'm-note', 'z-note']);
    });

    it('recursively walks subdirectories', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/sub/deep/note', 'deep');
      store.writeNote('conditions/top', 'top');

      const result = store.listNotes('conditions');
      expect(result).toEqual(['sub/deep/note', 'top']);
    });
  });

  // ===== noteExists =====

  describe('noteExists', () => {
    it('returns true when note file exists on disk', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      store.writeNote('conditions/diabetes', '# Diabetes');

      expect(store.noteExists('conditions/diabetes')).toBe(true);
    });

    it('returns false when note does not exist', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(store.noteExists('nonexistent')).toBe(false);
    });

    it('throws PathTraversalError for ../../keys/keyring path', () => {
      const store = new KnowledgeStore(vaultPath, makeGetActiveKey(), makeGetKeyById());

      expect(() => store.noteExists('../../keys/keyring')).toThrow(PathTraversalError);
    });
  });
});
