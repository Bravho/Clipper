/**
 * GrokBotNotifier.test.ts
 *
 * Covers notifyGrokBot with mocked fetch and signedUrl injection.
 * No real network calls; GROKBOT_REVIEW_WEBHOOK_URL/KEY set in env for each test.
 */
import { notifyGrokBot, resolveGrokBotWebhookAuth, GrokBotPayload } from '@/services/review/GrokBotNotifier';
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
  delete process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER;
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
  // Never throws without throwOnFailure, and reports that nothing was delivered.
  await expect(notifyGrokBot(BASE_ITEM, opts)).resolves.toBe(false);
});

test('does not throw when postFn throws a network error', async () => {
  const opts = {
    signedUrl: jest.fn(async () => ''),
    postFn: jest.fn(async () => { throw new Error('ECONNREFUSED'); }),
  };
  // Never throws without throwOnFailure, and reports that nothing was delivered.
  await expect(notifyGrokBot(BASE_ITEM, opts)).resolves.toBe(false);
});

test('uses correct Thai summary for different typeKeys', async () => {
  const cases: [string, string][] = [
    ['script', 'สคริปต์รอตรวจ'],
    ['tts', 'เสียงพากย์รอตรวจ'],
    ['video', 'วิดีโอรอตรวจ'],
    ['customer_reply', 'ลูกค้าส่งข้อความที่ระบบตอบไม่ได้ — รอทีมงาน/RCaveBot ตอบ'],
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

test('sends Authorization: Bearer <key> alongside the HMAC headers', async () => {
  const captured: { body?: GrokBotPayload; headers?: Record<string, string> } = {};
  await notifyGrokBot(BASE_ITEM, makeOpts(captured));
  expect(captured.headers?.Authorization).toBe('Bearer test-secret-key');
  expect(captured.headers?.['X-Grokbot-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  expect(captured.headers?.['X-Grokbot-Timestamp']).toMatch(/^\d+$/);
});

test('never logs the key, the Authorization header or the URL on failure', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://hooks.example.com/trigger/secret-path-token';
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const postFn = jest.fn(async (url: string, _b: string, headers: Record<string, string>) => {
    throw new Error(`boom ${url} ${headers.Authorization} test-secret-key`);
  });
  await notifyGrokBot(BASE_ITEM, { signedUrl: async () => '', postFn });
  const logged = spy.mock.calls.flat().map(String).join(' ');
  expect(logged).not.toContain('test-secret-key');
  expect(logged).not.toContain('secret-path-token');
  expect(logged).toContain('[REDACTED]');
  spy.mockRestore();
});

test('rethrows a redacted error when throwOnFailure is set', async () => {
  const postFn = jest.fn(async (_u: string, _b: string, h: Record<string, string>) => { throw new Error(`x ${h.Authorization}`); });
  await expect(notifyGrokBot(BASE_ITEM, { signedUrl: async () => '', postFn, throwOnFailure: true }))
    .rejects.toThrow(/Bearer \[REDACTED\]/);
});

test('skips when the key is unset', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
});

// ---- GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER tests ----

test('auth header sent verbatim (no Bearer prefix) when GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER is set', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Token my-custom-token';
  const captured: { headers?: Record<string, string> } = {};
  const opts = makeOpts(captured);
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).toHaveBeenCalledTimes(1);
  expect(captured.headers?.Authorization).toBe('Token my-custom-token');
  // KEY is still set so HMAC headers must be present
  expect(captured.headers?.['X-Grokbot-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  expect(captured.headers?.['X-Grokbot-Timestamp']).toMatch(/^\d+$/);
});

test('auth header value with leading/trailing whitespace is trimmed', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = '  Token trimmed  ';
  const captured: { headers?: Record<string, string> } = {};
  await notifyGrokBot(BASE_ITEM, makeOpts(captured));
  expect(captured.headers?.Authorization).toBe('Token trimmed');
});

test('whitespace-only auth header falls back to Bearer KEY', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = '   ';
  const captured: { headers?: Record<string, string> } = {};
  await notifyGrokBot(BASE_ITEM, makeOpts(captured));
  expect(captured.headers?.Authorization).toBe('Bearer test-secret-key');
});

test('auth header only (no KEY) is configured and sends without HMAC headers', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Bearer standalone-auth-token';
  const captured: { headers?: Record<string, string> } = {};
  const opts = makeOpts(captured);
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).toHaveBeenCalledTimes(1);
  expect(captured.headers?.Authorization).toBe('Bearer standalone-auth-token');
  expect(captured.headers?.['X-Grokbot-Signature']).toBeUndefined();
});

