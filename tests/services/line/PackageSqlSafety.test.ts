
jest.mock('@/lib/db', () => ({ pool: {} }));
import { PostgresServicePackageRepository } from '@/repositories/postgres/PostgresServicePackageRepository';
import { PostgresReviewOutboxRepository } from '@/repositories/postgres/PostgresReviewOutboxRepository';
const order = { id: 'oldest', user_id: 'shop', is_test: true, status: 'active', clips_included: 2, expires_at: new Date(Date.now()+86400000) };
test('real SQL consumption locks user, picks oldest paid balance, updates request and records usage atomically', async () => {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT cr.user_id')) return { rows: [order] };
    if (sql.startsWith('SELECT user_id')) return { rows: [order] };
    if (sql.startsWith('SELECT * FROM package_orders po')) {
      expect(sql).toContain('ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE');
      expect(sql).toContain('is_test=$2');
      expect(params).toEqual(['shop', true, 1]);
      return { rows: [order] };
    }
    if (sql.startsWith('SELECT * FROM package_orders WHERE id')) return { rows: [order] };
    if (sql.includes(' AS used')) return { rows: [{ used: 0 }] };
    if (sql.startsWith('INSERT INTO package_usage')) {
      expect(params?.[0]).toBe('oldest');
      return { rows: [{ id: 1, package_order_id: 'oldest', request_id: 'req', kind: 'clip', units: 1 }] };
    }
    return { rows: [] };
  });
  const release = jest.fn();
  const repo = new PostgresServicePackageRepository({ connect: async () => ({ query, release }) } as never);
  await repo.recordUsage({ packageOrderId: 'newer', requestId: 'req', kind: 'clip' });
  const statements = query.mock.calls.map(call => call[0]);
  expect(statements[0]).toBe('BEGIN');
  expect(statements).toContain('SELECT pg_advisory_xact_lock(hashtext($1))');
  expect(statements.some(s => s.startsWith('UPDATE clip_requests'))).toBe(true);
  expect(statements.at(-1)).toBe('COMMIT');
  expect(release).toHaveBeenCalled();
});
test('test worker SQL claims only test-associated events', async () => {
  process.env.LINE_TEST_MODE = 'true';
  const query = jest.fn(async () => ({ rows: [] }));
  try {
    await new PostgresReviewOutboxRepository({ query } as never).claimNext();
    const [sql, params] = (query.mock.calls as unknown[][])[0];
    expect(params).toEqual([true]);
    expect(sql).toContain('COALESCE(cr.is_test, po.is_test,');
    expect(sql).toContain('= $1::boolean');
  } finally { delete process.env.LINE_TEST_MODE; }
});


test('real SQL pending-order creation reuses under a user lock without inserting a duplicate', async () => {
  const pending = { ...order, status: 'pending_payment', package_code: 'trial' };
  const query = jest.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT * FROM package_orders WHERE user_id') ? [pending] : [] }));
  const repo = new PostgresServicePackageRepository({ connect: async () => ({ query, release: jest.fn() }) } as never);
  const reused = await repo.createOrder({ userId: 'shop', packageCode: 'trial', clipsIncluded: 2,
    revisionsPerClip: 2, priceBaht: 299, expiresAt: new Date(Date.now()+86400000), isTest: true });
  expect(reused.id).toBe('oldest');
  const statements = query.mock.calls.map(c => c[0]);
  expect(statements[1]).toContain('pg_advisory_xact_lock');
  expect(statements.some(s => s.startsWith('INSERT'))).toBe(false);
  expect(statements.at(-1)).toBe('COMMIT');
});


test('migration 054 tags the package table actually created by 050 and queried by the adapter', () => {
  const fs = require('fs');
  const schema = fs.readFileSync('src/db/migrations/050_service_packages.sql', 'utf8');
  const flags = fs.readFileSync('src/db/migrations/054_is_test_flag.sql', 'utf8');
  expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS package_orders/);
  expect(flags).toContain('ALTER TABLE package_orders ADD COLUMN IF NOT EXISTS is_test');
  expect(flags).not.toContain('service_package_orders');
});
