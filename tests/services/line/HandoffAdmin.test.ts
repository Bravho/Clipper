jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
jest.mock('@/repositories', () => ({
  lineAccountRepository: {}, reviewItemRepository: {}, reviewOutboxRepository: {},
  clipRequestRepository: { findById: jest.fn() }, videoGenerationJobRepository: { findById: jest.fn(), findByRequestId: jest.fn() },
  createReviewService: jest.fn(), withLineHandoffTransaction: jest.fn(),
}));
import { NextRequest } from 'next/server';
import * as repos from '@/repositories';
import { POST as reply } from '@/app/api/admin/line/reply/route';
import { GET } from '@/app/api/admin/line/handoff/[itemId]/route';
import { POST as escalate } from '@/app/api/admin/line/handoff/[itemId]/escalate/route';
import { POST as decision } from '@/app/api/admin/review/[id]/decision/route';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { ReviewService } from '@/services/review/ReviewService';
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';
import { notifyGrokBot } from '@/services/review/GrokBotNotifier';
import { LineClient } from '@/lib/line/LineClient';

const token = 'fixture-token';
function request(body: unknown, auth = token) {
  return new NextRequest('http://localhost/api/admin/line/reply', { method: 'POST',
    headers: { authorization: 'Bearer ' + auth }, body: JSON.stringify(body) });
}
async function setup(isTest = false) {
  (repos.clipRequestRepository.findById as jest.Mock).mockReset();
  (repos.videoGenerationJobRepository.findById as jest.Mock).mockReset();
  (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockReset();
  process.env.REVIEW_ADMIN_TOKEN = token;
  delete process.env.LINE_TEST_MODE;
  delete process.env.LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR;
  delete process.env.LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR;
  const accounts = new MockLineAccountRepository(new Map(), new Map());
  const items = new MockReviewItemRepository(new Map());
  const store = new Map();
  const outbox = new MockReviewOutboxRepository(store);
  const account = await accounts.create({ userId: 'shop', lineChannelId: 'default', lineUserId: 'PRIVATE_LINE_USER',
    displayName: null, linkedVia: 'admin', status: 'active', isTest });
  const item = await items.create({ typeKey: 'customer_reply', shopUserId: 'shop', title: 'private',
    payload: { lineUserId: account.lineUserId, text: 'PRIVATE_CUSTOMER_TEXT' }, signals: {}, decisionMode: 'review', matchedRules: [],
    dueAt: new Date(), expiresAt: new Date(Date.now()+86400000) });
  const service = new ReviewService(items, new MockReviewActionRepository(new Map()), new MockEscalationRuleRepository(new Map()), outbox);
  for (const [target, source] of [[repos.lineAccountRepository,accounts],[repos.reviewItemRepository,items],[repos.reviewOutboxRepository,outbox]]) {
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(source)))
      if (name !== 'constructor') (target as any)[name] = (source as any)[name].bind(source);
  }
  (repos.createReviewService as jest.Mock).mockReturnValue(service);
  (repos.withLineHandoffTransaction as jest.Mock).mockImplementation(work => work({
    lineAccountRepository: accounts, reviewItemRepository: items, reviewOutboxRepository: outbox, createReviewService: () => service }));
  const body = { itemId: item.id, expectedVersion: item.version, text: '  reply text  ', actor: 'rcavebot', idempotencyKey: 'fixture-key-1' };
  const client = { push: jest.fn(async () => {}), reply: jest.fn() };
  return { accounts, items, outbox, store, item, account, body, client, execute: jest.fn(), service };
}
afterEach(() => {
  for (const key of ['REVIEW_ADMIN_TOKEN','LINE_TEST_MODE','LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR','LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR',
    'LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN','GROKBOT_REVIEW_WEBHOOK_URL','GROKBOT_REVIEW_WEBHOOK_KEY']) delete process.env[key];
  jest.restoreAllMocks();
});

