/**
 * A single-use password reset grant.
 *
 * `tokenHash` is SHA-256 of the raw token that was mailed out — the raw value
 * is never persisted, so reading this table gives an attacker nothing.
 */
export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export type CreatePasswordResetTokenInput = Omit<
  PasswordResetToken,
  "id" | "usedAt" | "createdAt"
>;
