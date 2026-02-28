import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { KeyRing } from '../../src/encryption/keyring.js';
import { exportEd25519PublicKey } from '../../src/encryption/ed25519.js';
import { LedgerWriter } from '../../src/ledger/writer.js';
import { readAllEntries } from '../../src/ledger/reader.js';
import { verifyLedgerChain, verifyLedgerIntegrity } from '../../src/ledger/integrity.js';
import { AclManager, computeAclState } from '../../src/acl/manager.js';
import { GrantNotFoundError, GrantAlreadyRevokedError, GrantAlreadyExpiredError } from '../../src/acl/errors.js';
import type { EntryAuthor } from '../../src/types/ledger.js';

/**
 * Shared test helper: creates a temp directory, KeyRing, patient author,
 * LedgerWriter, and AclManager for ACL tests.
 */
function createTestFixtures() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'acl-manager-'));
  const entriesPath = join(tmpDir, 'entries.jsonl');
  const keyRing = KeyRing.create(randomBytes(32));

  const publicKeyDer = exportEd25519PublicKey(keyRing.getIdentityPublicKey());
  const patientAuthor: EntryAuthor = {
    type: 'patient_agent',
    id: 'patient-uuid-456',
    display_name: 'Test Patient',
    public_key: publicKeyDer.toString('base64'),
  };

  const getActiveKey = () => keyRing.getActiveEncryptionKey();
  const getKeyById = (id: string) => keyRing.getEncryptionKey(id);
  const signingKey = keyRing.getIdentityPrivateKey();

  const writer = new LedgerWriter(entriesPath);
  const acl = new AclManager(
    writer,
    entriesPath,
    patientAuthor,
    getActiveKey,
    getKeyById,
    signingKey,
  );

  return { tmpDir, entriesPath, keyRing, patientAuthor, getActiveKey, getKeyById, signingKey, writer, acl };
}

