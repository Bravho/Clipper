/**
 * Credit wallet for a user account.
 *
 * One wallet per user. Tracks current balance and whether
 * the initial signup bonus has been granted (prevents double-grant).
 *
 * TODO: PostgreSQL — map to `credit_wallets` table.
 *       Use a database-level unique constraint on userId.
 *       Consider row-level locking for concurrent deduction operations.
 */
export interface CreditWallet {
  id: string;
  userId: string;
  balance: number;
  /** True once the 30-credit signup bonus has been granted. Guards against double-grant. */
  initialCreditsGranted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateCreditWalletInput = Omit<
  CreditWallet,
  "id" | "createdAt" | "updatedAt"
>;
