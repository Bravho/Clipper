/**
 * Real LINE Messaging API client.
 * Uses LINE_CHANNEL_ACCESS_TOKEN from environment.
 * Never called in tests — use MockLineClient instead.
 */

import { ILineClient, LineMessage } from './ILineClient';
import { getLineChannelAccessToken, LINE_REPLY_URL, LINE_PUSH_URL } from '@/config/lineIntake';

export class LineClient implements ILineClient {
  private get token(): string {
    return getLineChannelAccessToken();
  }

  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    const res = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LINE reply failed ${res.status}: ${body}`);
    }
  }

  async push(userId: string, messages: LineMessage[], retryKey?: string): Promise<void> {
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(retryKey ? { 'X-Line-Retry-Key': retryKey } : {}),
      },
      body: JSON.stringify({ to: userId, messages }),
    });
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '');
      throw new Error(`LINE push failed ${res.status}: ${body}`);
    }
  }
}
