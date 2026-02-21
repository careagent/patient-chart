import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AuditWriter } from '../../src/audit/writer.js';
import { verifyChain } from '../../src/audit/integrity.js';

const SYSTEM_ACTOR = {
  type: 'system' as const,
  id: 'system',
  display_name: 'System',
};

describe('verifyChain', () => {
  let testDir: string;
  let logPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `audit-integrity-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    logPath = join(testDir, 'audit.jsonl');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns { valid: true, entries: 0 } for missing file', () => {
    const result = verifyChain('/tmp/nonexistent-audit.jsonl');
    expect(result).toEqual({ valid: true, entries: 0 });
  });

  it('returns { valid: true, entries: 0 } for empty file', () => {
    writeFileSync(logPath, '');
    const result = verifyChain(logPath);
    expect(result).toEqual({ valid: true, entries: 0 });
  });

  it('validates a single genesis entry', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    const result = verifyChain(logPath);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('validates a multi-entry chain', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-2', timestamp: new Date().toISOString(), event_type: 'vault_opened', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-3', timestamp: new Date().toISOString(), event_type: 'vault_closed', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    const result = verifyChain(logPath);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
  });

  it('detects a modified entry (content changed after write)', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-2', timestamp: new Date().toISOString(), event_type: 'vault_opened', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    // Tamper with line 0 (genesis entry)
    const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    const tampered = JSON.parse(lines[0]!);
    tampered.outcome = 'error'; // modify content
    lines[0] = JSON.stringify(tampered);
    writeFileSync(logPath, lines.join('\n') + '\n');

    const result = verifyChain(logPath);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1); // entry 1's prev_hash no longer matches tampered entry 0
  });

  it('detects an inserted entry', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-2', timestamp: new Date().toISOString(), event_type: 'vault_opened', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    // Insert a line between entries 0 and 1
    const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    const fakeEntry = JSON.stringify({ id: 'fake', timestamp: new Date().toISOString(), event_type: 'vault_closed', actor: SYSTEM_ACTOR, outcome: 'info', prev_hash: null, details: {} });
    lines.splice(1, 0, fakeEntry);
    writeFileSync(logPath, lines.join('\n') + '\n');

    const result = verifyChain(logPath);
    expect(result.valid).toBe(false);
  });

  it('detects a deleted entry', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-2', timestamp: new Date().toISOString(), event_type: 'vault_opened', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });
    writer.append({ id: 'id-3', timestamp: new Date().toISOString(), event_type: 'vault_closed', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    // Delete entry 1 (middle entry)
    const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    lines.splice(1, 1);
    writeFileSync(logPath, lines.join('\n') + '\n');

    const result = verifyChain(logPath);
    expect(result.valid).toBe(false);
  });

  it('detects malformed JSON on a line', () => {
    const writer = new AuditWriter(logPath);
    writer.append({ id: 'id-1', timestamp: new Date().toISOString(), event_type: 'vault_created', actor: SYSTEM_ACTOR, outcome: 'success', details: {} });

    // Append a corrupt line
    appendFileSync(logPath, '{not valid json}\n');

    const result = verifyChain(logPath);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malformed json/i);
  });

  it('detects genesis entry with non-null prev_hash', () => {
    const fakeGenesis = JSON.stringify({
      id: 'id-1',
      timestamp: new Date().toISOString(),
      event_type: 'vault_created',
      actor: SYSTEM_ACTOR,
      outcome: 'success',
      prev_hash: 'some-hash-that-should-be-null', // invalid genesis
      details: {},
    });
    writeFileSync(logPath, fakeGenesis + '\n');

    const result = verifyChain(logPath);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });
});
