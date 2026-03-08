import { ICreditWalletRepository } from "@/repositories/interfaces/ICreditWalletRepository";
import { CreditWallet, CreateCreditWalletInput } from "@/domain/models/CreditWallet";
import { pool } from "@/lib/db";

function rowToWallet(row: Record<string, unknown>): CreditWallet {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    balance: row.balance as number,
    initialCreditsGranted: row.initial_credits_granted as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresCreditWalletRepository implements ICreditWalletRepository {
  constructor(private db = pool) {}

  async findByUserId(userId: string): Promise<CreditWallet | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM credit_wallets WHERE user_id = $1",
      [userId]
    );
    return rows[0] ? rowToWallet(rows[0]) : null;
  }

  async create(input: CreateCreditWalletInput): Promise<CreditWallet> {
    const { rows } = await this.db.query(
      `INSERT INTO credit_wallets (user_id, balance, initial_credits_granted)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.userId, input.balance, input.initialCreditsGranted]
    );
    return rowToWallet(rows[0]);
  }

  async updateBalance(walletId: string, newBalance: number): Promise<CreditWallet> {
    const { rows } = await this.db.query(
      `UPDATE credit_wallets
       SET balance = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newBalance, walletId]
    );
    if (!rows[0]) throw new Error(`Wallet not found: ${walletId}`);
    return rowToWallet(rows[0]);
  }

  async markInitialCreditsGranted(walletId: string): Promise<CreditWallet> {
    const { rows } = await this.db.query(
      `UPDATE credit_wallets
       SET initial_credits_granted = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [walletId]
    );
    if (!rows[0]) throw new Error(`Wallet not found: ${walletId}`);
    return rowToWallet(rows[0]);
  }
}
