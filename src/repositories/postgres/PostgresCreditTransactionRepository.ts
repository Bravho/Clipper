import { ICreditTransactionRepository } from "@/repositories/interfaces/ICreditTransactionRepository";
import {
  CreditTransaction,
  CreateCreditTransactionInput,
} from "@/domain/models/CreditTransaction";
import { TransactionType } from "@/domain/enums/TransactionType";
import { pool } from "@/lib/db";

function rowToTransaction(row: Record<string, unknown>): CreditTransaction {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    amount: row.amount as number,
    type: row.type as TransactionType,
    description: row.description as string,
    referenceId: (row.reference_id as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresCreditTransactionRepository
  implements ICreditTransactionRepository
{
  constructor(private db = pool) {}

  async findByUserId(userId: string): Promise<CreditTransaction[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToTransaction);
  }

  async create(
    input: CreateCreditTransactionInput
  ): Promise<CreditTransaction> {
    const { rows } = await this.db.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.userId,
        input.amount,
        input.type,
        input.description,
        input.referenceId ?? null,
      ]
    );
    return rowToTransaction(rows[0]);
  }
}
