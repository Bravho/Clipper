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
