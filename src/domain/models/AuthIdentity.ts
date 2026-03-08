import { AuthProvider } from "@/domain/enums/AuthProvider";

/**
 * Authentication identity record.
 *
 * Separates auth credentials from the user profile, allowing a single
 * user account to link multiple auth providers in the future.
 *
 * For Credentials provider:
 *   - passwordHash is set, providerAccountId is null
 *
 * For Google provider:
 *   - providerAccountId is the Google `sub` claim
 *   - passwordHash is null
 *
 * TODO: PostgreSQL — map to `auth_identities` table with composite
 *       unique index on (provider, providerAccountId).
 */
export interface AuthIdentity {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerAccountId: string | null; // Google sub / OAuth account ID
  passwordHash: string | null;       // bcrypt hash (credentials only)
  createdAt: Date;
}

export type CreateAuthIdentityInput = Omit<AuthIdentity, "id" | "createdAt">;
