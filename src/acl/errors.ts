/**
 * Base error class for all ACL operation failures.
 */
export class AclError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AclError';
  }
}

/**
 * Thrown when an ACL operation references a grant that does not exist.
 */
export class GrantNotFoundError extends AclError {
  constructor(grantEntryId: string) {
    super(`Grant entry not found: ${grantEntryId}`);
    this.name = 'GrantNotFoundError';
  }
}

/**
 * Thrown when an ACL operation targets a grant that has already been revoked.
 */
export class GrantAlreadyRevokedError extends AclError {
  constructor(grantEntryId: string) {
    super(`Grant has already been revoked: ${grantEntryId}`);
    this.name = 'GrantAlreadyRevokedError';
  }
}

/**
 * Thrown when an ACL operation targets a grant that has already expired.
 */
export class GrantAlreadyExpiredError extends AclError {
  constructor(grantEntryId: string) {
    super(`Grant has already expired: ${grantEntryId}`);
    this.name = 'GrantAlreadyExpiredError';
  }
}
