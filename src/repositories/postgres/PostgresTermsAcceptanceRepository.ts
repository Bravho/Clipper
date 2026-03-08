import { ITermsAcceptanceRepository } from "@/repositories/interfaces/ITermsAcceptanceRepository";
import {
  TermsAcceptance,
  CreateTermsAcceptanceInput,
} from "@/domain/models/TermsAcceptance";
import { PolicyType } from "@/domain/enums/PolicyType";
import { pool } from "@/lib/db";

function rowToAcceptance(row: Record<string, unknown>): TermsAcceptance {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    policyType: row.policy_type as PolicyType,
    policyVersion: row.policy_version as string,
    acceptedAt: new Date(row.accepted_at as string),
    ipAddress: (row.ip_address as string) ?? null,
    userAgent: (row.user_agent as string) ?? null,
  };
}

export class PostgresTermsAcceptanceRepository
  implements ITermsAcceptanceRepository
{
  constructor(private db = pool) {}

  async findByUserId(userId: string): Promise<TermsAcceptance[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM terms_acceptances WHERE user_id = $1 ORDER BY accepted_at",
      [userId]
    );
    return rows.map(rowToAcceptance);
  }

  async findLatestByUserIdAndType(
    userId: string,
    policyType: PolicyType
  ): Promise<TermsAcceptance | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM terms_acceptances
       WHERE user_id = $1 AND policy_type = $2
       ORDER BY accepted_at DESC
       LIMIT 1`,
      [userId, policyType]
    );
    return rows[0] ? rowToAcceptance(rows[0]) : null;
  }

  async create(input: CreateTermsAcceptanceInput): Promise<TermsAcceptance> {
    const { rows } = await this.db.query(
      `INSERT INTO terms_acceptances (user_id, policy_type, policy_version, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.userId,
        input.policyType,
        input.policyVersion,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    );
    return rowToAcceptance(rows[0]);
  }
}