describe('AclManager', () => {
  let fixtures: ReturnType<typeof createTestFixtures>;

  beforeEach(() => {
    fixtures = createTestFixtures();
  });

  afterEach(() => {
    fixtures.keyRing.destroy();
    rmSync(fixtures.tmpDir, { recursive: true, force: true });
  });

  // ===== AC1: ACL Grant Operation =====
  describe('grant', () => {
    it('creates an access_grant_created ledger entry', () => {
      const { acl } = fixtures;

      const entry = acl.grant(
        'provider-123',
        'provider',
        'Dr. Smith',
        ['read:observations', 'read:medications'],
      );

      expect(entry.entry_type).toBe('access_grant_created');
    });

    it('stores entity ID, permissions, and granted_by in payload', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      acl.grant(
        'provider-123',
        'provider',
        'Dr. Smith',
        ['read:observations', 'read:medications'],
      );

      const entries = readAllEntries(entriesPath, getKeyById);
      expect(entries).toHaveLength(1);
      const payload = entries[0]!.plaintext as Record<string, unknown>;
      expect(payload.entity_id).toBe('provider-123');
      expect(payload.entity_type).toBe('provider');
      expect(payload.entity_display_name).toBe('Dr. Smith');
      expect(payload.permissions).toEqual(['read:observations', 'read:medications']);
      expect(payload.granted_by).toBe('patient-uuid-456');
    });

    it('supports optional expiration timestamp', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      acl.grant(
        'provider-123',
        'provider',
        'Dr. Smith',
        ['read:observations'],
        { expiresAt: '2025-12-31T23:59:59.000Z' },
      );

      const entries = readAllEntries(entriesPath, getKeyById);
      const payload = entries[0]!.plaintext as Record<string, unknown>;
      expect(payload.expires_at).toBe('2025-12-31T23:59:59.000Z');
    });

    it('supports optional reason', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      acl.grant(
        'provider-123',
        'provider',
        'Dr. Smith',
        ['read:observations'],
        { reason: 'Annual checkup access' },
      );

      const entries = readAllEntries(entriesPath, getKeyById);
      const payload = entries[0]!.plaintext as Record<string, unknown>;
      expect(payload.reason).toBe('Annual checkup access');
    });

    it('supports all entity types (provider, agent, organization, system)', () => {
      const { acl } = fixtures;
      const types = ['provider', 'agent', 'organization', 'system'] as const;

      for (const entityType of types) {
        const entry = acl.grant(
          `entity-${entityType}`,
          entityType,
          `Test ${entityType}`,
          ['read:observations'],
        );
        expect(entry.entry_type).toBe('access_grant_created');
      }
    });
  });

  // ===== AC2: ACL Modify Operation =====
  describe('modify', () => {
    it('creates an access_grant_modified ledger entry', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      const modify = acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);

      expect(modify.entry_type).toBe('access_grant_modified');
    });

    it('stores updated permissions in payload', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes', 'read:medications']);

      const entries = readAllEntries(entriesPath, getKeyById);
      const modifyPayload = entries[1]!.plaintext as Record<string, unknown>;
      expect(modifyPayload.grant_entry_id).toBe(grant.id);
      expect(modifyPayload.permissions).toEqual(['read:observations', 'write:notes', 'read:medications']);
    });

    it('can update expiration on an existing grant', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations'], { expiresAt: '2026-06-30T23:59:59.000Z' });

      const entries = readAllEntries(entriesPath, getKeyById);
      const modifyPayload = entries[1]!.plaintext as Record<string, unknown>;
      expect(modifyPayload.expires_at).toBe('2026-06-30T23:59:59.000Z');
    });

    it('throws GrantNotFoundError if grant does not exist', () => {
      const { acl } = fixtures;

      expect(() => {
        acl.modify('nonexistent-grant', 'provider-123', ['read:observations']);
      }).toThrow(GrantNotFoundError);
    });

    it('throws GrantAlreadyRevokedError if grant has been revoked', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      expect(() => {
        acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);
      }).toThrow(GrantAlreadyRevokedError);
    });
  });

  // ===== AC3: ACL Revoke Operation =====
  describe('revoke', () => {
    it('creates an access_grant_revoked ledger entry', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      const revoke = acl.revoke(grant.id, 'provider-123');

      expect(revoke.entry_type).toBe('access_grant_revoked');
    });

    it('stores grant reference and entity ID in payload', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123', 'Relationship ended');

      const entries = readAllEntries(entriesPath, getKeyById);
      const revokePayload = entries[1]!.plaintext as Record<string, unknown>;
      expect(revokePayload.grant_entry_id).toBe(grant.id);
      expect(revokePayload.entity_id).toBe('provider-123');
      expect(revokePayload.reason).toBe('Relationship ended');
    });

    it('throws GrantNotFoundError if grant does not exist', () => {
      const { acl } = fixtures;

      expect(() => {
        acl.revoke('nonexistent-grant', 'provider-123');
      }).toThrow(GrantNotFoundError);
    });

    it('throws GrantAlreadyRevokedError if grant already revoked', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      expect(() => {
        acl.revoke(grant.id, 'provider-123');
      }).toThrow(GrantAlreadyRevokedError);
    });
  });

  // ===== AC4: ACL Expire Operation =====
  describe('expire', () => {
    it('creates an access_grant_expired ledger entry', () => {
      const { acl } = fixtures;

      const grant = acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );
      const expire = acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');

      expect(expire.entry_type).toBe('access_grant_expired');
    });

    it('stores expiration timestamp in payload', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );
      acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');

      const entries = readAllEntries(entriesPath, getKeyById);
      const expirePayload = entries[1]!.plaintext as Record<string, unknown>;
      expect(expirePayload.grant_entry_id).toBe(grant.id);
      expect(expirePayload.expired_at).toBe('2025-01-01T00:00:00.000Z');
    });

    it('throws GrantNotFoundError if grant does not exist', () => {
      const { acl } = fixtures;

      expect(() => {
        acl.expire('nonexistent-grant', 'provider-123', '2025-01-01T00:00:00.000Z');
      }).toThrow(GrantNotFoundError);
    });

    it('throws GrantAlreadyRevokedError if grant has been revoked', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      expect(() => {
        acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');
      }).toThrow(GrantAlreadyRevokedError);
    });

    it('throws GrantAlreadyExpiredError if grant has already been expired', () => {
      const { acl } = fixtures;

      const grant = acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );
      acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');

      expect(() => {
        acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');
      }).toThrow(GrantAlreadyExpiredError);
    });
  });

  // ===== AC5: Immutable Ledger Entries =====
  describe('ledger immutability', () => {
    it('all ACL entries are written to the ledger JSONL file', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);
      acl.revoke(grant.id, 'provider-123');

      const entries = readAllEntries(entriesPath, getKeyById);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.entry.entry_type).toBe('access_grant_created');
      expect(entries[1]!.entry.entry_type).toBe('access_grant_modified');
      expect(entries[2]!.entry.entry_type).toBe('access_grant_revoked');
    });

    it('ACL entries are hash-chained (verifiable chain integrity)', () => {
      const { acl, entriesPath } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);
      acl.revoke(grant.id, 'provider-123');

      const result = verifyLedgerChain(entriesPath);
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(3);
    });

    it('ACL entries pass full integrity verification (chain + signatures + decryption)', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);
      acl.revoke(grant.id, 'provider-123');

      const result = verifyLedgerIntegrity(entriesPath, getKeyById);
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(3);
    });

    it('ACL entries interleave with clinical entries in the same ledger', () => {
      const { acl, writer, patientAuthor, getActiveKey, signingKey, entriesPath, getKeyById } = fixtures;

      // Write a clinical entry first
      writer.writeEntry({ diagnosis: 'Healthy' }, 'clinical_encounter', patientAuthor, getActiveKey, signingKey);

      // Then an ACL grant
      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      // Then another clinical entry
      writer.writeEntry({ medication: 'Aspirin' }, 'clinical_medication', patientAuthor, getActiveKey, signingKey);

      // Then a revoke
      acl.revoke(grant.id, 'provider-123');

      const entries = readAllEntries(entriesPath, getKeyById);
      expect(entries).toHaveLength(4);
      expect(entries[0]!.entry.entry_type).toBe('clinical_encounter');
      expect(entries[1]!.entry.entry_type).toBe('access_grant_created');
      expect(entries[2]!.entry.entry_type).toBe('clinical_medication');
      expect(entries[3]!.entry.entry_type).toBe('access_grant_revoked');

      // Full chain still valid
      const chain = verifyLedgerChain(entriesPath);
      expect(chain.valid).toBe(true);
      expect(chain.entries).toBe(4);
    });
  });

  // ===== AC6: Entity Reference =====
  describe('entity referencing', () => {
    it('ACL entries reference the entity by unique identifier', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      acl.grant('provider-uuid-789', 'provider', 'Dr. Jones', ['read:observations']);

      const entries = readAllEntries(entriesPath, getKeyById);
      const payload = entries[0]!.plaintext as Record<string, unknown>;
      expect(payload.entity_id).toBe('provider-uuid-789');
    });

    it('modify and revoke entries reference both the grant and entity', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-uuid-789', 'provider', 'Dr. Jones', ['read:observations']);
      acl.modify(grant.id, 'provider-uuid-789', ['read:observations', 'write:notes']);
      acl.revoke(grant.id, 'provider-uuid-789');

      const entries = readAllEntries(entriesPath, getKeyById);
      const modifyPayload = entries[1]!.plaintext as Record<string, unknown>;
      expect(modifyPayload.grant_entry_id).toBe(grant.id);
      expect(modifyPayload.entity_id).toBe('provider-uuid-789');

      const revokePayload = entries[2]!.plaintext as Record<string, unknown>;
      expect(revokePayload.grant_entry_id).toBe(grant.id);
      expect(revokePayload.entity_id).toBe('provider-uuid-789');
    });
  });

  // ===== AC7: Deny-by-Default =====
  describe('deny-by-default', () => {
    it('denies access when no grants exist', () => {
      const { acl } = fixtures;

      const result = acl.checkAccess('unknown-entity', 'read:observations');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_no_grant');
    });

    it('denies access for a permission not in any grant', () => {
      const { acl } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      const result = acl.checkAccess('provider-123', 'write:medications');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_no_grant');
    });

    it('denies access after all grants are revoked', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      const result = acl.checkAccess('provider-123', 'read:observations');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_revoked');
    });

    it('denies access after grant expires (time-based)', () => {
      const { acl } = fixtures;

      acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );

      // Check with a time after expiration
      const result = acl.checkAccess('provider-123', 'read:observations', new Date('2025-06-01T00:00:00.000Z'));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_expired');
    });
  });

  // ===== AC8: State from Ledger Replay =====
  describe('computeState', () => {
    it('computes grant state from empty ledger', () => {
      const { acl } = fixtures;

      const state = acl.computeState();
      expect(state.size).toBe(0);
    });

    it('computes active grant state', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      const state = acl.computeState();

      expect(state.size).toBe(1);
      const grantState = state.get(grant.id);
      expect(grantState).toBeDefined();
      expect(grantState!.entity_id).toBe('provider-123');
      expect(grantState!.entity_type).toBe('provider');
      expect(grantState!.permissions).toEqual(['read:observations']);
      expect(grantState!.status).toBe('active');
    });

    it('reflects modification in computed state', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);

      const state = acl.computeState();
      const grantState = state.get(grant.id);
      expect(grantState!.permissions).toEqual(['read:observations', 'write:notes']);
      expect(grantState!.status).toBe('active');
      expect(grantState!.last_modified_entry_id).toBeDefined();
    });

    it('reflects revocation in computed state', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      const state = acl.computeState();
      const grantState = state.get(grant.id);
      expect(grantState!.status).toBe('revoked');
    });

    it('reflects expiration in computed state', () => {
      const { acl } = fixtures;

      const grant = acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );
      acl.expire(grant.id, 'provider-123', '2025-01-01T00:00:00.000Z');

      const state = acl.computeState();
      const grantState = state.get(grant.id);
      expect(grantState!.status).toBe('expired');
    });

    it('tracks multiple grants for different entities', () => {
      const { acl } = fixtures;

      const grant1 = acl.grant('provider-1', 'provider', 'Dr. Smith', ['read:observations']);
      const grant2 = acl.grant('agent-1', 'agent', 'AI Assistant', ['read:observations', 'write:notes']);

      const state = acl.computeState();
      expect(state.size).toBe(2);
      expect(state.get(grant1.id)!.entity_id).toBe('provider-1');
      expect(state.get(grant2.id)!.entity_id).toBe('agent-1');
    });

    it('handles multiple grants for the same entity', () => {
      const { acl } = fixtures;

      const grant1 = acl.grant('provider-1', 'provider', 'Dr. Smith', ['read:observations']);
      const grant2 = acl.grant('provider-1', 'provider', 'Dr. Smith', ['write:notes']);

      const state = acl.computeState();
      expect(state.size).toBe(2);
      expect(state.get(grant1.id)!.permissions).toEqual(['read:observations']);
      expect(state.get(grant2.id)!.permissions).toEqual(['write:notes']);
    });

    it('computeAclState works as standalone function', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      const state = computeAclState(entriesPath, getKeyById);
      expect(state.size).toBe(1);
    });

    it('computeAclState returns empty map for nonexistent file', () => {
      const state = computeAclState('/nonexistent/path/entries.jsonl', () => Buffer.alloc(32));
      expect(state.size).toBe(0);
    });
  });

  // ===== AC9: ACL Check Function =====
  describe('checkAccess', () => {
    it('allows access when entity has an active grant with the requested permission', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations', 'read:medications']);

      const result = acl.checkAccess('provider-123', 'read:observations');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('granted');
      expect(result.grant_entry_id).toBe(grant.id);
    });

    it('denies access when entity has a grant but not for the requested permission', () => {
      const { acl } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      const result = acl.checkAccess('provider-123', 'write:medications');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_no_grant');
    });

    it('allows access after modification adds the permission', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      // Initially denied
      expect(acl.checkAccess('provider-123', 'write:notes').allowed).toBe(false);

      // Modify to add permission
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);

      // Now allowed
      const result = acl.checkAccess('provider-123', 'write:notes');
      expect(result.allowed).toBe(true);
    });

    it('denies access after modification removes the permission', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations', 'write:notes']);

      // Initially allowed
      expect(acl.checkAccess('provider-123', 'write:notes').allowed).toBe(true);

      // Modify to remove permission
      acl.modify(grant.id, 'provider-123', ['read:observations']);

      // Now denied
      expect(acl.checkAccess('provider-123', 'write:notes').allowed).toBe(false);
    });

    it('denies access after revocation', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      expect(acl.checkAccess('provider-123', 'read:observations').allowed).toBe(true);

      acl.revoke(grant.id, 'provider-123');
      expect(acl.checkAccess('provider-123', 'read:observations').allowed).toBe(false);
    });

    it('allows access before expiration, denies after', () => {
      const { acl } = fixtures;

      acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-06-01T00:00:00.000Z' },
      );

      // Before expiration
      const before = acl.checkAccess('provider-123', 'read:observations', new Date('2025-03-01T00:00:00.000Z'));
      expect(before.allowed).toBe(true);

      // After expiration
      const after = acl.checkAccess('provider-123', 'read:observations', new Date('2025-07-01T00:00:00.000Z'));
      expect(after.allowed).toBe(false);
      expect(after.reason).toBe('denied_expired');
    });

    it('allows access through a second grant even if first is revoked', () => {
      const { acl } = fixtures;

      const grant1 = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant1.id, 'provider-123');

      // Create a new grant for the same entity
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      const result = acl.checkAccess('provider-123', 'read:observations');
      expect(result.allowed).toBe(true);
    });

    it('returns correct entity_id and permission in result', () => {
      const { acl } = fixtures;

      const result = acl.checkAccess('entity-abc', 'write:labs');
      expect(result.entity_id).toBe('entity-abc');
      expect(result.permission).toBe('write:labs');
    });
  });

  // ===== AC10: TypeBox Schemas =====
  describe('TypeBox schemas', () => {
    it('AclGrantPayloadSchema is importable', async () => {
      const { AclGrantPayloadSchema } = await import('../../src/types/acl.js');
      expect(AclGrantPayloadSchema).toBeDefined();
      expect(AclGrantPayloadSchema.type).toBe('object');
    });

    it('AclModifyPayloadSchema is importable', async () => {
      const { AclModifyPayloadSchema } = await import('../../src/types/acl.js');
      expect(AclModifyPayloadSchema).toBeDefined();
      expect(AclModifyPayloadSchema.type).toBe('object');
    });

    it('AclRevokePayloadSchema is importable', async () => {
      const { AclRevokePayloadSchema } = await import('../../src/types/acl.js');
      expect(AclRevokePayloadSchema).toBeDefined();
      expect(AclRevokePayloadSchema.type).toBe('object');
    });

    it('AclExpirePayloadSchema is importable', async () => {
      const { AclExpirePayloadSchema } = await import('../../src/types/acl.js');
      expect(AclExpirePayloadSchema).toBeDefined();
      expect(AclExpirePayloadSchema.type).toBe('object');
    });

    it('AclCheckResultSchema is importable', async () => {
      const { AclCheckResultSchema } = await import('../../src/types/acl.js');
      expect(AclCheckResultSchema).toBeDefined();
      expect(AclCheckResultSchema.type).toBe('object');
    });

    it('AclGrantStateSchema is importable', async () => {
      const { AclGrantStateSchema } = await import('../../src/types/acl.js');
      expect(AclGrantStateSchema).toBeDefined();
      expect(AclGrantStateSchema.type).toBe('object');
    });

    it('AclEntityTypeSchema is importable', async () => {
      const { AclEntityTypeSchema } = await import('../../src/types/acl.js');
      expect(AclEntityTypeSchema).toBeDefined();
    });

    it('schemas validate correct data with TypeBox Value.Check', async () => {
      const { Value } = await import('@sinclair/typebox/value');
      const { AclGrantPayloadSchema } = await import('../../src/types/acl.js');

      const valid = Value.Check(AclGrantPayloadSchema, {
        entity_id: 'provider-123',
        entity_type: 'provider',
        entity_display_name: 'Dr. Smith',
        permissions: ['read:observations'],
        granted_by: 'patient-uuid-456',
      });

      expect(valid).toBe(true);
    });

    it('schemas reject invalid data with TypeBox Value.Check', async () => {
      const { Value } = await import('@sinclair/typebox/value');
      const { AclGrantPayloadSchema } = await import('../../src/types/acl.js');

      // Missing required field
      const invalid = Value.Check(AclGrantPayloadSchema, {
        entity_id: 'provider-123',
        // missing entity_type, entity_display_name, permissions, granted_by
      });

      expect(invalid).toBe(false);
    });
  });

  // ===== AC11: Ed25519 Signed =====
  describe('Ed25519 signing', () => {
    it('all ACL entries have valid Ed25519 signatures', () => {
      const { acl, entriesPath, getKeyById } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.modify(grant.id, 'provider-123', ['read:observations', 'write:notes']);
      acl.revoke(grant.id, 'provider-123');

      // Full integrity check includes signature verification
      const result = verifyLedgerIntegrity(entriesPath, getKeyById);
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(3);
    });

    it('ACL entries are signed by the patient author', () => {
      const { acl, entriesPath, getKeyById, patientAuthor } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);

      const entries = readAllEntries(entriesPath, getKeyById);
      expect(entries[0]!.entry.author).toEqual(patientAuthor);
      expect(entries[0]!.entry.author.type).toBe('patient_agent');
    });
  });

  // ===== getEntityGrants =====
  describe('getEntityGrants', () => {
    it('returns active grants for an entity', () => {
      const { acl } = fixtures;

      acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.grant('provider-123', 'provider', 'Dr. Smith', ['write:notes']);

      const grants = acl.getEntityGrants('provider-123');
      expect(grants).toHaveLength(2);
    });

    it('excludes revoked grants', () => {
      const { acl } = fixtures;

      const grant = acl.grant('provider-123', 'provider', 'Dr. Smith', ['read:observations']);
      acl.revoke(grant.id, 'provider-123');

      const grants = acl.getEntityGrants('provider-123');
      expect(grants).toHaveLength(0);
    });

    it('excludes time-expired grants', () => {
      const { acl } = fixtures;

      acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-01-01T00:00:00.000Z' },
      );

      const grants = acl.getEntityGrants('provider-123', new Date('2025-06-01T00:00:00.000Z'));
      expect(grants).toHaveLength(0);
    });

    it('includes grants that have not yet expired', () => {
      const { acl } = fixtures;

      acl.grant(
        'provider-123', 'provider', 'Dr. Smith', ['read:observations'],
        { expiresAt: '2025-12-31T23:59:59.000Z' },
      );

      const grants = acl.getEntityGrants('provider-123', new Date('2025-06-01T00:00:00.000Z'));
      expect(grants).toHaveLength(1);
    });

    it('returns empty array for unknown entity', () => {
      const { acl } = fixtures;

      const grants = acl.getEntityGrants('unknown-entity');
      expect(grants).toHaveLength(0);
    });
  });

  // ===== Error classes =====
  describe('error classes', () => {
    it('GrantNotFoundError has correct name and message', () => {
      const err = new GrantNotFoundError('grant-123');
      expect(err.name).toBe('GrantNotFoundError');
      expect(err.message).toContain('grant-123');
    });

    it('GrantAlreadyRevokedError has correct name and message', () => {
      const err = new GrantAlreadyRevokedError('grant-123');
      expect(err.name).toBe('GrantAlreadyRevokedError');
      expect(err.message).toContain('grant-123');
    });

    it('GrantAlreadyExpiredError has correct name and message', () => {
      const err = new GrantAlreadyExpiredError('grant-123');
      expect(err.name).toBe('GrantAlreadyExpiredError');
      expect(err.message).toContain('grant-123');
    });
  });
});
