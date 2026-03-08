import { IUserRepository } from "@/repositories/interfaces/IUserRepository";
import { User, CreateUserInput } from "@/domain/models/User";
import { Role } from "@/domain/enums/Role";
import { pool } from "@/lib/db";

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.full_name as string,
    role: row.role as Role,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresUserRepository implements IUserRepository {
  constructor(private db = pool) {}

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM users WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM users WHERE lower(email) = lower($1)",
      [email]
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const { rows } = await this.db.query(
      `INSERT INTO users (email, full_name, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.email, input.name, input.role]
    );
    return rowToUser(rows[0]);
  }

  async update(
    id: string,
    data: Partial<Pick<User, "name" | "role">>
  ): Promise<User> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`full_name = $${idx++}`);
      values.push(data.name);
    }
    if (data.role !== undefined) {
      sets.push(`role = $${idx++}`);
      values.push(data.role);
    }
    if (sets.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`User not found: ${id}`);
      return existing;
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`User not found: ${id}`);
    return rowToUser(rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM users WHERE id = $1", [id]);
  }

  async listAll(): Promise<User[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM users ORDER BY created_at"
    );
    return rows.map(rowToUser);
  }
}
