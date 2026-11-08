import { processLineEvent, LineWebhookEvent } from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockLineClient } from '@/lib/line/MockLineClient';

function textEvent(text: string): LineWebhookEvent {
  return {
    type: 'message',
    message: { type: 'text', text },
    replyToken: 'rt-unknown',
    source: { userId: 'U-shop-1' },
  } as LineWebhookEvent;
}

describe('unknown message fallback', () => {
  it('saves the shop text for the review queue and says the team will check (no "does not understand")', async () => {
    const lineClient = new MockLineClient();
    const lineAccountRepo = new MockLineAccountRepository(new Map());
    const createReviewItem = jest.fn(async () => undefined);

    const result = await processLineEvent(textEvent('xyzabc'), {
      lineChannelId: 'ch-1',
      lineClient,
      lineAccountRepo,
      createReviewItem,
    });

    expect(result).toEqual({ escalated: true, intent: 'unknown' });
    expect(createReviewItem).toHaveBeenCalledWith({ lineUserId: 'U-shop-1', text: 'xyzabc', intent: 'unknown' });
    const sent = JSON.stringify(lineClient.sent);
    expect(sent).toContain('ทีมงาน');
    expect(sent).not.toContain('ไม่เข้าใจ');
  });
});
