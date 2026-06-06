import { IBusinessProfileRepository } from "@/repositories/interfaces/IBusinessProfileRepository";
import { BusinessProfile, CreateBusinessProfileInput, UpdateBusinessProfileInput } from "@/domain/models/BusinessProfile";
import { pool } from "@/lib/db";

function rowToBusinessProfile(row: Record<string, unknown>): BusinessProfile {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    businessName: row.business_name as string,
    category: row.category as string,
    location: (row.location as string) ?? null,
    description: (row.description as string) ?? null,
    menuDetails: (row.menu_details as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresBusinessProfileRepository implements IBusinessProfileRepository {
  constructor(private db = pool) {}

  async findByUserId(userId: string): Promise<BusinessProfile | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM business_profiles WHERE user_id = $1",
      [userId]
    );
    return rows[0] ? rowToBusinessProfile(rows[0]) : null;
  }

  async create(input: CreateBusinessProfileInput): Promise<BusinessProfile> {
    const { rows } = await this.db.query(
      `INSERT INTO business_profiles (user_id, business_name, category, location, description, menu_details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.userId,
        input.businessName,
        input.category,
        input.location ?? null,
        input.description ?? null,
        input.menuDetails ?? null
      ]
    );
    return rowToBusinessProfile(rows[0]);
  }

  async update(userId: string, data: UpdateBusinessProfileInput): Promise<BusinessProfile> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.businessName !== undefined) {
      sets.push(`business_name = $${idx++}`);
      values.push(data.businessName);
    }
    if (data.category !== undefined) {
      sets.push(`category = $${idx++}`);
      values.push(data.category);
    }
    if (data.location !== undefined) {
      sets.push(`location = $${idx++}`);
      values.push(data.location);
    }
    if (data.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.menuDetails !== undefined) {
      sets.push(`menu_details = $${idx++}`);
      values.push(data.menuDetails);
    }

    if (sets.length === 0) {
      const existing = await this.findByUserId(userId);
      if (!existing) throw new Error(`BusinessProfile not found for user: ${userId}`);
      return existing;
    }

    sets.push(`updated_at = NOW()`);
    values.push(userId);

    const { rows } = await this.db.query(
      `UPDATE business_profiles SET ${sets.join(", ")} WHERE user_id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`BusinessProfile not found for user: ${userId}`);
    return rowToBusinessProfile(rows[0]);
  }

  async upsert(userId: string, input: CreateBusinessProfileInput): Promise<BusinessProfile> {
    const { rows } = await this.db.query(
      `INSERT INTO business_profiles (user_id, business_name, category, location, description, menu_details)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         business_name = EXCLUDED.business_name,
         category = EXCLUDED.category,
         location = EXCLUDED.location,
         description = EXCLUDED.description,
         menu_details = EXCLUDED.menu_details,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        input.businessName,
        input.category,
        input.location ?? null,
        input.description ?? null,
        input.menuDetails ?? null
      ]
    );
    return rowToBusinessProfile(rows[0]);
  }
}
