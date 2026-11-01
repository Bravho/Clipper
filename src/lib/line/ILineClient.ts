/**
 * LINE Messaging API client interface.
 * The real implementation makes HTTP calls; the mock is used in tests.
 */

export interface LineTextMessage {
  type: 'text';
  text: string;
  quickReply?: { items: Array<{ type: 'action'; action: { type: 'message'; label: string; text: string } }> };
}

export type LineMessage = LineTextMessage;

export interface ILineClient {
  /** Reply to a webhook event using the reply token. */
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  /** Push a message to a specific user (LINE userId). */
  push(userId: string, messages: LineMessage[], retryKey?: string): Promise<void>;
}
