import type { KeyObject } from 'node:crypto';
import { LedgerWriter } from '../ledger/writer.js';
import { readAllEntries } from '../ledger/reader.js';
import type { EntryAuthor, LedgerEntry } from '../types/ledger.js';
import type {
  AclGrantPayload,
  AclModifyPayload,
  AclRevokePayload,
  AclExpirePayload,
  AclCheckResult,
  AclGrantState,
  AclEntityType,
} from '../types/acl.js';
import { GrantNotFoundError, GrantAlreadyRevokedError, GrantAlreadyExpiredError } from './errors.js';

/**
 * Manages access control as immutable ledger entries.
 *
 * All ACL operations (grant, modify, revoke, expire) are written to the same
 * append-only ledger as clinical data, making every access control decision
 * fully auditable and tamper-evident. The patient is always the root authority.
 *
 * ACL state is computed by replaying ACL entries from the ledger in chronological
 * order. The default posture is deny-by-default: if no explicit active grant
 * exists for an entity+permission pair, access is denied.
 */
export class AclManager {
  constructor(
    private readonly writer: LedgerWriter,
    private readonly entriesPath: string,
    private readonly patientAuthor: EntryAuthor,
    private readonly getActiveKey: () => { keyId: string; key: Buffer },
    private readonly getKeyById: (keyId: string) => Buffer,
    private readonly signingKey: KeyObject,
  ) {}

  /**
   * Grant access to an entity with specific permissions.
   * Writes an access_grant_created ledger entry.
   *
   * @param entityId - Unique identifier of the entity receiving access.
   * @param entityType - Type of entity (provider, agent, organization, system).
   * @param entityDisplayName - Human-readable entity name.
   * @param permissions - Array of permission strings (action:resource format).
   * @param opts - Optional: expiresAt (ISO 8601 timestamp), reason.
   * @returns The written ledger entry.
   */
  grant(
    entityId: string,
    entityType: AclEntityType,
    entityDisplayName: string,
    permissions: string[],
    opts?: { expiresAt?: string; reason?: string },
  ): LedgerEntry {
    const payload: AclGrantPayload = {
      entity_id: entityId,
      entity_type: entityType,
      entity_display_name: entityDisplayName,
      permissions,
      granted_by: this.patientAuthor.id,
      ...(opts?.expiresAt !== undefined ? { expires_at: opts.expiresAt } : {}),
      ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    };

    return this.writer.writeEntry(
      payload,
      'access_grant_created',
      this.patientAuthor,
      this.getActiveKey,
      this.signingKey,
    );
  }

  /**
   * Modify an existing access grant (update permissions or expiration).
   * Writes an access_grant_modified ledger entry.
   *
   * @param grantEntryId - UUIDv7 of the original grant entry to modify.
   * @param entityId - Entity ID whose grant is being modified.
   * @param permissions - Updated permissions array (replaces previous).
   * @param opts - Optional: expiresAt (ISO 8601 timestamp), reason.
   * @returns The written ledger entry.
   * @throws {GrantNotFoundError} If the referenced grant does not exist.
   * @throws {GrantAlreadyRevokedError} If the grant has been revoked.
   */
  modify(
    grantEntryId: string,
    entityId: string,
    permissions: string[],
    opts?: { expiresAt?: string; reason?: string },
  ): LedgerEntry {
    // Validate the grant exists and is active
    const state = this.computeState();
    const grantState = state.get(grantEntryId);
    if (!grantState) {
      throw new GrantNotFoundError(grantEntryId);
    }
    if (grantState.status === 'revoked') {
      throw new GrantAlreadyRevokedError(grantEntryId);
    }

    const payload: AclModifyPayload = {
      grant_entry_id: grantEntryId,
      entity_id: entityId,
      permissions,
      ...(opts?.expiresAt !== undefined ? { expires_at: opts.expiresAt } : {}),
      ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    };

    return this.writer.writeEntry(
      payload,
      'access_grant_modified',
      this.patientAuthor,
      this.getActiveKey,
      this.signingKey,
    );
  }

