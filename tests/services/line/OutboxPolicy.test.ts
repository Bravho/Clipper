jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn(async () => 'signed-delivery') }));
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
test('outbox never pushes routine review prompts; delivery uses a signed URL and retry key', async () => {
  const outbox = new MockReviewOutboxRepository(new Map());
  const accounts = new MockLineAccountRepository(new Map(), new Map());
  await accounts.create({ userId: 'shop', lineUserId: 'line-user', lineChannelId: 'c',
    displayName: null, linkedVia: 'admin', status: 'active' });
  const client = { push: jest.fn(), reply: jest.fn() };
  const execute = jest.fn();
  const deps = { outbox, accounts, client, items: new MockReviewItemRepository(new Map()), execute };
  await outbox.enqueue({ eventType: 'review.created', payload: {} });
  await processLineReviewOutbox(deps);
  expect(client.push).not.toHaveBeenCalled();
  const delivery = await outbox.enqueue({ eventType: 'line.delivery', payload: { user_id: 'shop', storage_key: 'private-output' } });
  await processLineReviewOutbox(deps);
  expect(client.push).toHaveBeenCalledWith('line-user', [{ type: 'text', text: expect.stringContaining('signed-delivery') }], delivery.eventId);
  expect(client.reply).not.toHaveBeenCalled();
});


test.each(['video', 'customer_reply'])('real worker sends %s review creation to Grok Bot only', async typeKey => {
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid/webhook';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture-key';
  const originalFetch = global.fetch;
  const post = jest.fn(async () => ({ ok: true, status: 200 }));
  global.fetch = post as never;
  try {
    const outbox = new MockReviewOutboxRepository(new Map());
    const items = new MockReviewItemRepository(new Map());
    const item = await items.create({ typeKey, shopUserId: 'shop', title: 'review', payload: { text: 'private customer message' },
      signals: {}, decisionMode: 'review', matchedRules: [], dueAt: new Date(), expiresAt: new Date(Date.now()+86400000) });
    await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    const client = { push: jest.fn(), reply: jest.fn() };
    await processLineReviewOutbox({ outbox, items, accounts: new MockLineAccountRepository(new Map()), client, execute: jest.fn() });
    expect(post).toHaveBeenCalledTimes(1);
    const body = JSON.parse((post.mock.calls as unknown[][])[0][1] ? ((post.mock.calls as unknown[][])[0][1] as RequestInit).body as string : '{}');
    expect(body.event).toBe(typeKey === 'video' ? 'review_needed' : 'escalation');
    expect(JSON.stringify(body)).not.toContain('private customer message');
    expect(client.push).not.toHaveBeenCalled();
  } finally { global.fetch = originalFetch; delete process.env.GROKBOT_REVIEW_WEBHOOK_URL; delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY; }
});
