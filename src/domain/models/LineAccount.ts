export type LineAccountStatus = 'active' | 'blocked' | 'unlinked';
export type LineLinkedVia = 'auto_created' | 'link_code' | 'admin';

export interface LineAccount {
  id: string;
  userId: string;
  lineChannelId: string;
  lineUserId: string;
  displayName: string | null;
  linkedVia: LineLinkedVia;
  status: LineAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LineConversationState {
  lineUserId: string;
  lineChannelId: string;
  state: string;
  context: Record<string, unknown>;
  updatedAt: Date;
}
