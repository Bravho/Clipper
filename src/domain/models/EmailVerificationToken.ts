/**
 * Email verification token.
 * Stores a SHA-256 hash of the raw token sent in the verification URL.
 * The raw token is never stored — only the hash.
 */
export interface EmailVerificationToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export type CreateEmailVerificationTokenInput = Pick<
  EmailVerificationToken,
  "userId" | "tokenHash" | "expiresAt"
>;
