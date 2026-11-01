jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn(async () => 'signed-video') }));
jest.mock('@/repositories', () => ({ createReviewService: jest.fn(), lineAccountRepository: { findByUserId: jest.fn() } }));
jest.mock('@/services/VideoGenerationService', () => ({ videoGenerationService: { runStoryboardVoiceTask: jest.fn() } }));
import { videoGenerationService } from '@/services/VideoGenerationService';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/review/[id]/decision/route';
import { lineAccountRepository, createReviewService } from '@/repositories';
import { ReviewService } from '@/services/review/ReviewService';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';

async function setup(eventType: string) {
  const store = new Map();
  const outbox = new MockReviewOutboxRepository(store);
  const items = new MockReviewItemRepository(new Map());
  const accounts = new MockLineAccountRepository(new Map(), new Map());
  const account = await accounts.create({ userId: 'shop', lineUserId: 'line-shop', lineChannelId: 'c', displayName: null, linkedVia: 'admin', status: 'active' });
  await accounts.setTakeover(account.id, true, new Date(Date.now() + 86400000));
  const item = await items.create({ typeKey: 'customer_reply', shopUserId: 'shop', title: 'review', payload: {}, signals: {}, decisionMode: 'review', matchedRules: [], dueAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  const event = await outbox.enqueue({ eventType, reviewItemId: eventType === 'line.delivery' ? undefined : item.id, payload: { user_id: 'shop', storage_key: 'private' } });
  const client = { push: jest.fn(), reply: jest.fn() };
  const execute = jest.fn();
  return { store, outbox, items, accounts, account, item, event, client, execute };
}

describe.each(['review.decided', 'review.edited', 'line.delivery', 'storyboard.voice'])('%s takeover', eventType => {
  test.each(['off', 'expiry'])('defers work without failures and resumes after %s', async end => {
    jest.useFakeTimers();
    try {
      const d = await setup(eventType);
      jest.clearAllMocks();
      await processLineReviewOutbox(d);
      expect(d.execute).not.toHaveBeenCalled();
      expect(d.client.push).not.toHaveBeenCalled();
      expect(videoGenerationService.runStoryboardVoiceTask).not.toHaveBeenCalled();
      expect(d.store.get(d.event.id)).toMatchObject({ state: 'queued', attempts: 0, sentAt: null });
      if (end === 'off') await d.accounts.setTakeover(d.account.id, false, null);
      else await d.accounts.setTakeover(d.account.id, true, new Date(Date.now() - 1));
      jest.advanceTimersByTime(300001);
      await processLineReviewOutbox(d);
      expect(d.store.get(d.event.id).state).toBe('sent');
      expect(d.client.push).toHaveBeenCalledTimes(eventType === 'storyboard.voice' ? 0 : 1);
      expect(d.execute).toHaveBeenCalledTimes(eventType.startsWith('review.') ? 1 : 0);
      expect(videoGenerationService.runStoryboardVoiceTask).toHaveBeenCalledTimes(eventType === 'storyboard.voice' ? 1 : 0);
      expect((await d.accounts.findByUserId('shop'))[0].takeoverActive).toBe(false);
    } finally { jest.useRealTimers(); }
  });
});

test('explicit admin API reply is delivered during takeover without executing automation', async () => {
  const d = await setup('review.decided');
  // Remove only this fixture's initial event from consideration.
  await d.outbox.markSent(d.event.id);
  const service = new ReviewService(d.items, new MockReviewActionRepository(new Map()), new MockEscalationRuleRepository(new Map()), d.outbox);
  (createReviewService as jest.Mock).mockReturnValue(service);
  (lineAccountRepository.findByUserId as jest.Mock).mockResolvedValue([await d.accounts.findById(d.account.id)]);
  process.env.REVIEW_ADMIN_TOKEN = 'fixture-token';
  try {
    const response = await POST(new NextRequest('http://localhost/api/admin/review/item/decision', { method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body: JSON.stringify({ version: d.item.version, decision: 'manual_reply', replyText: 'Tho typed this reply', allowDuringTakeover: true }) }), { params: { id: d.item.id } });
    expect(response.status).toBe(200);
    await processLineReviewOutbox(d);
    expect(d.execute).not.toHaveBeenCalled();
    expect(d.client.push).toHaveBeenCalledWith('line-shop', [{ type: 'text', text: 'Tho typed this reply' }], expect.any(String));
    expect((await d.accounts.findByUserId('shop'))[0].takeoverActive).toBe(true);
  } finally { delete process.env.REVIEW_ADMIN_TOKEN; }
});
