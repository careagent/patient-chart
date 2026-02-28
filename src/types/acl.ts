import { Type, type Static } from '@sinclair/typebox';

/**
 * Permission string following `action:resource` pattern.
 * Examples: 'read:observations', 'read:medications', 'write:notes'
 */
export const AclPermissionSchema = Type.String({
  description: 'Permission string in action:resource format (e.g., read:observations)',
  pattern: '^[a-z_]+:[a-z_]+$',
});

export type AclPermission = Static<typeof AclPermissionSchema>;

/**
 * Payload for access_grant_created ledger entries.
 * Records the patient granting specific permissions to an entity.
 */
export const AclGrantPayloadSchema = Type.Object({
  entity_id: Type.String({ description: 'Unique identifier of the entity being granted access' }),
  entity_type: Type.Union([
    Type.Literal('provider'),
    Type.Literal('agent'),
    Type.Literal('organization'),
    Type.Literal('system'),
  ], { description: 'Type of entity being granted access' }),
  entity_display_name: Type.String({ description: 'Human-readable name of the entity' }),
  permissions: Type.Array(AclPermissionSchema, {
    description: 'Permissions being granted',
    minItems: 1,
  }),
  granted_by: Type.String({ description: 'Patient ID (always the vault owner)' }),
  expires_at: Type.Optional(Type.String({
    description: 'ISO 8601 expiration timestamp; omit for no expiration',
  })),
  reason: Type.Optional(Type.String({ description: 'Human-readable reason for the grant' })),
});

export type AclGrantPayload = Static<typeof AclGrantPayloadSchema>;

/**
 * Payload for access_grant_modified ledger entries.
 * Records the patient modifying an existing grant (change permissions, scope, duration).
 * References the original grant entry by ID.
 */
export const AclModifyPayloadSchema = Type.Object({
  grant_entry_id: Type.String({ description: 'UUIDv7 of the original access_grant_created entry being modified' }),
  entity_id: Type.String({ description: 'Unique identifier of the entity whose grant is being modified' }),
  permissions: Type.Array(AclPermissionSchema, {
    description: 'Updated permissions (replaces previous permissions)',
    minItems: 1,
  }),
  expires_at: Type.Optional(Type.String({
    description: 'Updated expiration timestamp; omit to remove expiration',
  })),
  reason: Type.Optional(Type.String({ description: 'Human-readable reason for the modification' })),
});

export type AclModifyPayload = Static<typeof AclModifyPayloadSchema>;

/**
 * Payload for access_grant_revoked ledger entries.
 * Records the patient revoking a previously granted access.
 */
export const AclRevokePayloadSchema = Type.Object({
  grant_entry_id: Type.String({ description: 'UUIDv7 of the original access_grant_created entry being revoked' }),
  entity_id: Type.String({ description: 'Unique identifier of the entity whose access is being revoked' }),
  reason: Type.Optional(Type.String({ description: 'Human-readable reason for the revocation' })),
});

export type AclRevokePayload = Static<typeof AclRevokePayloadSchema>;

/**
 * Payload for access_grant_expired ledger entries.
 * Records that a time-limited grant has expired.
 */
export const AclExpirePayloadSchema = Type.Object({
  grant_entry_id: Type.String({ description: 'UUIDv7 of the original access_grant_created entry that expired' }),
  entity_id: Type.String({ description: 'Unique identifier of the entity whose grant expired' }),
  expired_at: Type.String({ description: 'ISO 8601 timestamp when the grant expired' }),
});

export type AclExpirePayload = Static<typeof AclExpirePayloadSchema>;

/**
 * Union of all ACL payload types for type discrimination.
 */
export const AclPayloadSchema = Type.Union([
  AclGrantPayloadSchema,
  AclModifyPayloadSchema,
  AclRevokePayloadSchema,
  AclExpirePayloadSchema,
]);

export type AclPayload = Static<typeof AclPayloadSchema>;

/**
 * The entity types that can be ACL grant targets.
 */
export const AclEntityTypeSchema = Type.Union([
  Type.Literal('provider'),
  Type.Literal('agent'),
  Type.Literal('organization'),
  Type.Literal('system'),
]);

export type AclEntityType = Static<typeof AclEntityTypeSchema>;

/**
 * Result of an ACL check operation.
 */
export const AclCheckResultSchema = Type.Object({
  allowed: Type.Boolean({ description: 'Whether the requested permission is allowed' }),
  entity_id: Type.String({ description: 'Entity ID that was checked' }),
  permission: Type.String({ description: 'Permission that was checked' }),
  reason: Type.Union([
    Type.Literal('granted'),
    Type.Literal('denied_no_grant'),
    Type.Literal('denied_revoked'),
    Type.Literal('denied_expired'),
  ], { description: 'Reason for the access decision' }),
  grant_entry_id: Type.Optional(Type.String({
    description: 'The grant entry ID that was the basis for the decision (if any)',
  })),
});

export type AclCheckResult = Static<typeof AclCheckResultSchema>;

/**
 * Computed state of a single access grant at a point in time.
 * Derived by replaying ACL ledger entries.
 */
export const AclGrantStateSchema = Type.Object({
  grant_entry_id: Type.String({ description: 'UUIDv7 of the original grant entry' }),
  entity_id: Type.String({ description: 'Unique identifier of the entity' }),
  entity_type: AclEntityTypeSchema,
  entity_display_name: Type.String(),
  permissions: Type.Array(AclPermissionSchema),
  granted_by: Type.String(),
  expires_at: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('revoked'),
    Type.Literal('expired'),
    Type.Literal('modified'),
  ]),
  last_modified_entry_id: Type.Optional(Type.String({
    description: 'UUIDv7 of the most recent modify entry (if modified)',
  })),
});

export type AclGrantState = Static<typeof AclGrantStateSchema>;
