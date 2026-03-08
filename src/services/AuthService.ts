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
    if (!user) return null;

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
   * Find an existing user by Google account ID, or create a new one.
   * Used in the NextAuth signIn callback for Google OAuth.
   *
   * Flow:
   * 1. Look up by Google providerAccountId
   * 2. If found → return existing user
   * 3. If not found → check if email is already registered
   *    a. If email exists but with a different provider → link accounts (future) or error
   *    b. If email is new → create user + identity + wallet
   */
  async findOrCreateGoogleUser(profile: {
    googleAccountId: string;
    email: string;
    name: string;
  }): Promise<User> {
    // 1. Lookup by provider account ID
    const existingIdentity =
      await authIdentityRepository.findByProviderAccountId(
        AuthProvider.Google,
        profile.googleAccountId
      );

    if (existingIdentity) {
      const user = await userRepository.findById(existingIdentity.userId);
      if (!user) throw new Error("User record missing for existing identity.");
      return user;
    }

    // 2. Check if email is registered under a different provider
    const existingByEmail = await userRepository.findByEmail(profile.email);
    if (existingByEmail) {
      // Email already exists — link the Google identity to this account
      await authIdentityRepository.create({
        userId: existingByEmail.id,
        provider: AuthProvider.Google,
        providerAccountId: profile.googleAccountId,
        passwordHash: null,
      });
      return existingByEmail;
    }

    // 3. New user — create account via AccountService to ensure all
    //    business rules (wallet, etc.) are applied
    const { accountService } = await import("@/services/AccountService");
    const { user } = await accountService.createRequesterAccount({
      name: profile.name,
      email: profile.email,
      provider: AuthProvider.Google,
      providerAccountId: profile.googleAccountId,
      passwordHash: null,
      consents: [], // Google signup: consent must be handled at UI level
    });

    return user;
  }
}

export const authService = new AuthService();
