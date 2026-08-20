import {
  PasswordResetToken,
  CreatePasswordResetTokenInput,
} from "@/domain/models/PasswordResetToken";

/** Repository contract for password reset token persistence. */
export interface IPasswordResetTokenRepository {
  create(input: CreatePasswordResetTokenInput): Promise<PasswordResetToken>;

  findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null>;

  /** Burn a token — single use, no exceptions. */
  markUsed(id: string): Promise<void>;

  /**
   * Retire every outstanding link for a user. Called before issuing a new one,
   * so requesting a second email silently kills the first.
   */
  invalidateUnusedForUser(userId: string): Promise<void>;
}
