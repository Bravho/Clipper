import { AuthProvider } from "@/domain/enums/AuthProvider";
import { AuthIdentity, CreateAuthIdentityInput } from "@/domain/models/AuthIdentity";

/**
 * Repository contract for AuthIdentity persistence.
 *
 * TODO: PostgreSQL — implement PostgresAuthIdentityRepository.
 *       Add composite unique index on (provider, providerAccountId).
 */
export interface IAuthIdentityRepository {
  /** All auth identities for a given user (may have multiple providers) */
  findByUserId(userId: string): Promise<AuthIdentity[]>;

  /** Look up by OAuth provider account ID (e.g. Google sub claim) */
  findByProviderAccountId(
    provider: AuthProvider,
    providerAccountId: string
  ): Promise<AuthIdentity | null>;

  /** Look up credentials identity for a user (email/password flow) */
  findCredentialsByUserId(userId: string): Promise<AuthIdentity | null>;

  create(input: CreateAuthIdentityInput): Promise<AuthIdentity>;

  /** Replace the bcrypt password hash on a user's credentials identity. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;

  /** Remove all auth identities for a user (account deletion — kills login). */
  deleteByUserId(userId: string): Promise<void>;
}