  /**
   * Revoke a previously granted access.
   * Writes an access_grant_revoked ledger entry.
   *
   * @param grantEntryId - UUIDv7 of the grant entry to revoke.
   * @param entityId - Entity ID whose access is being revoked.
   * @param reason - Optional reason for revocation.
   * @returns The written ledger entry.
   * @throws {GrantNotFoundError} If the referenced grant does not exist.
   * @throws {GrantAlreadyRevokedError} If the grant has already been revoked.
   */
  revoke(
    grantEntryId: string,
    entityId: string,
    reason?: string,
  ): LedgerEntry {
    const state = this.computeState();
    const grantState = state.get(grantEntryId);
    if (!grantState) {
      throw new GrantNotFoundError(grantEntryId);
    }
    if (grantState.status === 'revoked') {
      throw new GrantAlreadyRevokedError(grantEntryId);
    }

    const payload: AclRevokePayload = {
      grant_entry_id: grantEntryId,
      entity_id: entityId,
      ...(reason !== undefined ? { reason } : {}),
    };

    return this.writer.writeEntry(
      payload,
      'access_grant_revoked',
      this.patientAuthor,
      this.getActiveKey,
      this.signingKey,
    );
  }

  /**
   * Record that a grant has expired.
   * Writes an access_grant_expired ledger entry.
   *
   * @param grantEntryId - UUIDv7 of the grant entry that expired.
   * @param entityId - Entity ID whose grant expired.
   * @param expiredAt - ISO 8601 timestamp when the grant expired.
   * @returns The written ledger entry.
   * @throws {GrantNotFoundError} If the referenced grant does not exist.
   * @throws {GrantAlreadyRevokedError} If the grant has been revoked.
   * @throws {GrantAlreadyExpiredError} If the grant has already been marked expired.
   */
  expire(
    grantEntryId: string,
    entityId: string,
    expiredAt: string,
  ): LedgerEntry {
    const state = this.computeState();
    const grantState = state.get(grantEntryId);
    if (!grantState) {
      throw new GrantNotFoundError(grantEntryId);
    }
    if (grantState.status === 'revoked') {
      throw new GrantAlreadyRevokedError(grantEntryId);
    }
    if (grantState.status === 'expired') {
      throw new GrantAlreadyExpiredError(grantEntryId);
    }

    const payload: AclExpirePayload = {
      grant_entry_id: grantEntryId,
      entity_id: entityId,
      expired_at: expiredAt,
    };

    return this.writer.writeEntry(
      payload,
      'access_grant_expired',
      this.patientAuthor,
      this.getActiveKey,
      this.signingKey,
    );
  }

  /**
   * Check whether an entity has a specific permission.
   * Deny-by-default: returns denied if no active grant exists.
   *
   * @param entityId - Entity ID to check.
   * @param permission - Permission string (action:resource format).
   * @param now - Current time for expiration checks (defaults to Date.now()).
   * @returns AclCheckResult indicating allow/deny and the reason.
   */
  checkAccess(entityId: string, permission: string, now?: Date): AclCheckResult {
    const currentTime = now ?? new Date();
    const state = this.computeState();

    // Walk all grants for this entity, looking for an active one with the requested permission
    for (const [grantEntryId, grant] of state) {
      if (grant.entity_id !== entityId) continue;

      // Skip revoked grants
      if (grant.status === 'revoked') continue;

      // Skip explicitly expired grants
      if (grant.status === 'expired') continue;

      // Check time-based expiration
      if (grant.expires_at !== undefined) {
        const expiresAt = new Date(grant.expires_at);
        if (currentTime >= expiresAt) {
          continue;
        }
      }

      // Check if this grant includes the requested permission
      if (grant.permissions.includes(permission)) {
        return {
          allowed: true,
          entity_id: entityId,
          permission,
          reason: 'granted',
          grant_entry_id: grantEntryId,
        };
      }
    }

    // Deny-by-default: determine the most specific reason
    // Check if there are any grants at all for this entity
    const entityGrants = [...state.values()].filter((g) => g.entity_id === entityId);

    if (entityGrants.length === 0) {
      return {
        allowed: false,
        entity_id: entityId,
        permission,
        reason: 'denied_no_grant',
      };
    }

    // Check if all grants are revoked
    const allRevoked = entityGrants.every((g) => g.status === 'revoked');
    if (allRevoked) {
      return {
        allowed: false,
        entity_id: entityId,
        permission,
        reason: 'denied_revoked',
      };
    }

    // Check if remaining grants are expired
    const allExpiredOrRevoked = entityGrants.every((g) => {
      if (g.status === 'revoked' || g.status === 'expired') return true;
      if (g.expires_at !== undefined) {
        return currentTime >= new Date(g.expires_at);
      }
      return false;
    });

    if (allExpiredOrRevoked) {
      return {
        allowed: false,
        entity_id: entityId,
        permission,
        reason: 'denied_expired',
      };
    }

    // Has grants but none cover this permission
    return {
      allowed: false,
      entity_id: entityId,
      permission,
      reason: 'denied_no_grant',
    };
  }

