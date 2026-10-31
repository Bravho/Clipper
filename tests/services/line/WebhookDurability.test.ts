import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('@/repositories/index', () => ({ lineAccountRepository: {}, userRepository: {}, servicePackageRepository: {}, clipRequestRepository: {}, uploadedAssetRepository: {} }));
jest.mock('@/services/line/LineWebhookService', () => ({
  ...jest.requireActual('@/services/line/LineWebhookService'), processLineEvent: jest.fn() }));
import { pool } from '@/lib/db';
import { processLineEvent } from '@/services/line/LineWebhookService';
import { POST } from '@/app/api/line/webhook/route';
beforeEach(() => {
  process.env.LINE_INTAKE_ENABLED = 'true'; process.env.LINE_CHANNEL_SECRET = 'fixture'; jest.clearAllMocks();
});
function request() {
  const body = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'e1', source: { userId: 'u' }, message: { type: 'text', text: 'hi' } }] });
  return new NextRequest('http://localhost/api/line/webhook', { method: 'POST', body,
    headers: { 'x-line-signature': createHmac('sha256','fixture').update(body).digest('base64') } });
}
test('missing persistence table fails closed and returns non-2xx', async () => {
  (pool.query as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
  expect((await POST(request())).status).toBe(500);
  expect(processLineEvent).not.toHaveBeenCalled();
});
test('duplicate event is not processed twice', async () => {
  (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ completed_at: new Date() }] });
  expect((await POST(request())).status).toBe(200);
  expect(processLineEvent).not.toHaveBeenCalled();
});
test('event payload is persisted before processing, completion follows successful processing', async () => {
  (pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });
  (processLineEvent as jest.Mock).mockImplementation(async (_event, options) => {
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(options.choosePackage).toBeInstanceOf(Function);
    expect(options.createReviewItem).toBeInstanceOf(Function);
    return { intent: 'greeting' };
  });
  expect((await POST(request())).status).toBe(200);
  expect((pool.query as jest.Mock).mock.calls[0][1][3]).toContain('e1');
  expect((pool.query as jest.Mock).mock.calls[1][0]).toContain('completed_at=NOW()');
});
