
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
jest.mock('@/repositories', () => ({
  lineAccountRepository: new (require('@/repositories/mock/MockLineAccountRepository').MockLineAccountRepository)(new Map()),
  reviewOutboxRepository: new (require('@/repositories/mock/MockReviewOutboxRepository').MockReviewOutboxRepository)(new Map()),
}));
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/line/takeover/route';
import { lineAccountRepository, reviewOutboxRepository } from '@/repositories';
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
test('real takeover route enqueues notification delivered by real worker', async () => {
  process.env.REVIEW_ADMIN_TOKEN = 'fixture-token';
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid/webhook';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture-key';
  const original = global.fetch;
  const post = jest.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 })); global.fetch = post as never;
  try {
    await lineAccountRepository.create({ userId: 'shop', lineUserId: 'private-line-id', lineChannelId: 'c', displayName: null, linkedVia: 'admin', status: 'active' });
    const response = await POST(new NextRequest('http://localhost/api/admin/line/takeover', { method: 'POST',
      headers: { authorization: 'Bearer fixture-token' }, body: JSON.stringify({ lineChannelId: 'c', lineUserId: 'private-line-id', active: true }) }));
    expect(response.status).toBe(200);
    const client = { push: jest.fn(), reply: jest.fn() };
    await processLineReviewOutbox({ outbox: reviewOutboxRepository, accounts: lineAccountRepository,
      items: new MockReviewItemRepository(new Map()), client, execute: jest.fn() });
    const body = JSON.parse((post.mock.calls[0][1] as RequestInit).body as string);
    expect(body.event).toBe('takeover_on');
    expect(JSON.stringify(body)).not.toContain('private-line-id');
    expect(client.push).not.toHaveBeenCalled();
  } finally { global.fetch = original; delete process.env.REVIEW_ADMIN_TOKEN; delete process.env.GROKBOT_REVIEW_WEBHOOK_URL; delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY; }
});
