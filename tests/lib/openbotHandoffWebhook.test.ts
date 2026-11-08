import { createHmac } from 'crypto';
import {
  notifyOpenBotHandoff,
  signOpenBotWebhook,
  buildHandoffNoticeBody,
} from '@/lib/line/openbotHandoffWebhook';

const ITEM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const env: Record<string, string | undefined> = {
  OPENBOT_HANDOFF_WEBHOOK_URL: 'https://signal.example.test/hook',
  OPENBOT_HANDOFF_WEBHOOK_SECRET: 'test-secret',
  OPENBOT_HANDOFF_APP_ORIGIN: 'https://app.example.test/',
};
const now = () => 1_700_000_000_000;

describe('signOpenBotWebhook', () => {
  it('is HMAC-SHA256 over "timestamp.deliveryId.body", sent as sha256=<hex>', () => {
    const body = '{"a":1}';
    const expected = 'sha256=' + createHmac('sha256', 'test-secret').update(`1700000000.abc.${body}`).digest('hex');
    expect(signOpenBotWebhook(body, '1700000000', 'abc', 'test-secret')).toBe(expected);
  });
});

describe('buildHandoffNoticeBody', () => {
  it('uses the type/data envelope and a fetch URL for the item, without a trailing slash on the origin', () => {
    const parsed = JSON.parse(buildHandoffNoticeBody({ itemId: ITEM, isTest: true, takeoverActive: false }, 'https://app.example.test/'));
    expect(parsed.type).toBe('line.handoff.created');
    expect(parsed.data).toEqual({
      event: 'customer_message',
      itemId: ITEM,
      isTest: true,
      takeoverActive: false,
      fetchUrl: `https://app.example.test/api/admin/line/handoff/${ITEM}`,
    });
  });

  it('carries takeoverActive=true when a human has taken over the chat', () => {
    const parsed = JSON.parse(buildHandoffNoticeBody({ itemId: ITEM, isTest: false, takeoverActive: true }, 'https://app.example.test'));
    expect(parsed.data.takeoverActive).toBe(true);
  });
});

describe('notifyOpenBotHandoff', () => {
  it('skips without calling the network when any setting is missing', async () => {
    const fetchImpl = jest.fn();
    const result = await notifyOpenBotHandoff({ itemId: ITEM, isTest: false, takeoverActive: false }, {}, fetchImpl as never, now);
    expect(result).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a malformed item id without calling the network', async () => {
    const fetchImpl = jest.fn();
    const result = await notifyOpenBotHandoff({ itemId: '../x', isTest: false, takeoverActive: false }, env, fetchImpl as never, now);
    expect(result).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a signed POST with the three OpenBot headers', async () => {
    const fetchImpl = jest.fn(async () => new Response('ok', { status: 202 }));
    const result = await notifyOpenBotHandoff({ itemId: ITEM, isTest: false, takeoverActive: false }, env, fetchImpl as never, now);
    expect(result).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://signal.example.test/hook');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-OpenBot-Timestamp']).toBe('1700000000');
    expect(headers['X-OpenBot-Delivery-Id']).toMatch(/^[0-9a-f]{32}$/);
    expect(headers['X-OpenBot-Signature']).toBe(
      signOpenBotWebhook(init.body as string, headers['X-OpenBot-Timestamp'], headers['X-OpenBot-Delivery-Id'], 'test-secret'),
    );
  });

  it('reports failed on a non-2xx answer and never throws on a network error', async () => {
    const notOk = jest.fn(async () => new Response('no', { status: 401 }));
    expect(await notifyOpenBotHandoff({ itemId: ITEM, isTest: false, takeoverActive: false }, env, notOk as never, now)).toBe('failed');
    const down = jest.fn(async () => { throw new Error('network down'); });
    expect(await notifyOpenBotHandoff({ itemId: ITEM, isTest: false, takeoverActive: false }, env, down as never, now)).toBe('failed');
  });
});
