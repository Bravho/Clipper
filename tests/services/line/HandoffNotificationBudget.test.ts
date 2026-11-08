jest.mock('@/lib/db', () => ({ pool: {} }));
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
import { PostgresLineHandoffRepository } from '@/repositories/postgres/PostgresLineHandoffRepository';
import { LineHandoffService } from '@/services/line/LineHandoffService';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';

afterEach(() => {
  delete process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN;
  delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  jest.useRealTimers();
});

test('Postgres atomically reserves a minute slot, without read-then-write counting', async () => {
  const query = jest.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
  const repo = new PostgresLineHandoffRepository({ query } as never);
  expect(await repo.reserveNotification('shop', 6)).toBe(true);
  expect(await repo.reserveNotification('shop', 6)).toBe(false);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0]).toContain('ON CONFLICT (shop_user_id,window_start)');
  expect(query.mock.calls[0][0]).toContain('line_handoff_notification_limits.count < $2');
  expect(query.mock.calls[0][1]).toEqual(['shop', 6]);
});

test.each([['2',2], ['0',6], ['-3',6], ['invalid',6], ['1.5',6]])('notification limit %s uses %s', async (value, maximum) => {
  process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN = value;
  const reserveNotification = jest.fn(async () => true);
  await new LineHandoffService({ reserveNotification }).reserveNotification('shop');
  expect(reserveNotification).toHaveBeenCalledWith('shop', maximum);
});

test('concurrent reservations share one shop budget; another shop and the next minute are independent', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'));
  process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN = '2';
  const repo = new MockReviewOutboxRepository(new Map());
  expect(await Promise.all(Array.from({ length: 8 }, () => repo.reserveHandoffNotification('shop'))))
    .toEqual([true, true, false, false, false, false, false, false]);
  expect(await repo.reserveHandoffNotification('other')).toBe(true);
  jest.advanceTimersByTime(60_000);
  expect(await repo.reserveHandoffNotification('shop')).toBe(true);
});

test('unconfigured notifier retains customer escalation instead of losing it as sent', async () => {
  const store = new Map();
  const outbox = new MockReviewOutboxRepository(store);
  const items = new MockReviewItemRepository(new Map());
  const item = await items.create({ typeKey: 'customer_reply', shopUserId: 'shop', title: 'unknown',
    payload: { text: 'private text', lineUserId: 'private identity' }, signals: {}, decisionMode: 'review',
    matchedRules: [], dueAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  const event = await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
  const push = jest.fn();
  await processLineReviewOutbox({ outbox, items, accounts: new MockLineAccountRepository(new Map(), new Map()),
    client: { push, reply: jest.fn() }, execute: jest.fn() });
  expect(store.get(event.id)).toMatchObject({ state: 'queued', attempts: 0, sentAt: null });
  expect(push).not.toHaveBeenCalled();
});
