/**
 * In-memory LINE client for unit tests.
 * Records all sent messages without making network calls.
 */

import { ILineClient, LineMessage } from './ILineClient';

export interface SentMessage {
  kind: 'reply' | 'push';
  replyToken?: string;
  userId?: string;
  messages: LineMessage[];
}

export class MockLineClient implements ILineClient {
  readonly sent: SentMessage[] = [];

  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    this.sent.push({ kind: 'reply', replyToken, messages });
  }

  async push(userId: string, messages: LineMessage[]): Promise<void> {
    this.sent.push({ kind: 'push', userId, messages });
  }

  reset(): void {
    this.sent.length = 0;
  }
}
