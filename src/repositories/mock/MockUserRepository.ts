import { IUserRepository } from "@/repositories/interfaces/IUserRepository";
import { User, CreateUserInput } from "@/domain/models/User";
import { SEED_USERS } from "@/seed/mockData";

// ---------------------------------------------------------------------------
// Persistent in-memory store
// ---------------------------------------------------------------------------
// Uses globalThis to survive Next.js hot-module reloads in development.
// In production the store resets on each cold start — which is fine because
// a real PostgreSQL repository will be used instead.
//
// TODO: PostgreSQL — replace this file with PostgresUserRepository
//       and update src/repositories/index.ts.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __mockUserStore: Map<string, User> | undefined;
}

function getStore(): Map<string, User> {
  if (!global.__mockUserStore) {
    global.__mockUserStore = new Map();
    SEED_USERS.forEach((u) => global.__mockUserStore!.set(u.id, { ...u }));
  }
  return global.__mockUserStore;
}

export class MockUserRepository implements IUserRepository {
  private store: Map<string, User>;

  /**
   * @param store  Pass a fresh Map to get an isolated instance for testing.
   *               Omit to use the shared global store (default for app usage).
   */
  constructor(store?: Map<string, User>) {
    this.store = store ?? getStore();
  }

  async findById(id: string): Promise<User | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.store.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) return { ...user };
    }
    return null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const user: User = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(user.id, user);
    return { ...user };
  }

  async update(
    id: string,
    data: Partial<Pick<User, "name" | "role">>
  ): Promise<User> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`User not found: ${id}`);
    const updated: User = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listAll(): Promise<User[]> {
    return [...this.store.values()].map((u) => ({ ...u }));
  }
}
