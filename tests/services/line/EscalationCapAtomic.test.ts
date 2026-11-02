/**
 * Per-shop escalation cap is reserved atomically (advisory lock + guarded
 * UPDATE in one transaction) before the webhook is called, so several workers
 * cannot overshoot it. A real Postgres 16 run of 25 concurrent reservations
 * (cap 4, one already sent) granted exactly 3 + 4; these tests pin the shape.
 */
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
import { PostgresReviewOutboxRepository } from '@/repositories/postgres/PostgresReviewOutboxRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { processLineReviewOutbox } from '@/services/line/LineReviewOutboxWorker';

const env = ['GROKBOT_REVIEW_WEBHOOK_URL', 'GROKBOT_REVIEW_WEBHOOK_KEY', 'LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN', 'LINE_TEST_MODE'];
afterEach(() => { for (const k of env) delete process.env[k]; jest.restoreAllMocks(); });

describe('PostgresReviewOutboxRepository.reserveEscalationSlot', () => {
  function pooled(granted: boolean) {
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string, _values?: unknown[]) => { calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        return { rows: /UPDATE review_outbox/.test(sql) && granted ? [{ id: 'r1' }] : [] }; }),
      release: jest.fn(),
    };
    const pool = { query: jest.fn(), connect: jest.fn(async () => client) };
    return { pool, client, calls };
  }

  it('locks per shop, then checks and stamps in one guarded UPDATE, inside one transaction', async () => {
    const { pool, client, calls } = pooled(true);
    const ok = await new PostgresReviewOutboxRepository(pool as never)
      .reserveEscalationSlot('r1', 'shop-1', new Date(0), 6);
    expect(ok).toBe(true);
    expect(calls).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext(\'line.escalation.cap\'),', 'UPDATE review_outbox', 'COMMIT']);
    expect((client.query.mock.calls[1] as unknown[])[1]).toEqual(['shop-1']);
    const [updateSql, values] = client.query.mock.calls[2] as unknown as [string, unknown[]];
    expect(updateSql).toMatch(/SET sent_at = NOW\(\)/);
    expect(updateSql).toMatch(/o\.state = 'sending'/);
    expect(updateSql).toMatch(/x\.state IN \('sent','sending'\) AND x\.sent_at > \$3/);
    expect(updateSql).toMatch(/\) < \$4/);
    expect(values).toEqual(['r1', 'shop-1', new Date(0).toISOString(), 6]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('returns false at the cap and still commits/releases', async () => {
    const { pool, client, calls } = pooled(false);
    expect(await new PostgresReviewOutboxRepository(pool as never).reserveEscalationSlot('r1', 's', new Date(), 1)).toBe(false);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and releases on error', async () => {
    const client = { query: jest.fn(async (sql: string) => { if (/UPDATE/.test(sql)) throw new Error('boom'); return { rows: [] }; }), release: jest.fn() };
    const pool = { query: jest.fn(), connect: jest.fn(async () => client) };
    await expect(new PostgresReviewOutboxRepository(pool as never).reserveEscalationSlot('r1', 's', new Date(), 1)).rejects.toThrow('boom');
    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('uses the caller transaction when given a checked-out client', async () => {
    const client = { query: jest.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 'r1' }] })), release: jest.fn(), connect: jest.fn() };
    expect(await new PostgresReviewOutboxRepository(client as never).reserveEscalationSlot('r1', 's', new Date(), 1)).toBe(true);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(c => String(c[0]).trim().split(/\s+/)[0])).toEqual(['SELECT', 'UPDATE']);
  });
});

describe('worker reserves the slot before notifying', () => {
  async function setup() {
    process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid/hook';
    process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture';
    const items = new MockReviewItemRepository(new Map());
    const outbox = new MockReviewOutboxRepository(new Map());
    const accounts = new MockLineAccountRepository(new Map(), new Map());
    const item = await items.create({ typeKey: 'customer_reply', shopUserId: 'shop', title: 't', payload: {}, signals: {},
      decisionMode: 'review', matchedRules: [], dueAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
    const deps = { outbox, items, accounts, client: { push: jest.fn(), reply: jest.fn() }, execute: jest.fn() };
    return { deps, outbox, item };
  }

  it('calls reserveEscalationSlot (not a separate count) and notifies when granted', async () => {
    const { deps, outbox, item } = await setup();
    const reserve = jest.spyOn(outbox, 'reserveEscalationSlot');
    const count = jest.spyOn(outbox, 'countEscalations');
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const ev = await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    await processLineReviewOutbox(deps as never);
    expect(reserve).toHaveBeenCalledWith(ev.id, 'shop', expect.any(Date), 6);
    expect(count).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('only `limit` escalations per shop pass; the rest are deferred without a webhook call', async () => {
    const { deps, outbox, item } = await setup();
    process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN = '2';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    for (let i = 0; i < 4; i++) await outbox.enqueue({ eventType: 'review.created', reviewItemId: item.id, payload: {} });
    // Run four workers concurrently.
    await Promise.all([0, 1, 2, 3].map(() => processLineReviewOutbox(deps as never)));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
