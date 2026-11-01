/**
 * LineIntakeCarryOver.test.ts
 *
 * Covers Item 2: Package carry-over — reuse active paid balance when a LINE user
 * triggers "start_job" and already has an active order with clips remaining.
 *
 * Tests:
 *  1. findActiveOrderWithBalance returns null when no active order exists
 *  2. findActiveOrderWithBalance returns null when active order has 0 clips left
 *  3. findActiveOrderWithBalance returns { orderId, clipsLeft } when balance exists
 *  4. start_job with active balance → state = awaiting_brief, intent = start_job_carry_over
 *  5. start_job without active balance → state = awaiting_package_choice (original flow)
 */
import { LineIntakeService } from '@/services/line/LineIntakeService';
import { processLineEvent, LineWebhookEvent } from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockUserRepository } from '@/repositories/mock/MockUserRepository';
import { MockServicePackageRepository } from '@/repositories/mock/MockServicePackageRepository';
import { MockClipRequestRepository } from '@/repositories/mock/MockClipRequestRepository';
import { MockUploadedAssetRepository } from '@/repositories/mock/MockUploadedAssetRepository';
import { MockLineClient } from '@/lib/line/MockLineClient';

const CHANNEL = 'ch-test';
const LINE_USER = 'U-carry-test';

function makeRepos() {
  return {
    accountRepo: new MockLineAccountRepository(new Map()),
    userRepo: new MockUserRepository(new Map()),
    pkgRepo: new MockServicePackageRepository(new Map(), new Map()),
    requestRepo: new MockClipRequestRepository(new Map()),
    assetRepo: new MockUploadedAssetRepository(new Map()),
  };
}

function makeIntake(repos: ReturnType<typeof makeRepos>) {
  return new LineIntakeService(
    CHANNEL,
    repos.accountRepo,
    repos.userRepo,
    repos.pkgRepo,
    repos.requestRepo,
    repos.assetRepo,
  );
}

