import { LineAccount, LineConversationState } from '@/domain/models/LineAccount';

export interface ILineAccountRepository {
  lockShop?(userId: string): Promise<LineAccount[]>;
  findById(id: string): Promise<LineAccount | null>;
  beginUpload(channel: string, user: string): Promise<boolean>;
  finishUpload(channel: string, user: string, file?: { storageKey: string; fileSizeBytes: number }): Promise<{ count: number; pending: number } | null>;
  claimSubmission(channel: string, user: string): Promise<Record<string, unknown> | null>;
  findByLineUser(lineChannelId: string, lineUserId: string): Promise<LineAccount | null>;
  findByUserId(userId: string): Promise<LineAccount[]>;
  create(input: Omit<LineAccount, 'id' | 'createdAt' | 'updatedAt' | 'takeoverActive' | 'takeoverExpiresAt'>): Promise<LineAccount>;
  updateStatus(id: string, status: LineAccount['status']): Promise<void>;

  setTakeover(id: string, active: boolean, expiresAt: Date | null): Promise<void>;

  getConversationState(
    lineChannelId: string,
    lineUserId: string
  ): Promise<LineConversationState | null>;
  upsertConversationState(
    lineChannelId: string,
    lineUserId: string,
    state: string,
    context: Record<string, unknown>
  ): Promise<void>;
}
