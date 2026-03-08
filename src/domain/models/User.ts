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
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create a new user.
 * The repository layer assigns id, createdAt, updatedAt.
 */
export type CreateUserInput = Omit<User, "id" | "createdAt" | "updatedAt">;
