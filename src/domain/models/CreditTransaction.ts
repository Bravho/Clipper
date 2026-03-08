import { TransactionType } from "@/domain/enums/TransactionType";

/**
 * Immutable credit transaction record.
 *
 * Each credit or debit is recorded as a separate transaction.
 * Positive amount = credit added. Negative amount = credit deducted.
 *
 * TODO: PostgreSQL — map to `credit_transactions` table.
 *   Columns: id, user_id, amount, type, description, reference_id, created_at
 *   Note: no wallet_id column — wallet is 1:1 with user, so user_id is sufficient.
 *   referenceId maps to reference_id (uuid FK → clip_requests.id).
 */
export interface CreditTransaction {
  id: string;
  userId: string;
  /** Positive = credit, negative = debit */
  amount: number;
  type: TransactionType;
  description: string;
  /** Links to clip_requests.id when a request charge is made. Null otherwise. */
  referenceId: string | null;
  createdAt: Date;
}

export type CreateCreditTransactionInput = Omit<
  CreditTransaction,
  "id" | "createdAt"
>;