async function seedActiveOrder(repos: ReturnType<typeof makeRepos>, clipsUsed = 0) {
  const intake = makeIntake(repos);
  const account = await intake.ensureAccount(LINE_USER);
  const order = await repos.pkgRepo.createOrder({
    userId: account.userId,
    packageCode: 'starter',
    clipsIncluded: 8,
    revisionsPerClip: 2,
    priceBaht: 1490,
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });
  // Mark it active
  await repos.pkgRepo.updateOrderStatus(order.id, 'active');
  // Record clip usage to simulate consumed clips
  for (let i = 0; i < clipsUsed; i++) {
    await repos.pkgRepo.recordUsage({ packageOrderId: order.id, requestId: `req-dummy-${i}`, kind: 'clip' });
  }
  return { account, order: { ...order, status: 'active' as const } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. No active order → returns null
// ─────────────────────────────────────────────────────────────────────────────
test('findActiveOrderWithBalance returns null when user has no active order', async () => {
  const repos = makeRepos();
  const intake = makeIntake(repos);
  // Ensure the account exists but has no order at all
  await intake.ensureAccount(LINE_USER);
  const result = await intake.findActiveOrderWithBalance(LINE_USER);
  expect(result).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Active order but balance exhausted → returns null
// ─────────────────────────────────────────────────────────────────────────────
test('findActiveOrderWithBalance returns null when all clips are used', async () => {
  const repos = makeRepos();
  await seedActiveOrder(repos, 8); // all 8 clips consumed
  const intake = makeIntake(repos);
  const result = await intake.findActiveOrderWithBalance(LINE_USER);
  expect(result).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Active order with remaining clips → returns { orderId, clipsLeft }
// ─────────────────────────────────────────────────────────────────────────────
test('findActiveOrderWithBalance returns orderId and clipsLeft when balance exists', async () => {
  const repos = makeRepos();
  const { order } = await seedActiveOrder(repos, 3); // 5 clips left
  const intake = makeIntake(repos);
  const result = await intake.findActiveOrderWithBalance(LINE_USER);
  expect(result).not.toBeNull();
  expect(result!.orderId).toBe(order.id);
  expect(result!.clipsLeft).toBe(5);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. start_job with active balance → state = awaiting_brief, carry-over intent
// ─────────────────────────────────────────────────────────────────────────────
test('start_job with active balance skips to awaiting_brief and returns start_job_carry_over', async () => {
  const repos = makeRepos();
  const { order } = await seedActiveOrder(repos, 2); // 6 clips left
  const lineClient = new MockLineClient();
  const intake = makeIntake(repos);

  const event: LineWebhookEvent = {
    type: 'message',
    message: { type: 'text', text: 'เริ่มงาน' },
    replyToken: 'rt-carryover',
    source: { userId: LINE_USER },
  };

  const result = await processLineEvent(event, {
    lineChannelId: CHANNEL,
    lineClient,
    lineAccountRepo: repos.accountRepo,
    findActiveBalance: (userId) => intake.findActiveOrderWithBalance(userId),
  });

  expect(result.escalated).toBe(false);
  expect(result.intent).toBe('start_job_carry_over');

  // State should be awaiting_brief with the existing orderId preserved
  const state = await repos.accountRepo.getConversationState(CHANNEL, LINE_USER);
  expect(state?.state).toBe('awaiting_brief');
  expect(state?.context?.orderId).toBe(order.id);

  // Should have sent a reply mentioning remaining clips
  const replies = lineClient.sent.filter(s => s.kind === 'reply');
  expect(replies).toHaveLength(1);
  expect((replies[0].messages[0] as { type: string; text: string }).text).toContain('6');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. start_job without active balance → original awaiting_package_choice flow
// ─────────────────────────────────────────────────────────────────────────────
test('start_job without active balance proceeds to awaiting_package_choice', async () => {
  const repos = makeRepos();
  // Do NOT seed any order — no balance
  const lineClient = new MockLineClient();
  const intake = makeIntake(repos);

  const event: LineWebhookEvent = {
    type: 'message',
    message: { type: 'text', text: 'เริ่มงาน' },
    replyToken: 'rt-nocarry',
    source: { userId: LINE_USER },
  };

  const result = await processLineEvent(event, {
    lineChannelId: CHANNEL,
    lineClient,
    lineAccountRepo: repos.accountRepo,
    findActiveBalance: (userId) => intake.findActiveOrderWithBalance(userId),
  });

  expect(result.escalated).toBe(false);
  expect(result.intent).toBe('start_job');

  // State should be awaiting_package_choice (original flow)
  const state = await repos.accountRepo.getConversationState(CHANNEL, LINE_USER);
  expect(state?.state).toBe('awaiting_package_choice');

  // Should have sent a package selection reply
  const replies = lineClient.sent.filter(s => s.kind === 'reply');
  expect(replies).toHaveLength(1);
});


test('repeated package selection reuses pending unpaid order', async () => {
  const repos = makeRepos(); const intake = makeIntake(repos);
  const first = await intake.choosePackage(LINE_USER, 'starter');
  const second = await intake.choosePackage(LINE_USER, 'starter');
  expect(second).toEqual(first);
});

test('oldest paid balance is consumed before newer paid orders, with no stranded balance', async () => {
  const repos = makeRepos(); const intake = makeIntake(repos);
  const { account, order } = await seedActiveOrder(repos, 7);
  const newer = await repos.pkgRepo.createOrder({ userId: account.userId, packageCode: 'trial',
    clipsIncluded: 2, revisionsPerClip: 2, priceBaht: 299, expiresAt: new Date(Date.now()+86400000) });
  await repos.pkgRepo.updateOrderStatus(newer.id, 'active');
  expect((await intake.findActiveOrderWithBalance(LINE_USER))?.orderId).toBe(order.id);
  await repos.pkgRepo.recordUsage({ packageOrderId: order.id, requestId: 'last-old', kind: 'clip' });
  expect((await intake.findActiveOrderWithBalance(LINE_USER))?.orderId).toBe(newer.id);
});

test('retry after final usage commits resumes same draft and does not consume again', async () => {
  const repos = makeRepos(); const intake = makeIntake(repos);
  const { order } = await seedActiveOrder(repos, 7);
  const context = { orderId: order.id, intakeId: 'redelivery', files: ['private/image.jpg'] };
  jest.spyOn(repos.requestRepo, 'updateStatus').mockRejectedValueOnce(new Error('status interrupted'));
  await expect(intake.submit(LINE_USER, context)).rejects.toThrow('status interrupted');
  expect((await repos.pkgRepo.getBalance(order.id)).clipsLeft).toBe(0);
  const resumed = await intake.submit(LINE_USER, context);
  expect((await intake.submit(LINE_USER, context)).requestId).toBe(resumed.requestId);
  expect((await repos.pkgRepo.getBalance(order.id)).clipsUsed).toBe(8);
});


test('test mode refuses production account reuse and ignores production order balances', async () => {
  const repos = makeRepos(); const intake = makeIntake(repos);
  const { account } = await seedActiveOrder(repos);
  process.env.LINE_TEST_MODE = 'true';
  try {
    await expect(intake.ensureAccount(LINE_USER)).rejects.toThrow('test_account_scope_mismatch');
    expect(await repos.pkgRepo.findActiveOrderByUser(account.userId)).toBeNull();
  } finally { delete process.env.LINE_TEST_MODE; }
});
