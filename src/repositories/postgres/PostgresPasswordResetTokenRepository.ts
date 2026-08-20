import { IPasswordResetTokenRepository } from "@/repositories/interfaces/IPasswordResetTokenRepository";
import {
  PasswordResetToken,
  CreatePasswordResetTokenInput,
} from "@/domain/models/PasswordResetToken";
import { pool } from "@/lib/db";

function rowToToken(row: Record<string, unknown>): PasswordResetToken {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    expiresAt: new Date(row.expires_at as string),
    usedAt: row.used_at ? new Date(row.used_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresPasswordResetTokenRepository
  implements IPasswordResetTokenRepository
{
  constructor(private db = pool) {}

  async create(
    input: CreatePasswordResetTokenInput
  ): Promise<PasswordResetToken> {
    const { rows } = await this.db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.userId, input.tokenHash, input.expiresAt]
    );
    return rowToToken(rows[0]);
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM password_reset_tokens WHERE token_hash = $1",
      [tokenHash]
    );
    return rows[0] ? rowToToken(rows[0]) : null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async invalidateUnusedForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
  }
}
