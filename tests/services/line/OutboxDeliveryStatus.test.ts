/**
 * An outbox row is marked `sent` only when something was actually delivered.
 * Root cause of customer_reply items 28625f5e / 870dc941: their review.created
 * escalation ran while GROKBOT_REVIEW_WEBHOOK_URL was unset; notifyGrokBot
 * returned silently and the worker marked the row sent (nothing left the box).
 */
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn(async () => 'https://signed.example/v') }));
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { processLineReviewOutbox, recipientRetryKey } from '@/services/line/LineReviewOutboxWorker';

const env = ['GROKBOT_REVIEW_WEBHOOK_URL', 'GROKBOT_REVIEW_WEBHOOK_KEY', 'GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER', 'LINE_TEST_MODE'];
afterEach(() => { for (const k of env) delete process.env[k]; jest.restoreAllMocks(); });

async function setup(typeKey = 'customer_reply') {
  const store = new Map();
  const items = new MockReviewItemRepository(new Map());
  const outbox = new MockReviewOutboxRepository(store);
  const accounts = new MockLineAccountRepository(new Map(), new Map());
  const item = await items.create({ typeKey, shopUserId: 'shop', title: 't', payload: {}, signals: {},
    decisionMode: 'review', matchedRules: [], dueAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  const client = { push: jest.fn(async () => {}), reply: jest.fn() };
  const deps = { outbox, items, accounts, client, execute: jest.fn(async () => {}) };
  return { deps, outbox, items, accounts, item, store, client };
}
const configure = () => { process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid/hook'; process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture'; };

describe('notifier events (review.created / handoff.escalate / takeover_on)', () => {
  it.each(['customer_reply', 'script', 'complaint'])('%s review.created stays queued (not sent) while the notifier is unconfigured', async (typeKey) => {
    const { deps, outbox, store, item } = await setup(typeKey);
    const fetch = jest.spyOn(global, 'fetch');
    const ev = await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    await processLineReviewOutbox(deps as never);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get(ev.id)).toMatchObject({ state: 'queued', sentAt: null });
  });

  it('handoff.escalate and takeover_on stay queued while unconfigured', async () => {
    const { deps, outbox, store, item } = await setup();
    const a = await outbox.enqueue({ eventType: 'handoff.escalate', reviewItemId: item.id, payload: {} });
    const b = await outbox.enqueue({ eventType: 'takeover_on', payload: {} });
    await processLineReviewOutbox(deps as never);
    await processLineReviewOutbox(deps as never);
    expect(store.get(a.id).state).toBe('queued');
    expect(store.get(b.id).state).toBe('queued');
  });

  it('the queued escalation is delivered once the notifier is configured', async () => {
    const { deps, outbox, store, item } = await setup();
    const ev = await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    await processLineReviewOutbox(deps as never);
    configure();
    store.set(ev.id, { ...store.get(ev.id), nextAttemptAt: new Date(0) });
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await processLineReviewOutbox(deps as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get(ev.id).state).toBe('sent');
  });

  it('a non-2xx webhook answer is failed, not sent', async () => {
    configure();
    const { deps, outbox, store, item } = await setup();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('no', { status: 500 }));
    const ev = await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    await processLineReviewOutbox(deps as never);
    expect(store.get(ev.id)).toMatchObject({ state: 'failed', lastError: 'delivery_failed' });
  });
});

describe('LINE pushes (review.decided / line.delivery)', () => {
  async function decidedManualReply(d: Awaited<ReturnType<typeof setup>>) {
    await d.items.update(d.item.id, { status: 'edited', resolution: 'manual_reply', decidedVia: 'grokbot_app',
      finalPayload: { reply_text: 'hello' } } as never);
    return d.outbox.enqueue({ eventType: 'review.decided', reviewItemId: d.item.id,
      payload: { decision: 'manual_reply', reply_text: 'hello' } });
  }

  it('a reply with no in-scope active LINE account is dead with no_recipient, never sent', async () => {
    const d = await setup();
    // Account exists but is out of scope (is_test in a production process).
    await d.accounts.create({ userId: 'shop', lineChannelId: 'default', lineUserId: 'U1', displayName: null,
      linkedVia: 'admin', status: 'active', isTest: true });
    const ev = await decidedManualReply(d);
    await processLineReviewOutbox(d.deps as never);
    expect(d.client.push).not.toHaveBeenCalled();
    expect(d.store.get(ev.id)).toMatchObject({ state: 'dead', lastError: 'no_recipient', sentAt: null });
  });

  it('a decided event whose item is missing is dead, not sent', async () => {
    const d = await setup();
    const ev = await d.outbox.enqueue({ eventType: 'review.decided', reviewItemId: 'missing', payload: {} });
    await processLineReviewOutbox(d.deps as never);
    expect(d.store.get(ev.id)).toMatchObject({ state: 'dead', lastError: 'no_recipient' });
  });

  it('a delivered reply is sent; each recipient gets its own retry key', async () => {
    const d = await setup();
    const a1 = await d.accounts.create({ userId: 'shop', lineChannelId: 'default', lineUserId: 'U1', displayName: null, linkedVia: 'admin', status: 'active', isTest: false });
    const a2 = await d.accounts.create({ userId: 'shop', lineChannelId: 'other', lineUserId: 'U2', displayName: null, linkedVia: 'admin', status: 'active', isTest: false });
    const ev = await decidedManualReply(d);
    await processLineReviewOutbox(d.deps as never);
    expect(d.client.push).toHaveBeenCalledTimes(2);
    const keys = (d.client.push.mock.calls as unknown as [string, unknown, string][]).map(c => c[2]);
    expect(keys[0]).toBe(ev.eventId);
    expect(keys[1]).toBe(recipientRetryKey(ev.eventId, a2.id, 1));
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a1.id).not.toBe(a2.id);
    expect(d.store.get(ev.id).state).toBe('sent');
  });

  it('line.delivery with no recipient is dead, not sent', async () => {
    const d = await setup();
    const ev = await d.outbox.enqueue({ eventType: 'line.delivery', payload: { user_id: 'nobody', storage_key: 'k' } });
    await processLineReviewOutbox(d.deps as never);
    expect(d.client.push).not.toHaveBeenCalled();
    expect(d.store.get(ev.id)).toMatchObject({ state: 'dead', lastError: 'no_recipient' });
  });
});

it('recipientRetryKey is stable and distinct per account', () => {
  const e = '0f8fad5b-d9cb-469f-a165-70867728950e';
  expect(recipientRetryKey(e, 'a', 0)).toBe(e);
  expect(recipientRetryKey(e, 'b', 1)).toBe(recipientRetryKey(e, 'b', 1));
  expect(recipientRetryKey(e, 'b', 1)).not.toBe(recipientRetryKey(e, 'c', 2));
});
