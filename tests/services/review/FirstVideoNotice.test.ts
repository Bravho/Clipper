import { notifyGrokBot } from '@/services/review/GrokBotNotifier';
import { reviewPageUrl } from '@/services/review/lineReviewGate';

const BASE_ITEM = {
  id: 'item-first',
  shortCode: 'FV1',
  typeKey: 'video',
  requestId: 'req-1',
  packageOrderId: null,
  payload: { audience: 'revbot' },
  assetRefs: [],
  signals: {},
} as never;

describe('first_video notice', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://signal.example.invalid/hook';
    process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'test-key';
    delete process.env.REVIEW_PAGE_URL;
  });
  afterAll(() => { process.env = saved; });

  it('defaults the review link to the rclipper.com admin review page', () => {
    expect(reviewPageUrl()).toBe('https://rclipper.com/admin/review');
  });

  it('uses REVIEW_PAGE_URL when it is set', () => {
    process.env.REVIEW_PAGE_URL = '  https://example.invalid/review  ';
    expect(reviewPageUrl()).toBe('https://example.invalid/review');
  });

  it('sends event first_video with the review link and no customer text', async () => {
    let body = '';
    const postFn = jest.fn(async (_u: string, b: string) => { body = b; return { ok: true, status: 202 }; });
    const ok = await notifyGrokBot(BASE_ITEM, {
      event: 'first_video', reviewUrl: 'https://rclipper.com/admin/review',
      signedUrl: async () => 'https://cdn.example.invalid/x', postFn,
    });
    expect(ok).toBe(true);
    const parsed = JSON.parse(body) as { type: string; data: { event: string; reviewUrl: string; requestId: string } };
    expect(parsed.type).toBe('first_video');
    expect(parsed.data.event).toBe('first_video');
    expect(parsed.data.reviewUrl).toBe('https://rclipper.com/admin/review');
    expect(parsed.data.requestId).toBe('req-1');
  });
});
