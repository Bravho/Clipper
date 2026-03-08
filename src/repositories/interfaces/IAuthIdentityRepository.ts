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
}
