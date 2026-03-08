import { IAuthIdentityRepository } from "@/repositories/interfaces/IAuthIdentityRepository";
import { AuthIdentity, CreateAuthIdentityInput } from "@/domain/models/AuthIdentity";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { pool } from "@/lib/db";

function rowToIdentity(row: Record<string, unknown>): AuthIdentity {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as AuthProvider,
    providerAccountId: (row.provider_account_id as string) ?? null,
    passwordHash: (row.password_hash as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresAuthIdentityRepository
  implements IAuthIdentityRepository
{
  constructor(private db = pool) {}

  async findByUserId(userId: string): Promise<AuthIdentity[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM auth_identities WHERE user_id = $1",
      [userId]
    );
    return rows.map(rowToIdentity);
  }

  async findByProviderAccountId(
    provider: AuthProvider,
    providerAccountId: string
  ): Promise<AuthIdentity | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM auth_identities WHERE provider = $1 AND provider_account_id = $2",
      [provider, providerAccountId]
    );
    return rows[0] ? rowToIdentity(rows[0]) : null;
  }

  async findCredentialsByUserId(userId: string): Promise<AuthIdentity | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2",
      [userId, AuthProvider.Credentials]
    );
    return rows[0] ? rowToIdentity(rows[0]) : null;
  }

  async create(input: CreateAuthIdentityInput): Promise<AuthIdentity> {
    const { rows } = await this.db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_account_id, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        input.userId,
        input.provider,
        input.providerAccountId ?? null,
        input.passwordHash ?? null,
      ]
    );
    return rowToIdentity(rows[0]);
  }
}
