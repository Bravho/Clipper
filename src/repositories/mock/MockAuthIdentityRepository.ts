import { IAuthIdentityRepository } from "@/repositories/interfaces/IAuthIdentityRepository";
import { AuthIdentity, CreateAuthIdentityInput } from "@/domain/models/AuthIdentity";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { SEED_AUTH_IDENTITIES } from "@/seed/mockData";

// TODO: PostgreSQL — replace with PostgresAuthIdentityRepository

declare global {
  // eslint-disable-next-line no-var
  var __mockAuthIdentityStore: Map<string, AuthIdentity> | undefined;
}

function getStore(): Map<string, AuthIdentity> {
  if (!global.__mockAuthIdentityStore) {
    global.__mockAuthIdentityStore = new Map();
    SEED_AUTH_IDENTITIES.forEach((i) =>
      global.__mockAuthIdentityStore!.set(i.id, { ...i })
    );
  }
  return global.__mockAuthIdentityStore;
}

export class MockAuthIdentityRepository implements IAuthIdentityRepository {
  private store: Map<string, AuthIdentity>;

  constructor(store?: Map<string, AuthIdentity>) {
    this.store = store ?? getStore();
  }

  async findByUserId(userId: string): Promise<AuthIdentity[]> {
    return [...this.store.values()]
      .filter((i) => i.userId === userId)
      .map((i) => ({ ...i }));
  }

  async findByProviderAccountId(
    provider: AuthProvider,
    providerAccountId: string
  ): Promise<AuthIdentity | null> {
    for (const identity of this.store.values()) {
      if (
        identity.provider === provider &&
        identity.providerAccountId === providerAccountId
      ) {
        return { ...identity };
      }
    }
    return null;
  }

  async findCredentialsByUserId(userId: string): Promise<AuthIdentity | null> {
    for (const identity of this.store.values()) {
      if (
        identity.userId === userId &&
        identity.provider === AuthProvider.Credentials
      ) {
        return { ...identity };
      }
    }
    return null;
  }

  async create(input: CreateAuthIdentityInput): Promise<AuthIdentity> {
    const identity: AuthIdentity = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.store.set(identity.id, identity);
    return { ...identity };
  }
}
