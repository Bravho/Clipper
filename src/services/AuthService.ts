import bcrypt from "bcryptjs";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { User } from "@/domain/models/User";
import { userRepository, authIdentityRepository } from "@/repositories";
import { creditService } from "@/services/CreditService";

/**
 * AuthService — handles credential verification and OAuth user resolution.
 *
 * This service is called by the NextAuth authorize/signIn callbacks.
 * It does NOT create accounts directly — AccountService owns that flow.
 *
 * TODO: When replacing mock repositories with PostgreSQL:
 *       - verifyCredentials() stays the same (pure service logic)
 *       - findOrCreateGoogleUser() stays the same
 *       - Only the repository calls change underneath
 */
export class AuthService {
  /**
   * Verify email + password credentials.
   * Returns the User if valid, null if invalid.
   */
  async verifyCredentials(
    email: string,
    password: string
  ): Promise<User | null> {
    const user = await userRepository.findByEmail(email);
    if (!user || user.deletedAt) return null;

    const identity = await authIdentityRepository.findCredentialsByUserId(
      user.id
    );
    if (!identity || !identity.passwordHash) return null;

    const passwordValid = await bcrypt.compare(password, identity.passwordHash);
    if (!passwordValid) return null;

    if (!user.emailVerified) {
      throw new Error("EmailNotVerified");
    }

    return user;
  }

  /**
   * Find an existing user by OAuth provider account ID, or create a new one.
   * Used in the NextAuth signIn callback for Google and Apple OAuth.
   *
   * Flow:
   * 1. Look up by providerAccountId
   * 2. If found → return existing user (rejected if account was deleted)
   * 3. If not found → check if email is already registered
   *    a. If email exists but with a different provider → link identities
   *    b. If email is new → create user + identity + wallet. The signup path
   *       consults the deleted-account registry, so a returning deleted
   *       identity gets a fresh account WITHOUT the free trial / signup bonus.
   */
  async findOrCreateOAuthUser(
    provider: AuthProvider.Google | AuthProvider.Apple,
    profile: {
      providerAccountId: string;
      email: string;
      name: string;
    }
  ): Promise<User> {
    // 1. Lookup by provider account ID
    const existingIdentity =
      await authIdentityRepository.findByProviderAccountId(
        provider,
        profile.providerAccountId
      );

    if (existingIdentity) {
      const user = await userRepository.findById(existingIdentity.userId);
      if (!user) throw new Error("User record missing for existing identity.");
      if (user.deletedAt) throw new Error("AccountDeleted");
      return user;
    }

    // 2. Check if email is registered under a different provider
    const existingByEmail = await userRepository.findByEmail(profile.email);
    if (existingByEmail && !existingByEmail.deletedAt) {
      // Email already exists — link this OAuth identity to the account
      await authIdentityRepository.create({
        userId: existingByEmail.id,
        provider,
        providerAccountId: profile.providerAccountId,
        passwordHash: null,
      });
      return existingByEmail;
    }

    // 3. New user — create account via AccountService to ensure all
    //    business rules (wallet, registry check, etc.) are applied
    const { accountService } = await import("@/services/AccountService");
    const { user } = await accountService.createRequesterAccount({
      name: profile.name,
      email: profile.email,
      provider,
      providerAccountId: profile.providerAccountId,
      passwordHash: null,
      consents: [], // OAuth signup: consent must be handled at UI level
    });

    return user;
  }

  /** @deprecated Use findOrCreateOAuthUser(AuthProvider.Google, …). */
  async findOrCreateGoogleUser(profile: {
    googleAccountId: string;
    email: string;
    name: string;
  }): Promise<User> {
    return this.findOrCreateOAuthUser(AuthProvider.Google, {
      providerAccountId: profile.googleAccountId,
      email: profile.email,
      name: profile.name,
    });
  }
}

export const authService = new AuthService();
