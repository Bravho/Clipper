import { LineIntakeService } from '@/services/line/LineIntakeService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockUserRepository } from '@/repositories/mock/MockUserRepository';
import { MockServicePackageRepository } from '@/repositories/mock/MockServicePackageRepository';
import { MockClipRequestRepository } from '@/repositories/mock/MockClipRequestRepository';
import { MockUploadedAssetRepository } from '@/repositories/mock/MockUploadedAssetRepository';
import { processLineEvent } from '@/services/line/LineWebhookService';
import type { ProcessWebhookOptions } from '@/services/line/LineWebhookService';

const enqueue = jest.fn(async () => {});
jest.mock('@/repositories', () => ({ assetVisualAnalysisRepository: { enqueue: (...a: unknown[]) => enqueue(...a as []) } }));

const original = process.env;
beforeEach(() => {
  process.env = { ...original };
  delete process.env.PAYMENT_DISABLED;
  delete process.env.LINE_TEST_SHOP_ID;
});
afterEach(() => { process.env = { ...original }; });

function makeIntake() {
  const accounts = new MockLineAccountRepository(new Map());
  const users = new MockUserRepository(new Map());
  const packages = new MockServicePackageRepository();
  const requests = new MockClipRequestRepository(new Map());
  const assets = new MockUploadedAssetRepository(new Map());
  return new LineIntakeService('ch1', accounts, users, packages, requests, assets);
}

// ── Test-shop path (LINE_TEST_MODE=true) ──────────────────────────────────────

test('test shop: choosePackage returns null paymentUrl and activates order with is_test=true', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'true' };
  const intake = makeIntake();
  const result = await intake.choosePackage('test-user', 'trial');
  expect(result.paymentUrl).toBeNull();
  expect(result.orderId).toBeTruthy();
});

test('test shop: activated order has is_test=true and status=active', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'true' };
  const packages = new MockServicePackageRepository();
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const result = await intake.choosePackage('test-user', 'trial');
  const order = await packages.findOrderById(result.orderId);
  expect(order?.status).toBe('active');
  expect(order?.isTest).toBe(true);
  expect(order?.paidReference).toBe('payment_disabled');
});

test('test shop: isPaid returns true immediately after choosePackage', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'true' };
  const intake = makeIntake();
  const result = await intake.choosePackage('test-user', 'trial');
  const paid = await intake.isPaid(result.orderId, 'test-user');
  expect(paid).toBe(true);
});

// ── Real shop, PAYMENT_DISABLED unset ────────────────────────────────────────

test('real shop without flag: choosePackage returns Stripe payment URL', async () => {
  process.env.LINE_TEST_MODE = 'false';
  const intake = makeIntake();
  const result = await intake.choosePackage('real-user', 'trial');
  expect(result.paymentUrl).toBeTruthy();
  expect(result.paymentUrl).toMatch(/buy\.stripe\.com/);
  expect(result.paymentUrl).toContain(result.orderId);
});

test('exact test shop ID grants only the matching shop and inserts directly active', async () => {
  process.env.LINE_TEST_MODE = 'false';
  process.env.LINE_TEST_SHOP_ID = 'test-user';
  const packages = new MockServicePackageRepository(new Map(), new Map());
  const update = jest.spyOn(packages, 'updateOrderStatus');
  const usage = jest.spyOn(packages, 'recordUsage');
  const create = jest.spyOn(packages, 'createOrder');
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const testOrder = await intake.choosePackage('test-user', 'trial');
  expect(testOrder.paymentUrl).toBeNull();
  expect(await packages.findOrderById(testOrder.orderId)).toMatchObject({ status: 'active', isTest: true });
  expect(create.mock.calls[0][0]).toMatchObject({ activationReference: 'payment_disabled', isTest: true });
  expect((await packages.getBalance(testOrder.orderId)).clipsLeft).toBe(2);
  expect(update).not.toHaveBeenCalled();
  expect(usage).not.toHaveBeenCalled();
  const realOrder = await intake.choosePackage('other-user', 'trial');
  expect(realOrder.paymentUrl).toContain('buy.stripe.com');
  expect(await intake.isPaid(realOrder.orderId, 'other-user')).toBe(false);
});

test('global test mode refuses existing real accounts, even with payment disabled', async () => {
  process.env.LINE_TEST_MODE = 'true';
  process.env.PAYMENT_DISABLED = 'true';
  const accounts = new MockLineAccountRepository(new Map());
  await accounts.create({ userId: 'real', lineUserId: 'real-user', lineChannelId: 'ch1',
    displayName: null, linkedVia: 'auto_created', status: 'active', isTest: false });
  const packages = new MockServicePackageRepository(new Map(), new Map());
  const create = jest.spyOn(packages, 'createOrder');
  const intake = new LineIntakeService('ch1', accounts, new MockUserRepository(new Map()),
    packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  await expect(intake.choosePackage('real-user', 'trial')).rejects.toThrow('test_account_scope_mismatch');
  expect(create).not.toHaveBeenCalled();
});

test('concurrent bypass redelivery reuses one balance and preserves pending Stripe orders', async () => {
  process.env.LINE_TEST_MODE = 'false';
  const packages = new MockServicePackageRepository(new Map(), new Map());
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const pending = await intake.choosePackage('real-user', 'trial');
  const before = await packages.findOrderById(pending.orderId);
  process.env.PAYMENT_DISABLED = 'true';
  const update = jest.spyOn(packages, 'updateOrderStatus');
  const [a,b] = await Promise.all([intake.choosePackage('real-user', 'trial'), intake.choosePackage('real-user', 'starter')]);
  expect(a.orderId).toBe(b.orderId);
  expect(a.orderId).not.toBe(pending.orderId);
  expect(await packages.findOrderById(pending.orderId)).toEqual(before);
  expect(await intake.isPaid(a.orderId, 'real-user')).toBe(true);
  expect((await packages.getBalance(a.orderId)).clipsLeft).toBe(2);
  expect(update).not.toHaveBeenCalled();
});

test('real shop without flag: order status is pending_payment', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'false', PAYMENT_DISABLED: 'false' };
  const packages = new MockServicePackageRepository();
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const result = await intake.choosePackage('real-user', 'trial');
  const order = await packages.findOrderById(result.orderId);
  expect(order?.status).toBe('pending_payment');
  expect(order?.isTest).toBe(false);
});

