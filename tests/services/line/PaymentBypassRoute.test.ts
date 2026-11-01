import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('@/lib/line/LineClient', () => ({ LineClient: jest.fn(() => ({ reply: jest.fn() })) }));
jest.mock('@/services/line/lineSceneEditRuntime', () => ({ handleSceneEditMessage: jest.fn(async () => null) }));
jest.mock('@/repositories/index', () => {
  const { MockLineAccountRepository } = require('@/repositories/mock/MockLineAccountRepository');
  const { MockServicePackageRepository } = require('@/repositories/mock/MockServicePackageRepository');
  return { lineAccountRepository: new MockLineAccountRepository(new Map(), new Map()),
    servicePackageRepository: new MockServicePackageRepository(new Map(), new Map()),
    userRepository: {}, clipRequestRepository: {}, uploadedAssetRepository: {} };
});
import { pool } from '@/lib/db';
import { LineClient } from '@/lib/line/LineClient';
import { lineAccountRepository as accounts, servicePackageRepository as packages } from '@/repositories/index';
import { POST } from '@/app/api/line/webhook/route';

const original = process.env;
const channel = process.env.LINE_CHANNEL_ID ?? 'default';
afterEach(() => { process.env = original; jest.restoreAllMocks(); });

test.each([
  ['test shop', true, false, true],
  ['real shop default', false, false, false],
  ['real shop override', false, true, true],
] as const)('signed route wires package choice and paid state: %s; redelivery grants once', async (name, testMode, disabled, bypass) => {
  process.env = { ...original, LINE_INTAKE_ENABLED: 'true', LINE_CHANNEL_SECRET: 'fixture',
    LINE_TEST_MODE: String(testMode) };
  delete process.env.LINE_TEST_SHOP_ID;
  delete process.env.PAYMENT_DISABLED;
  if (disabled) process.env.PAYMENT_DISABLED = 'true';
  await accounts.create({ userId: name, lineUserId: name, lineChannelId: channel,
    displayName: null, linkedVia: 'auto_created', status: 'active', isTest: testMode });
  await accounts.upsertConversationState(channel, name, 'awaiting_package_choice', { intakeId: name });
  let completed = false;
  (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT INTO line_webhook_events')) return { rowCount: completed ? 0 : 1 };
    if (sql.startsWith('SELECT completed_at')) return { rows: [{ completed_at: completed ? new Date() : null }] };
    if (sql.includes('completed_at=NOW()')) completed = true;
    return { rows: [], rowCount: 1 };
  });
  const create = jest.spyOn(packages, 'createOrder');
  const update = jest.spyOn(packages, 'updateOrderStatus');
  const usage = jest.spyOn(packages, 'recordUsage');
  const request = () => {
    const body = JSON.stringify({ events: [{ type: 'message', webhookEventId: name, replyToken: 'reply',
      source: { userId: name }, message: { type: 'text', text: 'trial', id: 'message' } }] });
    return new NextRequest('http://localhost/api/line/webhook', { method: 'POST', body,
      headers: { 'x-line-signature': createHmac('sha256', 'fixture').update(body).digest('base64') } });
  };
  expect((await POST(request())).status).toBe(200);
  const state = await accounts.getConversationState(channel, name);
  expect(state?.state).toBe(bypass ? 'awaiting_brief' : 'awaiting_payment');
  const order = await packages.findOrderById(String(state?.context.orderId));
  expect(order).toMatchObject({ isTest: testMode, status: bypass ? 'active' : 'pending_payment',
    paidReference: bypass ? 'payment_disabled' : null });
  const client = (LineClient as jest.Mock).mock.results[0].value;
  const message = client.reply.mock.calls.at(-1)[1][0].text;
  expect(message.includes('buy.stripe.com')).toBe(!bypass);
  if (bypass) expect((await packages.getBalance(order!.id)).clipsLeft).toBe(2);
  expect(update).not.toHaveBeenCalled();
  expect(usage).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(200);
  expect(create).toHaveBeenCalledTimes(1);
});
