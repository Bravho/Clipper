import { ICreditPurchaseLogRepository } from "@/repositories/interfaces/ICreditPurchaseLogRepository";
import { CreditPurchaseLog, CreateCreditPurchaseLogInput } from "@/domain/models/CreditPurchaseLog";
import { pool } from "@/lib/db";

function rowToCreditPurchaseLog(row: Record<string, unknown>): CreditPurchaseLog {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    creditsAdded: row.credits_added as number,
    amountBaht: parseFloat((row.amount_baht as string) ?? "0"),
    transactionRef: (row.transaction_ref as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresCreditPurchaseLogRepository implements ICreditPurchaseLogRepository {
  constructor(private db = pool) {}

  async create(input: CreateCreditPurchaseLogInput): Promise<CreditPurchaseLog> {
    const { rows } = await this.db.query(
      `INSERT INTO credit_purchase_logs (user_id, credits_added, amount_baht, transaction_ref)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.userId, input.creditsAdded, input.amountBaht, input.transactionRef ?? null]
    );
    return rowToCreditPurchaseLog(rows[0]);
  }

  async findByUserId(userId: string): Promise<CreditPurchaseLog[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM credit_purchase_logs WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToCreditPurchaseLog);
  }

  async listAll(): Promise<CreditPurchaseLog[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM credit_purchase_logs ORDER BY created_at DESC"
    );
    return rows.map(rowToCreditPurchaseLog);
  }
}