test('neither auth header nor key set -> no-op even when URL is set', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  // AUTH_HEADER already deleted in afterEach; ensure it's absent
  delete process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER;
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
});

test('resolveGrokBotWebhookAuth reports configured=true with auth header only', () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Token abc';
  const result = resolveGrokBotWebhookAuth();
  expect(result.configured).toBe(true);
  expect(result.authHeaderValue).toBe('Token abc');
  expect(result.key).toBeUndefined();
});

test('resolveGrokBotWebhookAuth reports configured=false when neither auth header nor key', () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  delete process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER;
  expect(resolveGrokBotWebhookAuth().configured).toBe(false);
});

test('auth header value is redacted from error logs', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Token secret-auth-value';
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const postFn = jest.fn(async (_url: string, _b: string, headers: Record<string, string>) => {
    throw new Error(`failed with ${headers.Authorization} and token secret-auth-value`);
  });
  await notifyGrokBot(BASE_ITEM, { signedUrl: async () => '', postFn });
  const logged = spy.mock.calls.flat().map(String).join(' ');
  expect(logged).not.toContain('secret-auth-value');
  expect(logged).toContain('[REDACTED]');
  spy.mockRestore();
});

test('auth header token part (after scheme) is also redacted', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Token only-the-token-part';
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const postFn = jest.fn(async () => { throw new Error('error: only-the-token-part'); });
  await notifyGrokBot(BASE_ITEM, { signedUrl: async () => '', postFn });
  const logged = spy.mock.calls.flat().map(String).join(' ');
  expect(logged).not.toContain('only-the-token-part');
  spy.mockRestore();
});

// ---- Authorization: label stripping tests ----

test('"Authorization: Bearer x" strips label -> Authorization header "Bearer x"', () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Authorization: Bearer x';
  const result = resolveGrokBotWebhookAuth();
  expect(result.authHeaderValue).toBe('Bearer x');
  expect(result.rawAuthHeader).toBe('Bearer x');
});

test('"authorization:Bearer x" (no space, lowercase) strips label -> "Bearer x"', () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'authorization:Bearer x';
  const result = resolveGrokBotWebhookAuth();
  expect(result.authHeaderValue).toBe('Bearer x');
});

test('plain "Bearer x" (no label) is passed through unchanged', () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Bearer x';
  const result = resolveGrokBotWebhookAuth();
  expect(result.authHeaderValue).toBe('Bearer x');
});

test('bare "Authorization:" with KEY set -> falls back to Bearer <KEY>, configured=true', () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Authorization:';
  const result = resolveGrokBotWebhookAuth();
  expect(result.rawAuthHeader).toBe('');
  expect(result.authHeaderValue).toBe('Bearer test-secret-key');
  expect(result.configured).toBe(true);
});

test('"  authorization :  " (padded) with KEY set -> falls back to Bearer <KEY>', () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = '  authorization :  ';
  const result = resolveGrokBotWebhookAuth();
  expect(result.rawAuthHeader).toBe('');
  expect(result.authHeaderValue).toBe('Bearer test-secret-key');
});

test('bare "Authorization:" with KEY unset -> not configured, no-op', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Authorization:';
  const result = resolveGrokBotWebhookAuth();
  expect(result.configured).toBe(false);
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
});

test('"  authorization :  " with KEY unset -> not configured, no-op', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = '  authorization :  ';
  const opts = makeOpts();
  await notifyGrokBot(BASE_ITEM, opts);
  expect(opts.postFn).not.toHaveBeenCalled();
});

test('original full env value (with label) is also redacted from errors', async () => {
  process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER = 'Authorization: Bearer secret-label-token';
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const postFn = jest.fn(async () => { throw new Error('Authorization: Bearer secret-label-token leaked'); });
  await notifyGrokBot(BASE_ITEM, { signedUrl: async () => '', postFn });
  const logged = spy.mock.calls.flat().map(String).join(' ');
  expect(logged).not.toContain('secret-label-token');
  spy.mockRestore();
});
test('reports false (not delivered) when unconfigured, true only on a 2xx', async () => {
  delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  const postFn = jest.fn(async () => ({ ok: true, status: 200 }));
  await expect(notifyGrokBot(BASE_ITEM, { signedUrl: jest.fn(), postFn, throwOnFailure: true })).resolves.toBe(false);
  expect(postFn).not.toHaveBeenCalled();
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid/hook';
  process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'k';
  await expect(notifyGrokBot(BASE_ITEM, { signedUrl: jest.fn(async () => 'u'), postFn })).resolves.toBe(true);
});
