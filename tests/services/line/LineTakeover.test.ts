/**
 * LineTakeover.test.ts
 *
 * Covers the per-shop human-takeover flag (Item 12):
 *  1. Webhook returns intent='takeover' when takeoverActive=true and not expired
 *  2. Webhook processes normally when takeoverActive=false
 *  3. Webhook processes normally when takeover is expired (auto-clears lazily)
 *  4. setTakeover correctly sets active + expiresAt in the mock repo
 */
import { processLineEvent, LineWebhookEvent } from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockLineClient } from '@/lib/line/MockLineClient';

const CHANNEL = 'ch-takeover';
const LINE_USER = 'U-takeover';

async function makeRepoWithTakeover(active: boolean, expiresAt: Date | null) {
  const repo = new MockLineAccountRepository(new Map());
  const account = await repo.create({
    userId: 'user-1',
    lineUserId: LINE_USER,
    lineChannelId: CHANNEL,
    displayName: null,
    linkedVia: 'auto_created',
    status: 'active',
  });
  await repo.setTakeover(account.id, active, expiresAt);
  return repo;
}

function makeTextEvent(text = 'สวัสดี'): LineWebhookEvent {
  return {
    type: 'message',
    message: { type: 'text', text },
    replyToken: 'rt-1',
    source: { userId: LINE_USER },
  };
}

test('returns takeover intent when takeoverActive=true and not expired', async () => {
  const future = new Date(Date.now() + 3600000);
  const repo = await makeRepoWithTakeover(true, future);
  const lineClient = new MockLineClient();
  const result = await processLineEvent(makeTextEvent(), {
    lineChannelId: CHANNEL,
    lineClient,
    lineAccountRepo: repo,
  });
  expect(result.intent).toBe('takeover');
  expect(result.escalated).toBe(false);
  expect(lineClient.sent).toHaveLength(0);
});

test('processes normally when takeoverActive=false', async () => {
  const repo = await makeRepoWithTakeover(false, null);
  const lineClient = new MockLineClient();
  const result = await processLineEvent(makeTextEvent(), {
    lineChannelId: CHANNEL,
    lineClient,
    lineAccountRepo: repo,
  });
  expect(result.intent).not.toBe('takeover');
});

test('processes normally and clears lazily when takeover is expired', async () => {
  const past = new Date(Date.now() - 1000);
  const repo = await makeRepoWithTakeover(true, past);
  const lineClient = new MockLineClient();
  const result = await processLineEvent(makeTextEvent(), {
    lineChannelId: CHANNEL,
    lineClient,
    lineAccountRepo: repo,
  });
  // Should NOT be blocked — takeover expired
  expect(result.intent).not.toBe('takeover');
});

test('setTakeover sets active=true with future expiresAt', async () => {
  const repo = new MockLineAccountRepository(new Map());
  const account = await repo.create({
    userId: 'user-1',
    lineUserId: LINE_USER,
    lineChannelId: CHANNEL,
    displayName: null,
    linkedVia: 'auto_created',
    status: 'active',
  });
  const expiresAt = new Date(Date.now() + 86400000);
  await repo.setTakeover(account.id, true, expiresAt);
  const updated = await repo.findByLineUser(CHANNEL, LINE_USER);
  expect(updated?.takeoverActive).toBe(true);
  expect(updated?.takeoverExpiresAt?.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
});

test('setTakeover clears the flag with active=false and null expiresAt', async () => {
  const repo = await makeRepoWithTakeover(true, new Date(Date.now() + 3600000));
  const account = await repo.findByLineUser(CHANNEL, LINE_USER);
  await repo.setTakeover(account!.id, false, null);
  const updated = await repo.findByLineUser(CHANNEL, LINE_USER);
  expect(updated?.takeoverActive).toBe(false);
  expect(updated?.takeoverExpiresAt).toBeNull();
});
