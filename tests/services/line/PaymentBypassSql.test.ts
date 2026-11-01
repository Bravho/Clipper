jest.mock('@/lib/db', () => ({ pool: {} }));
import { PostgresServicePackageRepository } from '@/repositories/postgres/PostgresServicePackageRepository';

test.each([true, false])('bypass SQL inserts active allowance in the exact test scope (%s), without UPDATE or usage grants', async isTest => {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT * FROM package_orders po')) {
      expect(params).toEqual(['shop', isTest]);
      expect(sql).toContain('is_test=$2');
      expect(sql).toContain('FROM package_usage');
    }
    if (sql.startsWith('INSERT INTO package_orders')) {
      expect(sql).toContain('status, paid_reference');
      expect(params?.slice(7)).toEqual([isTest, 'active', 'payment_disabled']);
      return { rows: [{ id: 'grant', user_id: 'shop', status: 'active', is_test: isTest }] };
    }
    return { rows: [] };
  });
  const release = jest.fn();
  const repo = new PostgresServicePackageRepository({ connect: async () => ({ query, release }) } as never);
  await repo.createOrder({ userId: 'shop', packageCode: 'trial', clipsIncluded: 2,
    revisionsPerClip: 2, priceBaht: 299, expiresAt: new Date(), isTest, activationReference: 'payment_disabled' });
  const sql = query.mock.calls.map(c => c[0]);
  expect(sql[1]).toContain('pg_advisory_xact_lock');
  expect(sql.filter(s => s.startsWith('INSERT'))).toHaveLength(1);
  expect(sql.some(s => /UPDATE|pending_payment/.test(s))).toBe(false);
  expect(sql.at(-1)).toBe('COMMIT');
  expect(release).toHaveBeenCalled();
});

test('SQL retry reuses active scoped balance under lock without INSERT or UPDATE', async () => {
  const query = jest.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT * FROM package_orders po')
    ? [{ id: 'existing', user_id: 'shop', status: 'active', is_test: true }] : [] }));
  const repo = new PostgresServicePackageRepository({ connect: async () => ({ query, release: jest.fn() }) } as never);
  const result = await repo.createOrder({ userId: 'shop', packageCode: 'trial', clipsIncluded: 2,
    revisionsPerClip: 2, priceBaht: 299, expiresAt: new Date(), isTest: true, activationReference: 'payment_disabled' });
  expect(result.id).toBe('existing');
  expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE/.test(sql))).toBe(false);
  expect(query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
});
