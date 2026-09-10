/**
 * Lifecycle of one purchased monthly allowance window.
 *
 * snake_case values stored verbatim in Postgres TEXT columns and guarded by a
 * CHECK constraint, following the Management convention.
 */
export enum VideoAllowanceWindowStatus {
  /** Paid and usable while `now` is inside [startsAt, expiresAt). */
  Active = "active",
  /** Window elapsed. Unspent requests are forfeit — allowances never aggregate. */
  Expired = "expired",
  /** Withdrawn by an administrator, with a recorded reason. */
  Revoked = "revoked",
  /** The credits were returned to the user. */
  Refunded = "refunded",
}
