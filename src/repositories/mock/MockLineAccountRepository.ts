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

  async findById(id: string): Promise<LineAccount | null> {
    return [...this.accounts.values()].find(a => a.id === id) ?? null;
  }
  async beginUpload(channel: string, user: string): Promise<boolean> {
    const s = this.states.get(this.stateKey(channel,user));
    if (s?.state !== 'awaiting_files') return false;
    s.context = { ...s.context, pendingUploads: Number(s.context.pendingUploads ?? 0)+1 };
    return true;
  }
  async finishUpload(channel: string, user: string, file?: { storageKey: string; fileSizeBytes: number }): Promise<{ count: number; pending: number } | null> {
    const s = this.states.get(this.stateKey(channel,user));
    if (s?.state !== 'awaiting_files') return null;
    const files = [...(s.context.files as (string | { storageKey: string })[] ?? [])];
    if (file && files.length < 20 && !files.some(f => (typeof f === 'string' ? f : f.storageKey) === file.storageKey)) files.push(file);
    const pending = Math.max(0,Number(s.context.pendingUploads ?? 0)-1);
    s.context = { ...s.context, files, pendingUploads: pending };
    return { count: files.length, pending };
  }
  async claimSubmission(channel: string, user: string): Promise<Record<string, unknown> | null> {
    const s = this.states.get(this.stateKey(channel,user));
    if (s?.state !== 'awaiting_files' || Number(s.context.pendingUploads ?? 0) > 0 || !(s.context.files as unknown[])?.length) return null;
    s.state = 'submitting';
    return { ...s.context };
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

  async create(input: Omit<LineAccount, 'id' | 'createdAt' | 'updatedAt' | 'takeoverActive' | 'takeoverExpiresAt'>): Promise<LineAccount> {
    const now = new Date();
    const account: LineAccount = {
      takeoverActive: false,
      takeoverExpiresAt: null,
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

  async setTakeover(id: string, active: boolean, expiresAt: Date | null): Promise<void> {
    const account = this.accounts.get(id);
    if (account) {
      this.accounts.set(id, { ...account, takeoverActive: active, takeoverExpiresAt: expiresAt, updatedAt: new Date() });
    }
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
