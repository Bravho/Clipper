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
  /** When true the LINE webhook silently skips incoming messages for this shop. */
  takeoverActive: boolean;
  /** Auto-clears takeover when this timestamp passes (null = no expiry). */
  takeoverExpiresAt: Date | null;
  /** True when this account was created during a LINE test run (migration 054). */
  isTest?: boolean;
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
