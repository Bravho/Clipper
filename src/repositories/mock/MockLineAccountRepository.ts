import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { LineAccount, LineConversationState } from '@/domain/models/LineAccount';

export class MockLineAccountRepository implements ILineAccountRepository {
  private accounts: Map<string, LineAccount>;
  private states: Map<string, LineConversationState>;

  constructor(
    accounts?: Map<string, LineAccount>,
    states?: Map<string, LineConversationState>
  ) {
    this.accounts = accounts ?? new Map();
    this.states = states ?? new Map();
  }

  private stateKey(lineChannelId: string, lineUserId: string): string {
    return `${lineChannelId}:${lineUserId}`;
  }

  async findByLineUser(lineChannelId: string, lineUserId: string): Promise<LineAccount | null> {
    for (const a of this.accounts.values()) {
      if (a.lineChannelId === lineChannelId && a.lineUserId === lineUserId) {
        return { ...a };
      }
    }
    return null;
  }

  async findByUserId(userId: string): Promise<LineAccount[]> {
    return [...this.accounts.values()]
      .filter((a) => a.userId === userId)
      .map((a) => ({ ...a }));
  }

  async create(input: Omit<LineAccount, 'id' | 'createdAt' | 'updatedAt'>): Promise<LineAccount> {
    const now = new Date();
    const account: LineAccount = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(account.id, account);
    return { ...account };
  }

  async updateStatus(id: string, status: LineAccount['status']): Promise<void> {
    const account = this.accounts.get(id);
    if (account) this.accounts.set(id, { ...account, status, updatedAt: new Date() });
  }

  async getConversationState(
    lineChannelId: string,
    lineUserId: string
  ): Promise<LineConversationState | null> {
    const s = this.states.get(this.stateKey(lineChannelId, lineUserId));
    return s ? { ...s } : null;
  }

  async upsertConversationState(
    lineChannelId: string,
    lineUserId: string,
    state: string,
    context: Record<string, unknown>
  ): Promise<void> {
    const key = this.stateKey(lineChannelId, lineUserId);
    this.states.set(key, {
      lineUserId,
      lineChannelId,
      state,
      context,
      updatedAt: new Date(),
    });
  }
}
