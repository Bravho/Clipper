import { IPasswordResetTokenRepository } from "@/repositories/interfaces/IPasswordResetTokenRepository";
import {
  PasswordResetToken,
  CreatePasswordResetTokenInput,
} from "@/domain/models/PasswordResetToken";

declare global {
  // eslint-disable-next-line no-var
  var __mockPasswordResetTokenStore:
    | Map<string, PasswordResetToken>
    | undefined;
}

function getStore(): Map<string, PasswordResetToken> {
  if (!global.__mockPasswordResetTokenStore) {
    global.__mockPasswordResetTokenStore = new Map();
  }
  return global.__mockPasswordResetTokenStore;
}

export class MockPasswordResetTokenRepository
  implements IPasswordResetTokenRepository
{
  private store: Map<string, PasswordResetToken>;

  /**
   * @param store  Pass a fresh Map to get an isolated instance for testing.
   *               Omit to use the shared global store (default for app usage).
   */
  constructor(store?: Map<string, PasswordResetToken>) {
    this.store = store ?? getStore();
  }

  async create(
    input: CreatePasswordResetTokenInput
  ): Promise<PasswordResetToken> {
    const token: PasswordResetToken = {
      ...input,
      id: crypto.randomUUID(),
      usedAt: null,
      createdAt: new Date(),
    };
    this.store.set(token.id, token);
    return { ...token };
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    for (const token of this.store.values()) {
      if (token.tokenHash === tokenHash) return { ...token };
    }
    return null;
  }

  async markUsed(id: string): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) return;
    this.store.set(id, { ...existing, usedAt: new Date() });
  }

  async invalidateUnusedForUser(userId: string): Promise<void> {
    for (const [id, token] of this.store.entries()) {
      if (token.userId === userId && !token.usedAt) {
        this.store.set(id, { ...token, usedAt: new Date() });
      }
    }
  }
}
