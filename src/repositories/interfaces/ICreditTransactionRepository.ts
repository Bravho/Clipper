import {
  CreditTransaction,
  CreateCreditTransactionInput,
} from "@/domain/models/CreditTransaction";

/**
 * Repository contract for CreditTransaction persistence.
 *
 * TODO: PostgreSQL — implement PostgresCreditTransactionRepository.
 *       Transactions are immutable; never update or delete.
 */
export interface ICreditTransactionRepository {
  findByUserId(userId: string): Promise<CreditTransaction[]>;
  create(input: CreateCreditTransactionInput): Promise<CreditTransaction>;
}