test('reply queues once, resolves once, and worker pushes once with UUID retry key', async () => {
  const d = await setup();
  const body = { ...d.body, resolve: true, expectedVersion: d.item.version };
  const first = await reply(request(body));
  expect(first.status).toBe(202);
  const result = await first.json();
  const second = await reply(request(body));
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ duplicate: true, outboxEventId: result.outboxEventId });
  expect(d.store.size).toBe(1);
  expect(await d.items.findById(d.item.id)).toMatchObject({ resolution: 'manual_reply', decidedVia: 'grokbot_app' });
  await processLineReviewOutbox(d); await processLineReviewOutbox(d);
  expect(d.client.push).toHaveBeenCalledTimes(1);
  expect(d.client.push).toHaveBeenCalledWith('PRIVATE_LINE_USER', [{ type: 'text', text: 'reply text' }], result.outboxEventId);
  expect(d.execute).not.toHaveBeenCalled();
});
test.each([
  { text: '' }, { text: 'x'.repeat(1001) }, { idempotencyKey: 'short' }, { idempotencyKey: 'bad key value' },
  { actor: 'bot' }, { itemId: undefined, conversationRef: undefined }, { itemId: 'bad-uuid' },
  { resolve: true, expectedVersion: undefined }, { allowDuringTakeover: 'yes' },
])('reply rejects invalid input %j', async patch => {
  const d = await setup();
  expect((await reply(request({ ...d.body, ...patch }))).status).toBe(400);
  expect(d.store.size).toBe(0);
});
test('bad JSON and auth', async () => {
  const d = await setup();
  expect((await reply(new NextRequest('http://localhost', { method: 'POST', headers: { authorization: 'Bearer '+token }, body: '{' }))).status).toBe(400);
  expect((await reply(request(d.body,'wrong'))).status).toBe(401);
  delete process.env.REVIEW_ADMIN_TOKEN;
  expect((await reply(request(d.body))).status).toBe(503);
});
test.each([false,true])('scope is enforced in both modes (test account=%s)', async isTest => {
  const d = await setup(isTest);
  if (!isTest) process.env.LINE_TEST_MODE = 'true';
  expect((await reply(request(d.body))).status).toBe(404);
  expect((await GET(request({}),{ params: { itemId: d.item.id } })).status).toBe(404);
  expect((await escalate(request({}),{ params: { itemId: d.item.id } })).status).toBe(404);
});
test('missing item and mismatching conversation', async () => {
  const d = await setup();
  expect((await reply(request({ ...d.body, itemId: crypto.randomUUID() }))).status).toBe(404);
  const other = await d.accounts.create({ userId: 'other', lineChannelId: 'default', lineUserId: 'other',
    displayName: null, linkedVia: 'admin', status: 'active' });
  const response = await reply(request({ ...d.body, conversationRef: other.id }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid_input', detail: 'conversationRef_mismatch' });
});
test.each([['rcavebot',false,409],['rcavebot',true,409],['human',false,409],['human',true,202]])(
  'takeover actor %s flag %s -> %s', async (actor,allow,status) => {
    const d = await setup();
    await d.accounts.setTakeover(d.account.id,true,new Date(Date.now()+60000));
    expect((await reply(request({ ...d.body, actor, allowDuringTakeover: allow }))).status).toBe(status);
});
test('expired takeover allows reply; proactive reply needs no item', async () => {
  const d = await setup();
  await d.accounts.setTakeover(d.account.id,true,new Date(Date.now()-1000));
  expect((await reply(request({ ...d.body, itemId: undefined, conversationRef: d.account.id }))).status).toBe(202);
});
test('resolve version conflict queues nothing', async () => {
  const d = await setup();
  const response = await reply(request({ ...d.body, resolve: true, expectedVersion: 50 }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'version_conflict' });
  expect(d.store.size).toBe(0);
});
test('a reply without resolution needs no version and duplicate stays duplicate after takeover', async () => {
  const d = await setup();
  const body = { ...d.body, expectedVersion: undefined };
  expect((await reply(request(body))).status).toBe(202);
  await d.accounts.setTakeover(d.account.id,true,null);
  expect((await reply(request(body))).status).toBe(200);
  expect(d.store.size).toBe(1);
});
test.each(['LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR','LINE_HANDOFF_REPLY_GLOBAL_PER_HOUR'])('quota %s returns retry time', async key => {
  const d = await setup(); process.env[key] = '1';
  await reply(request(d.body));
  const response = await reply(request({ ...d.body, idempotencyKey: 'fixture-key-2' }));
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(await response.json()).toEqual({ error: 'rate_limited' });
  expect(d.store.size).toBe(1);
});
test('handoff returns minimal context, ten messages, and never writes even on expired takeover', async () => {
  const d = await setup();
  for (let i=0;i<11;i++) await d.items.create({ typeKey: 'customer_reply', shopUserId: 'shop', title: 'message',
    payload: { lineUserId: d.account.lineUserId, text: 'message '+i }, signals: {}, decisionMode: 'review', matchedRules: [],
    dueAt: new Date(), expiresAt: new Date(Date.now()+86400000) });
  await d.accounts.upsertConversationState('default',d.account.lineUserId,'in_progress',{ requestId: null, files: ['secret'] });
  await d.accounts.setTakeover(d.account.id,true,new Date(Date.now()-1000));
  await reply(request(d.body));
  const writes = [jest.spyOn(repos.lineAccountRepository,'setTakeover'),jest.spyOn(repos.reviewItemRepository,'update'),
    jest.spyOn(repos.reviewOutboxRepository,'enqueue')];
  const response = await GET(request({}),{ params: { itemId: d.item.id } });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ itemId: d.item.id, version: 1, status: 'pending', typeKey: 'customer_reply',
    shortCode: d.item.shortCode, isTest: false, conversationRef: d.account.id, takeoverActive: false,
    customerText: 'PRIVATE_CUSTOMER_TEXT', conversation: { state: 'in_progress', requestId: null }, request: null, job: null });
  expect(result.messages).toHaveLength(10); expect(result.replies).toHaveLength(1);
  expect(result.replies[0]).toMatchObject({ text: 'reply text', actor: 'rcavebot', status: 'queued' });
  expect(result.conversation.files).toBeUndefined();
  writes.forEach(spy => expect(spy).not.toHaveBeenCalled());
});
test('escalation dedupes and notifier contains no text, LINE identity, links or signals', async () => {
  const d = await setup();
  const params = { params: { itemId: d.item.id } };
  expect(await (await escalate(request({ reason: 'PRIVATE_REASON' }),params)).json()).toEqual({ ok: true });
  expect(await (await escalate(request({ reason: 'different' }),params)).json()).toEqual({ ok: true, duplicate: true });
  expect((await d.items.findById(d.item.id))?.signals).toMatchObject({ wants_human: true, escalation_reason: 'PRIVATE_REASON' });
  expect(d.store.size).toBe(1);
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture';
  const fetch = jest.spyOn(global,'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
  await processLineReviewOutbox(d);
  const body = String((fetch.mock.calls[0][1] as RequestInit).body);
  for (const secret of ['PRIVATE_REASON','PRIVATE_CUSTOMER_TEXT','PRIVATE_LINE_USER']) expect(body).not.toContain(secret);
  expect(JSON.parse(body)).toEqual({ event: 'escalation', itemId: d.item.id, shortCode: d.item.shortCode,
    typeKey: 'customer_reply', requestId: null, orderId: null, previewLinks: [], notifiedAt: expect.any(String),
    summaryTh: 'ลูกค้าส่งข้อความที่ระบบตอบไม่ได้ — รอทีมงาน/RCaveBot ตอบ' });
  const post = jest.fn(async () => ({ ok: true, status: 200 }));
  await notifyGrokBot({ ...d.item, payload: { audience: 'PRIVATE_CUSTOMER_TEXT' },
    signals: { precheckIssues: ['PRIVATE_CUSTOMER_TEXT'] }, assetRefs: [{ role: 'preview', asset_id: 'x', storage_key: 'private', mime: 'private' }] },
    { event: 'escalation', signedUrl: jest.fn(), postFn: post });
  expect(post.mock.calls[0]).toBeDefined();
  expect(JSON.stringify(post.mock.calls)).not.toContain('PRIVATE_CUSTOMER_TEXT');
});
test('escalation rate limit defers webhook but retains item', async () => {
  const d = await setup(); process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN='1';
  process.env.GROKBOT_REVIEW_WEBHOOK_URL='https://example.invalid';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY='fixture';
  process.env.GROKBOT_REVIEW_WEBHOOK_URL='https://example.invalid';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY='fixture';
  await d.outbox.reserveHandoffNotification('shop');
  const delivered = await d.outbox.enqueue({ eventType: 'review.created', reviewItemId: d.item.id, payload: { shopUserId: 'shop' } });
  await d.outbox.markSent(delivered.id);
  const next = await d.outbox.enqueue({ eventType: 'review.created', reviewItemId: d.item.id, payload: {} });
  const fetch = jest.spyOn(global,'fetch');
  await processLineReviewOutbox(d);
  expect(fetch).not.toHaveBeenCalled();
  expect(d.store.get(next.id)).toMatchObject({ state: 'queued', attempts: 0 });
  expect(d.store.get(next.id).nextAttemptAt.getTime()).toBeGreaterThan(Date.now()+59000);
  expect(await d.items.findById(d.item.id)).not.toBeNull();
});
test.each([['rcavebot',false],['rcavebot',true],['human',false]])('delivery blocks takeover for %s/%s', async (actor,allow) => {
  const d = await setup();
  await reply(request({ ...d.body, actor, allowDuringTakeover: allow }));
  await d.accounts.setTakeover(d.account.id,true,null);
  await processLineReviewOutbox(d);
  expect(d.client.push).not.toHaveBeenCalled();
  expect([...d.store.values()][0]).toMatchObject({ state: 'dead', lastError: 'takeover_active' });
});
test.each([false,true])('manual decision during takeover flag=%s', async allow => {
  const d = await setup();
  await d.accounts.setTakeover(d.account.id,true,null);
  const response = await decision(request({ version: d.item.version, decision: 'manual_reply', replyText: 'human', allowDuringTakeover: allow }),{ params: { id: d.item.id } });
  expect(response.status).toBe(allow ? 200 : 409);
  if (allow) {
    expect([...d.store.values()][0].payload.allowDuringTakeover).toBe(true);
    await processLineReviewOutbox(d);
    expect(d.client.push).toHaveBeenCalledTimes(1);
  }
});
test('LINE client sends retry-key header and treats conflict as accepted retry', async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN='fixture';
  const fetch = jest.spyOn(global,'fetch').mockResolvedValue({ ok: false, status: 409 } as Response);
  const id=crypto.randomUUID();
  await new LineClient().push('private', [{ type: 'text', text: 'reply' }],id);
  expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-Line-Retry-Key': id });
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});


