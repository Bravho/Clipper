import { Role } from "@/domain/enums/Role";

/**
 * Core user entity.
 *
 * Represents a platform account regardless of role.
 * Authentication credentials are stored separately in AuthIdentity.
 * Credits are stored separately in CreditWallet.
 *
 * TODO: PostgreSQL — map to `users` table.
 *   Column mapping:
 *     name         → full_name
 *   Note: password_hash and signup_method (AuthProvider) are also on the `users`
 *   table in this DB design (no separate auth_identities table).
 *   PostgresAuthIdentityRepository should read/write those columns from `users`.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  /**
   * How much of the trial allowance a PREVIOUS life of this identity already
   * consumed — carried over at signup from `deleted_account_registry` when the
   * same email / OAuth identity had an account that was deleted. 0 for a genuinely
   * new identity.
   *
   * This is a carry-over baseline only, never a running counter: the account's
   * own usage is derived live from its submitted requests, so the effective total
   * is `priorTrialRequestsUsed + countSubmittedRequestsByUserId(id)`. See
   * `ClipRequestService.getEntitlement()`.
   *
   * Persisted as `prior_trial_requests_used INT NOT NULL DEFAULT 0` (migration
   * 031), which supersedes the legacy boolean `trial_consumed` column.
   */
  priorTrialRequestsUsed: number;
  /**
   * Tombstone marker. Deletion anonymizes PII in place (name, email) and sets
   * this timestamp; the row is retained so legally-required financial and
   * consent records that reference users.id survive without personal data.
   */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create a new user.
 * The repository layer assigns id, createdAt, updatedAt, deletedAt (null).
 */
export type CreateUserInput = Omit<
  User,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;