  /**
   * Compute the current ACL state by replaying all ACL entries from the ledger.
   *
   * Returns a Map keyed by the original grant entry ID, with the computed
   * current state for each grant (including modifications, revocations, expirations).
   */
  computeState(): Map<string, AclGrantState> {
    return computeAclState(this.entriesPath, this.getKeyById);
  }

  /**
   * Get all active grants for a specific entity.
   *
   * @param entityId - Entity ID to look up.
   * @param now - Current time for expiration checks (defaults to Date.now()).
   * @returns Array of active grant states.
   */
  getEntityGrants(entityId: string, now?: Date): AclGrantState[] {
    const currentTime = now ?? new Date();
    const state = this.computeState();
    const results: AclGrantState[] = [];

    for (const grant of state.values()) {
      if (grant.entity_id !== entityId) continue;
      if (grant.status === 'revoked' || grant.status === 'expired') continue;

      // Check time-based expiration
      if (grant.expires_at !== undefined) {
        const expiresAt = new Date(grant.expires_at);
        if (currentTime >= expiresAt) continue;
      }

      results.push(grant);
    }

    return results;
  }
}

/**
 * Compute ACL state from the ledger file by replaying all ACL entries.
 * This is a pure function that reads the ledger and derives state.
 *
 * @param entriesPath - Path to the entries.jsonl file.
 * @param getKeyById - Function to look up a decryption key by its ID.
 * @returns Map of grant entry ID -> computed grant state.
 */
export function computeAclState(
  entriesPath: string,
  getKeyById: (keyId: string) => Buffer,
): Map<string, AclGrantState> {
  const grants = new Map<string, AclGrantState>();

  let allEntries: Array<{ entry: LedgerEntry; plaintext: unknown }>;
  try {
    allEntries = readAllEntries(entriesPath, getKeyById);
  } catch {
    // If file doesn't exist or is empty, no grants
    return grants;
  }

  for (const { entry, plaintext } of allEntries) {
    const payload = plaintext as Record<string, unknown>;

    switch (entry.entry_type) {
      case 'access_grant_created': {
        const p = payload as AclGrantPayload;
        grants.set(entry.id, {
          grant_entry_id: entry.id,
          entity_id: p.entity_id,
          entity_type: p.entity_type,
          entity_display_name: p.entity_display_name,
          permissions: [...p.permissions],
          granted_by: p.granted_by,
          ...(p.expires_at !== undefined ? { expires_at: p.expires_at } : {}),
          status: 'active',
        });
        break;
      }

      case 'access_grant_modified': {
        const p = payload as AclModifyPayload;
        const existing = grants.get(p.grant_entry_id);
        if (existing) {
          existing.permissions = [...p.permissions];
          if (p.expires_at !== undefined) {
            existing.expires_at = p.expires_at;
          } else {
            delete existing.expires_at;
          }
          existing.status = 'active';
          existing.last_modified_entry_id = entry.id;
        }
        break;
      }

      case 'access_grant_revoked': {
        const p = payload as AclRevokePayload;
        const existing = grants.get(p.grant_entry_id);
        if (existing) {
          existing.status = 'revoked';
        }
        break;
      }

      case 'access_grant_expired': {
        const p = payload as AclExpirePayload;
        const existing = grants.get(p.grant_entry_id);
        if (existing) {
          existing.status = 'expired';
        }
        break;
      }

      // Skip non-ACL entries
      default:
        break;
    }
  }

  return grants;
}