test('version is only checked when resolving', async () => {
  const d = await setup();
  const response = await reply(request({ ...d.body, resolve: false, expectedVersion: 99 }));
  expect(response.status).toBe(202);
  expect(d.store.size).toBe(1);
});

test('takeover does not create a second push for a duplicate bot request', async () => {
  const d = await setup();
  expect((await reply(request(d.body))).status).toBe(202);
  await d.accounts.setTakeover(d.account.id, true, null);
  const response = await reply(request(d.body));
  expect(response.status).toBe(200);
  expect((await response.json()).duplicate).toBe(true);
  expect(d.store.size).toBe(1);
});

test('takeover and reply quota are scoped to the addressed LINE account', async () => {
  const d = await setup();
  const other = await d.accounts.create({ userId: 'shop', lineChannelId: 'another-channel', lineUserId: 'another-line-id',
    displayName: null, linkedVia: 'admin', status: 'active' });
  await d.accounts.setTakeover(other.id, true, null);
  expect((await reply(request(d.body))).status).toBe(202);
  await d.accounts.setTakeover(other.id, false, null);
  process.env.LINE_HANDOFF_REPLY_PER_SHOP_PER_HOUR = '1';
  expect((await reply(request(d.body))).status).toBe(200);
  expect((await reply(request({ ...d.body, itemId: undefined, conversationRef: other.id, idempotencyKey: 'other-account-key' }))).status).toBe(202);
});

