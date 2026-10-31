import { LineAccount, LineConversationState } from '@/domain/models/LineAccount';

export interface ILineAccountRepository {
  findByLineUser(lineChannelId: string, lineUserId: string): Promise<LineAccount | null>;
  findByUserId(userId: string): Promise<LineAccount[]>;
  create(input: Omit<LineAccount, 'id' | 'createdAt' | 'updatedAt'>): Promise<LineAccount>;
  updateStatus(id: string, status: LineAccount['status']): Promise<void>;

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
