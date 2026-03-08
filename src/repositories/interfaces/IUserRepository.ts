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
  delete(id: string): Promise<void>;
  listAll(): Promise<User[]>;
}
