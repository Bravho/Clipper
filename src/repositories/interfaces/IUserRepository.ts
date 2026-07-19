import { User, CreateUserInput } from "@/domain/models/User";

/**
 * Repository contract for User persistence.
 *
 * TODO: PostgreSQL — implement PostgresUserRepository using
 *       your preferred query builder (Drizzle, Prisma, pg, Kysely).
 *       Register it in src/repositories/index.ts.
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, data: Partial<Pick<User, "name" | "role">>): Promise<User>;
  markEmailVerified(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * App Store / Play Store compliant account deletion: erases PII in place
   * (full_name → "Deleted user", email → "deleted:<id>") and sets deleted_at.
   * The row is retained so legally-required financial/consent records that
   * reference users.id survive without personal data.
   */
  anonymizeAndSoftDelete(id: string): Promise<void>;
  listAll(): Promise<User[]>;
}
