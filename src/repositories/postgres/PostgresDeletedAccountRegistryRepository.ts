import { IDeletedAccountRegistryRepository } from "@/repositories/interfaces/IDeletedAccountRegistryRepository";
import {
  DeletedAccountRecord,
  CreateDeletedAccountRecordInput,
} from "@/domain/models/DeletedAccountRecord";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { pool } from "@/lib/db";

function rowToRecord(row: Record<string, unknown>): DeletedAccountRecord {
  return {
    id: row.id as string,
    emailHash: row.email_hash as string,
    provider: row.provider as AuthProvider,
    providerAccountHash: (row.provider_account_hash as string) ?? null,
    trialConsumed: row.trial_consumed as boolean,
    bonusGranted: row.bonus_granted as boolean,
    deletedAt: new Date(row.deleted_at as string),
  };
}

export class PostgresDeletedAccountRegistryRepository
  implements IDeletedAccountRegistryRepository
{
  constructor(private db = pool) {}

  async create(
    input: CreateDeletedAccountRecordInput
  ): Promise<DeletedAccountRecord> {
    const { rows } = await this.db.query(
      `INSERT INTO deleted_account_registry
         (email_hash, provider, provider_account_hash, trial_consumed, bonus_granted)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.emailHash,
        input.provider,
        input.providerAccountHash ?? null,
        input.trialConsumed,
        input.bonusGranted,
      ]
    );
    return rowToRecord(rows[0]);
  }

  async findByEmailHash(emailHash: string): Promise<DeletedAccountRecord[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM deleted_account_registry WHERE email_hash = $1",
      [emailHash]
    );
    return rows.map(rowToRecord);
  }

  async findByProviderAccountHash(
    providerAccountHash: string
  ): Promise<DeletedAccountRecord[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM deleted_account_registry WHERE provider_account_hash = $1",
      [providerAccountHash]
    );
    return rows.map(rowToRecord);
  }
}