test('handoff fetch resolves the active conversation request and job using only status fields', async () => {
  const d = await setup();
  const id = crypto.randomUUID();
  await d.accounts.upsertConversationState('default', d.account.lineUserId, 'in_progress', { requestId: id });
  (repos.clipRequestRepository.findById as jest.Mock).mockResolvedValue({ id, userId: 'shop', isTest: false, status: 'Editing', private: 'secret' });
  (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockResolvedValue({ requestId: id, status: 'working', currentStep: 'analyzing_content', private: 'secret' });
  const response = await GET(request({}), { params: { itemId: d.item.id } });
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.request).toEqual({ id, status: 'Editing' });
  expect(result.job).toEqual({ status: 'working', currentStep: 'analyzing_content' });
  expect(JSON.stringify(result)).not.toContain('secret');
});

test.each([{ userId: 'other-shop', isTest: false }, { userId: 'shop', isTest: true }])('handoff fetch refuses out-of-scope request %j', async owner => {
  const d = await setup();
  const id = crypto.randomUUID();
  await d.accounts.upsertConversationState('default', d.account.lineUserId, 'in_progress', { requestId: id });
  (repos.clipRequestRepository.findById as jest.Mock).mockResolvedValue({ id, ...owner, status: 'Editing' });
  expect((await GET(request({}), { params: { itemId: d.item.id } })).status).toBe(404);
});
