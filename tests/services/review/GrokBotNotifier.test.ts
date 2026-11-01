/**
 * GrokBotNotifier.test.ts
 *
 * Covers notifyGrokBot with mocked fetch and signedUrl injection.
 * No real network calls; GROKBOT_REVIEW_WEBHOOK_URL/KEY set in env for each test.
 */
import { notifyGrokBot, GrokBotPayload } from '@/services/review/GrokBotNotifier';
import type { ReviewItem } from '@/domain/models/ReviewItem';

const BASE_ITEM = {
  id: 'item-1',
  shortCode: 'ABC123',
  typeKey: 'video',
  status: 'pending',
  resolution: null,
  renderState: 'none',
  shopUserId: 'shop-u',
  requestId: 'req-1',
  jobId: null,
  gateStep: null,
  packageOrderId: 'order-1',
  externalRef: null,
  title: 'Video review',
  payload: { audience: 'admin' },
  originalPayload: null,
  assetRefs: [
    { role: 'preview', asset_id: 'asset-1', storage_key: 'line_reviews/asset-1', mime: 'video/mp4' },
  ],
  decisionMode: 'review',
  matchedRules: [],
  ruleSnapshot: null,
  signals: {},
  confidence: null,
  priority: 0,
  producer: {},
  version: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  dueAt: new Date('2026-01-02'),
  expiresAt: new Date('2026-01-10'),
} as unknown as ReviewItem;

function makeOpts(captured: { body?: GrokBotPayload; headers?: Record<string, string> } = {}) {
  const signedUrl = jest.fn(async (key: string) => `https://cdn.example.com/${key}?sig=xxx`);
  const postFn = jest.fn(async (_url: string, body: string, headers: Record<string, string>) => {
    captured.body = JSON.parse(body) as GrokBotPayload;
    captured.headers = headers;
    return { ok: true, status: 200 };
  });
  return { signedUrl, postFn };
}

beforeEach(() => {
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://grokbot.example.com/webhook';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'test-secret-key';
});

afterEach(() => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
});

test('sends POST with correct payload fields', async () => {
  const captured: { body?: GrokBotPayload; headers?: Record<string, string> } = {};
  const opts = makeOpts(captured);

  await notifyGrokBot(BASE_ITEM, opts);

  expect(opts.postFn).toHaveBeenCalledTimes(1);
  expect(captured.body?.event).toBe('review_needed');
  expect(captured.body?.itemId).toBe('item-1');
  expect(captured.body?.shortCode).toBe('ABC123');
  expect(captured.body?.typeKey).toBe('video');
  expect(captured.body?.audience).toBe('admin');
  expect(captured.body?.orderId).toBe('order-1');
  expect(captured.body?.summaryTh).toBe('วิดีโอรอตรวจ');
  expect(captured.body?.previewLinks).toHaveLength(1);
  expect(captured.body?.previewLinks[0].role).toBe('preview');
  expect(captured.body?.previewLinks[0].mime).toBe('video/mp4');
  expect(captured.body?.previewLinks[0].url).toContain('cdn.example.com');
});

test('signs the request with X-Grokbot-Signature and X-Grokbot-Timestamp headers', async () => {
  const captured: { body?: GrokBotPayload; headers?: Record<string, string> } = {};
  const opts = makeOpts(captured);

  await notifyGrokBot(BASE_ITEM, opts);

  expect(captured.headers?.['X-Grokbot-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  expect(captured.headers?.['X-Grokbot-Timestamp']).toMatch(/^\d+$/);
  expect(captured.headers?.['Content-Type']).toBe('application/json');
});

test('generates signed preview URLs for each assetRef', async () => {
  const itemWithRefs = {
    ...BASE_ITEM,
    assetRefs: [
      { role: 'preview', asset_id: 'a1', storage_key: 'line_reviews/a1', mime: 'video/mp4' },
      { role: 'voice', asset_id: 'a2', storage_key: 'line_reviews/a2', mime: 'audio/mpeg' },
    ],
  } as unknown as ReviewItem;
  const captured: { body?: GrokBotPayload } = {};
  const opts = makeOpts(captured);

  await notifyGrokBot(itemWithRefs, opts);

  expect(opts.signedUrl).toHaveBeenCalledTimes(2);
  expect(captured.body?.previewLinks).toHaveLength(2);
});

test('is a no-op when GROKBOT_REVIEW_WEBHOOK_URL is not set', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
  expect(opts.signedUrl).not.toHaveBeenCalled();
});

test('is a no-op when GROKBOT_REVIEW_WEBHOOK_KEY is not set', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
});

test('does not throw when postFn returns non-ok status', async () => {
  const opts = {
    signedUrl: jest.fn(async () => ''),
    postFn: jest.fn(async () => ({ ok: false, status: 503 })),
  };
  await expect(notifyGrokBot(BASE_ITEM, opts)).resolves.toBeUndefined();
});

test('does not throw when postFn throws a network error', async () => {
  const opts = {
    signedUrl: jest.fn(async () => ''),
    postFn: jest.fn(async () => { throw new Error('ECONNREFUSED'); }),
  };
  await expect(notifyGrokBot(BASE_ITEM, opts)).resolves.toBeUndefined();
});

test('uses correct Thai summary for different typeKeys', async () => {
  const cases: [string, string][] = [
    ['script', 'สคริปต์รอตรวจ'],
    ['tts', 'เสียงพากย์รอตรวจ'],
    ['video', 'วิดีโอรอตรวจ'],
    ['customer_reply', 'ลูกค้าต้องการคุยกับทีม'],
    ['complaint', 'ร้องเรียน — ด่วน'],
    ['out_of_package', 'แพ็กเกจหมด — รอดูแล'],
  ];

  for (const [typeKey, expectedSummary] of cases) {
    const captured: { body?: GrokBotPayload } = {};
    const opts = makeOpts(captured);
    await notifyGrokBot({ ...BASE_ITEM, typeKey } as unknown as ReviewItem, opts);
    expect(captured.body?.summaryTh).toBe(expectedSummary);
  }
});
