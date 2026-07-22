import bcrypt from "bcryptjs";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { Role } from "@/domain/enums/Role";
import { User } from "@/domain/models/User";
import { CreditWallet } from "@/domain/models/CreditWallet";
import { TermsAcceptance } from "@/domain/models/TermsAcceptance";
import {
  userRepository,
  authIdentityRepository,
  deletedAccountRegistryRepository,
  clipRequestRepository,
} from "@/repositories";
import { creditService } from "@/services/CreditService";
import { consentService, ConsentInput } from "@/services/ConsentService";
import { hashEmail, hashProviderAccountId } from "@/lib/auth/identityHash";

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

/** Raised when public signup is attempted for an existing email address. */
export class ExistingAccountError extends Error {
  constructor(public readonly emailVerified: boolean) {
    super("An account with this email address already exists.");
    this.name = "ExistingAccountError";
  }
}

/**
 * Signals that a credentials signup refreshed an existing, still-unverified
 * account. The API must issue a fresh verification code for this user.
 */
export class RefreshedUnverifiedAccountError extends Error {
  constructor(public readonly user: User) {
    super("Unverified account credentials refreshed.");
    this.name = "RefreshedUnverifiedAccountError";
  }
}

/**
 * AccountService — orchestrates user account creation.
 *
 * This is the central service for the signup flow. It coordinates:
 * 1. User record creation
 * 2. Auth identity creation
 * 3. Credit wallet initialisation (zero starting credits for requesters)
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
      if (
        !existing.emailVerified &&
        input.provider === AuthProvider.Credentials &&
        input.passwordHash
      ) {
        const credentialsIdentity =
          await authIdentityRepository.findCredentialsByUserId(existing.id);

        if (credentialsIdentity) {
          await authIdentityRepository.updatePasswordHash(
            existing.id,
            input.passwordHash
          );
        } else {
          await authIdentityRepository.create({
            userId: existing.id,
            provider: AuthProvider.Credentials,
            providerAccountId: null,
            passwordHash: input.passwordHash,
          });
        }

        const refreshedUser = await userRepository.update(existing.id, {
          name: input.name.trim(),
        });
        throw new RefreshedUnverifiedAccountError(refreshedUser);
      }

      throw new ExistingAccountError(existing.emailVerified);
    }

    // 1b. Deleted-account registry check (fraud prevention).
    //     If this email or OAuth identity belonged to a previously deleted
    //     account, the new account inherits the entitlements already consumed:
    //     trial used → no free trial; bonus received → no signup bonus.
    const priorUsage = await this.lookupPriorUsage(
      input.email,
      input.providerAccountId ?? null
    );

    // 2. Create user record
    const user = await userRepository.create({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      role: Role.Requester, // Public signup always creates Requester
      emailVerified: false,
      trialConsumed: priorUsage.trialConsumed,
    });

    // 3. Create auth identity
    await authIdentityRepository.create({
      userId: user.id,
      provider: input.provider,
      providerAccountId: input.providerAccountId ?? null,
      passwordHash: input.passwordHash,
    });

    // 4. Initialise the requester wallet at the configured starting balance
    const wallet = await creditService.initialiseRequesterWallet(user.id, {
      skipBonus: priorUsage.bonusGranted,
    });

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
   * Check the deleted-account registry for prior entitlement usage by this
   * email and/or OAuth provider account id. ORs the flags across all matching
   * rows — if the trial was consumed in ANY prior life of the identity, it
   * stays consumed.
   */
  async lookupPriorUsage(
    email: string,
    providerAccountId: string | null
  ): Promise<{ trialConsumed: boolean; bonusGranted: boolean }> {
    const records = await deletedAccountRegistryRepository.findByEmailHash(
      hashEmail(email)
    );

    if (providerAccountId) {
      const byProvider =
        await deletedAccountRegistryRepository.findByProviderAccountHash(
          hashProviderAccountId(providerAccountId)
        );
      records.push(...byProvider);
    }

    return {
      trialConsumed: records.some((r) => r.trialConsumed),
      bonusGranted: records.some((r) => r.bonusGranted),
    };
  }

  /**
   * Change the password on a credentials (email/password) account.
   * OAuth-only accounts (Google/Apple) have no password and are rejected.
   *
   * Throws:
   *   "PasswordNotSupported"    — no credentials identity on this account
   *   "InvalidCurrentPassword"  — current password did not match
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const identity =
      await authIdentityRepository.findCredentialsByUserId(userId);
    if (!identity || !identity.passwordHash) {
      throw new Error("PasswordNotSupported");
    }

    const valid = await bcrypt.compare(currentPassword, identity.passwordHash);
    if (!valid) {
      throw new Error("InvalidCurrentPassword");
    }

    const newHash = await AccountService.hashPassword(newPassword);
    await authIdentityRepository.updatePasswordHash(userId, newHash);
  }

  /**
   * Delete the user's account — App Store 5.1.1(v) / Play Store compliant.
   *
   * What happens:
   * 1. Identity re-verification: credentials accounts must supply their
   *    current password (explicitly permitted by Apple to confirm intent).
   * 2. A fraud-prevention record is written to deleted_account_registry —
   *    one-way hashes of the email / OAuth account ids plus the entitlement
   *    flags (trial consumed, bonus granted). Not linked to the user row.
   * 3. All auth identities are deleted (password hash, OAuth links) — the
   *    account can no longer log in.
   * 4. The user row is anonymized in place (name, email erased; deleted_at
   *    set). The row is retained only so legally-required financial records
   *    (credit ledger, purchase logs) and consent audit records keep a valid
   *    reference — they contain no personal data after this step.
   *
   * Remaining credits are forfeited (the wallet's identity link is the
   * account itself). The caller must sign the user out afterwards.
   *
   * Throws:
   *   "UserNotFound"            — no such account or already deleted
   *   "InvalidCurrentPassword"  — password re-verification failed
   */
  async deleteAccount(
    userId: string,
    options?: { password?: string }
  ): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user || user.deletedAt) {
      throw new Error("UserNotFound");
    }

    const identities = await authIdentityRepository.findByUserId(userId);
    const credentialsIdentity = identities.find(
      (i) => i.provider === AuthProvider.Credentials && i.passwordHash
    );

    // 1. Re-verify identity for credentials accounts
    if (credentialsIdentity) {
      const supplied = options?.password ?? "";
      const valid =
        supplied.length > 0 &&
        (await bcrypt.compare(supplied, credentialsIdentity.passwordHash!));
      if (!valid) {
        throw new Error("InvalidCurrentPassword");
      }
    }

    // 2. Compute consumed entitlements at deletion time
    const requests = await clipRequestRepository.findByUserId(userId);
    const trialConsumed =
      user.trialConsumed || requests.some((r) => r.submittedAt !== null);

    const wallet = await creditService.getWallet(userId);
    const bonusGranted = wallet?.initialCreditsGranted ?? false;

    const emailHash = hashEmail(user.email);

    // 3. Write one registry row per identity (email-only row if none remain)
    const registryInputs =
      identities.length > 0
        ? identities.map((i) => ({
            emailHash,
            provider: i.provider,
            providerAccountHash: i.providerAccountId
              ? hashProviderAccountId(i.providerAccountId)
              : null,
            trialConsumed,
            bonusGranted,
          }))
        : [
            {
              emailHash,
              provider: AuthProvider.Credentials,
              providerAccountHash: null,
              trialConsumed,
              bonusGranted,
            },
          ];

    for (const input of registryInputs) {
      await deletedAccountRegistryRepository.create(input);
    }

    // 4. Remove login ability, then anonymize the user row
    await authIdentityRepository.deleteByUserId(userId);
    await userRepository.anonymizeAndSoftDelete(userId);
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
