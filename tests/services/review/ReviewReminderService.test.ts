/**
 * ReviewReminderService.test.ts
 *
 * Tests for runReviewReminders:
 *  1. Sends Grok Bot notification for each due item
 *  2. Bumps nextReminderAt by REVIEW_REMINDER_HOURS after sending
 *  3. Increments reminderCount after each notification
 *  4. Skips items not yet due (nextReminderAt > now)
 *  5. Counts errors without re-throwing when notifyGrokBot fails
 *  6. Respects custom REVIEW_REMINDER_HOURS env var
 */
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { runReviewReminders } from '@/services/review/ReviewReminderService';

const WEBHOOK_URL = 'https://grokbot.example.com/webhook';
const WEBHOOK_KEY = 'test-key';

function makeOpts(postFn = jest.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))) {
  return {
    signedUrl: jest.fn(async () => ''),
    postFn,
  };
}

function makeRepo() {
  return new MockReviewItemRepository(new Map());
}

async function seedItem(
  repo: MockReviewItemRepository,
  nextReminderAt: Date | null,
  reminderCount = 0,
) {
  const item = await repo.create({
    typeKey: 'video',
    shopUserId: 'shop-u',
    title: 'Test item',
    payload: {},
    signals: {},
    decisionMode: 'review',
    matchedRules: [],
    dueAt: new Date(Date.now() + 3600000),
    expiresAt: new Date(Date.now() + 86400000),
  });
  await repo.update(item.id, { nextReminderAt, reminderCount });
  return item;
}

beforeEach(() => {
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = WEBHOOK_URL;
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = WEBHOOK_KEY;
  delete process.env.REVIEW_REMINDER_HOURS;
});

afterEach(() => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  delete process.env.REVIEW_REMINDER_HOURS;
});

test('sends Grok Bot notification for each due item', async () => {
  const repo = makeRepo();
  const past = new Date(Date.now() - 1000);
  await seedItem(repo, past);
  await seedItem(repo, past);
  const postFn = jest.fn(async () => ({ ok: true, status: 200 }));
  const { reminded, errors } = await runReviewReminders(repo, makeOpts(postFn));
  expect(reminded).toBe(2);
  expect(errors).toBe(0);
  expect(postFn).toHaveBeenCalledTimes(2);
});

test('does not notify items not yet due', async () => {
  const repo = makeRepo();
  const future = new Date(Date.now() + 3600000);
  await seedItem(repo, future);
  const postFn = jest.fn(async () => ({ ok: true, status: 200 }));
  const { reminded } = await runReviewReminders(repo, makeOpts(postFn));
  expect(reminded).toBe(0);
  expect(postFn).not.toHaveBeenCalled();
});

test('does not notify items with null nextReminderAt', async () => {
  const repo = makeRepo();
  await seedItem(repo, null);
  const postFn = jest.fn(async () => ({ ok: true, status: 200 }));
  const { reminded } = await runReviewReminders(repo, makeOpts(postFn));
  expect(reminded).toBe(0);
});

test('records a reminder once and never reschedules', async () => {
  const repo = makeRepo();
  const past = new Date(Date.now() - 1000);
  const item = await seedItem(repo, past, 0);
  const before = Date.now();
  await runReviewReminders(repo, makeOpts());
  const after = await repo.findById(item.id);
  expect(after!.nextReminderAt).toBeNull();
  expect(after!.reminderSentAt!.getTime()).toBeGreaterThanOrEqual(before);
  expect((await runReviewReminders(repo, makeOpts())).reminded).toBe(0);
});

test('increments reminderCount after each notification', async () => {
  const repo = makeRepo();
  const past = new Date(Date.now() - 1000);
  const item = await seedItem(repo, past, 2);
  await runReviewReminders(repo, makeOpts());
  const updated = await repo.findById(item.id);
  expect(updated!.reminderCount).toBe(3);
});

test('counts errors without throwing when repo.update fails', async () => {
  const repo = makeRepo();
  const past = new Date(Date.now() - 1000);
  await seedItem(repo, past);
  // Simulate repo.update throwing (e.g. DB down)
  jest.spyOn(repo, 'claimReminder').mockRejectedValueOnce(new Error('db_error'));
  const { reminded, errors } = await runReviewReminders(repo, makeOpts());
  expect(errors).toBe(1);
  expect(reminded).toBe(0);
});

test('normal created item with no next reminder becomes due at configured age', async () => {
  jest.useFakeTimers();
  process.env.REVIEW_REMINDER_HOURS = '6';
  const repo = makeRepo();
  await seedItem(repo, null);
  const post = jest.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }));
  const opts = makeOpts(post);
  jest.setSystemTime(Date.now() + 6 * 3600000 + 1);
  expect((await runReviewReminders(repo, opts)).reminded).toBe(1);
  expect(JSON.parse(post.mock.calls[0][1] as string).event).toBe('reminder');
  expect((await runReviewReminders(repo, opts)).reminded).toBe(0);
  jest.useRealTimers();
});


test('overlapping reminder jobs send once for a normal created item', async () => {
  jest.useFakeTimers();
  try {
    const repo = makeRepo(); await seedItem(repo, null);
    jest.setSystemTime(Date.now() + 12 * 3600000 + 1);
    const opts = makeOpts();
    const runs = await Promise.all([runReviewReminders(repo, opts), runReviewReminders(repo, opts)]);
    expect(runs.reduce((sum, r) => sum + r.reminded, 0)).toBe(1);
    expect(opts.postFn).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
