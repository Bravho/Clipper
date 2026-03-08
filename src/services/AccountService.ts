import bcrypt from "bcryptjs";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { User } from "@/domain/models/User";
import { CreditWallet } from "@/domain/models/CreditWallet";
import { TermsAcceptance } from "@/domain/models/TermsAcceptance";
import { userRepository, authIdentityRepository } from "@/repositories";
import { creditService } from "@/services/CreditService";
import { consentService, ConsentInput } from "@/services/ConsentService";

export interface CreateRequesterAccountInput {
  name: string;
  email: string;
  provider: AuthProvider;
  passwordHash: string | null;
  providerAccountId?: string | null;
  consents: ConsentInput[];
  meta?: { ipAddress?: string; userAgent?: string };
}

export interface CreateRequesterAccountResult {
  user: User;
  wallet: CreditWallet;
  acceptances: TermsAcceptance[];
}

export interface AccountProfile {
  user: User;
  wallet: CreditWallet | null;
  acceptances: TermsAcceptance[];
}

/**
 * AccountService — orchestrates user account creation.
 *
 * This is the central service for the signup flow. It coordinates:
 * 1. User record creation
 * 2. Auth identity creation
 * 3. Credit wallet initialisation (30 free credits for requesters)
 * 4. Legal consent recording
 *
 * Business rules enforced:
 * - Only Requester accounts can be created through public signup.
 * - Staff and Admin accounts are created via seed/internal tooling only.
 * - 30 free credits are granted exactly once per new requester account.
 * - Duplicate email registration is rejected.
 *
 * TODO: When request submission is built, AccountService will expose
 *       a getAccountProfile() method used by the requester dashboard.
 *
 * TODO: PostgreSQL — wrap the multi-step creation in a database transaction
 *       to ensure atomicity. If the wallet creation fails, the user record
 *       should also be rolled back.
 */
export class AccountService {
  async createRequesterAccount(
    input: CreateRequesterAccountInput
  ): Promise<CreateRequesterAccountResult> {
    // 1. Duplicate email check
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new Error("An account with this email address already exists.");
    }

    // 2. Create user record
    const user = await userRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      role: Role.Requester, // Public signup always creates Requester
    });

    // 3. Create auth identity
    await authIdentityRepository.create({
      userId: user.id,
      provider: input.provider,
      providerAccountId: input.providerAccountId ?? null,
      passwordHash: input.passwordHash,
    });

    // 4. Initialise credit wallet + grant signup bonus
    const wallet = await creditService.initialiseRequesterWallet(user.id);

    // 5. Record legal consents
    const acceptances = await consentService.recordConsents(
      user.id,
      input.consents,
      input.meta
    );

    return { user, wallet, acceptances };
  }

  /**
   * Returns full profile data for the account page.
   * Future modules (dashboard, request history) will call this.
   */
  async getAccountProfile(userId: string): Promise<AccountProfile> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error("User not found.");

    const wallet = await creditService.getWallet(userId);
    const acceptances = await consentService.getUserConsents(userId);

    return { user, wallet, acceptances };
  }

  /**
   * Hash a plaintext password using bcrypt.
   * Call this before passing passwordHash to createRequesterAccount().
   */
  static async hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, 12);
  }
}

export const accountService = new AccountService();
