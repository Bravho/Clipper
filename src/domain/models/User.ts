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
   * TRUE when this account's free-trial right was already used — either by
   * this account, or by a previously deleted account with the same email /
   * OAuth identity (detected via deleted_account_registry at signup).
   */
  trialConsumed: boolean;
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