// ── Real shop, PAYMENT_DISABLED=true ─────────────────────────────────────────

test('real shop with PAYMENT_DISABLED=true: paymentUrl is null and order is active', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'false', PAYMENT_DISABLED: 'true' };
  const packages = new MockServicePackageRepository();
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const result = await intake.choosePackage('real-user', 'trial');
  expect(result.paymentUrl).toBeNull();
  const order = await packages.findOrderById(result.orderId);
  expect(order?.status).toBe('active');
  expect(order?.isTest).toBe(false);
  expect(order?.paidReference).toBe('payment_disabled');
});

// ── Idempotency: retry does not grant twice ───────────────────────────────────

test('test shop: second choosePackage call reuses existing active order (no duplicate grant)', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'true' };
  const packages = new MockServicePackageRepository();
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const first = await intake.choosePackage('test-user', 'trial');
  const second = await intake.choosePackage('test-user', 'trial');
  expect(first.orderId).toBe(second.orderId);
  // Only one order in the system
  const orders = [...(packages as unknown as { orders: Map<string, unknown> })['orders'].values()];
  expect(orders).toHaveLength(1);
});

test('real shop PAYMENT_DISABLED=true: second call reuses same order', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'false', PAYMENT_DISABLED: 'true' };
  const packages = new MockServicePackageRepository();
  const intake = new LineIntakeService('ch1', new MockLineAccountRepository(new Map()),
    new MockUserRepository(new Map()), packages, new MockClipRequestRepository(new Map()), new MockUploadedAssetRepository(new Map()));
  const first = await intake.choosePackage('real-user', 'trial');
  const second = await intake.choosePackage('real-user', 'trial');
  expect(first.orderId).toBe(second.orderId);
});

// ── Webhook state machine: bypass routes to awaiting_brief ───────────────────

test('webhook: bypass path skips awaiting_payment, goes straight to awaiting_brief', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'false', PAYMENT_DISABLED: 'true' };
  const accounts = new MockLineAccountRepository(new Map());
  const replied: string[] = [];
  let savedState = '';
  const opts: ProcessWebhookOptions = {
    lineChannelId: 'ch1',
    lineClient: { reply: async (_tok: string, msgs: { type: string; text?: string }[]) => { replied.push(msgs[0]?.text ?? ''); } } as never,
    lineAccountRepo: {
      findByLineUser: async () => null,
      getConversationState: async () => ({ state: 'awaiting_package_choice', context: { intakeId: 'iid1' } }),
      upsertConversationState: async (_ch: string, _uid: string, state: string) => { savedState = state; },
      setTakeover: accounts.setTakeover.bind(accounts),
    } as never,
    choosePackage: async () => ({ orderId: 'ord-1', paymentUrl: null }),
  };
  const event = { type: 'message', webhookEventId: 'ev1', replyToken: 'tok1',
    message: { type: 'text', text: 'trial', id: 'm1' }, source: { userId: 'u1' } };
  const result = await processLineEvent(event, opts);
  expect(result.intent).toBe('choose_package:trial');
  expect(savedState).toBe('awaiting_brief');
  expect(replied[0]).toContain('เปิดใช้งานแล้ว');
});

test('webhook: non-bypass path still sets awaiting_payment and sends Stripe link', async () => {
  process.env = { ...original, LINE_TEST_MODE: 'false', PAYMENT_DISABLED: 'false' };
  const accounts = new MockLineAccountRepository(new Map());
  const replied: string[] = [];
  let savedState = '';
  const opts: ProcessWebhookOptions = {
    lineChannelId: 'ch1',
    lineClient: { reply: async (_tok: string, msgs: { type: string; text?: string }[]) => { replied.push(msgs[0]?.text ?? ''); } } as never,
    lineAccountRepo: {
      findByLineUser: async () => null,
      getConversationState: async () => ({ state: 'awaiting_package_choice', context: { intakeId: 'iid1' } }),
      upsertConversationState: async (_ch: string, _uid: string, state: string) => { savedState = state; },
      setTakeover: accounts.setTakeover.bind(accounts),
    } as never,
    choosePackage: async () => ({ orderId: 'ord-2', paymentUrl: 'https://buy.stripe.com/test/trial?client_reference_id=ord-2' }),
  };
  const event = { type: 'message', webhookEventId: 'ev2', replyToken: 'tok2',
    message: { type: 'text', text: 'trial', id: 'm2' }, source: { userId: 'u2' } };
  await processLineEvent(event, opts);
  expect(savedState).toBe('awaiting_payment');
  expect(replied[0]).toContain('buy.stripe.com');
});
