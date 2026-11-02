/**
 * Admin list + 12-hour reminder never mix test and production review items
 * (review_items has no is_test; owner resolved via request / order / LINE account).
 */
import { PostgresReviewItemRepository, REVIEW_ITEM_IS_TEST_SQL } from '@/repositories/postgres/PostgresReviewItemRepository';

afterEach(() => { delete process.env.LINE_TEST_MODE; });

function repoWithCapture() {
  const query = jest.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
  return { repo: new PostgresReviewItemRepository({ query } as never), query };
}
const last = (q: jest.Mock) => q.mock.calls[q.mock.calls.length - 1] as [string, unknown[]];

describe.each([
  ['production process', undefined, false],
  ['LINE_TEST_MODE process', 'true', true],
])('%s', (_label, envValue, expected) => {
  beforeEach(() => { if (envValue) process.env.LINE_TEST_MODE = envValue; });

  it('admin list is scoped to the process mode', async () => {
    const { repo, query } = repoWithCapture();
    await repo.listPending();
    const [sql, values] = last(query);
    expect(sql).toContain(REVIEW_ITEM_IS_TEST_SQL);
    expect(values).toContain(expected);
    // the mode param precedes the LIMIT param
    expect(values[values.length - 2]).toBe(expected);
  });

  it('admin list keeps the scope with other filters', async () => {
    const { repo, query } = repoWithCapture();
    await repo.listPending({ shopUserId: 'u1', typeKey: 'customer_reply', limit: 5 });
    const [sql, values] = last(query);
    expect(sql).toMatch(/shop_user_id = \$2 AND type_key = \$3 AND COALESCE\([\s\S]*= \$4::boolean ORDER BY due_at ASC LIMIT \$5/);
    expect(values).toEqual([['pending', 'edited'], 'u1', 'customer_reply', expected, 5]);
  });

  it('reminder selection and claim are scoped to the process mode', async () => {
    const { repo, query } = repoWithCapture();
    await repo.listDueForReminder(new Date());
    let [sql, values] = last(query);
    expect(sql).toContain(REVIEW_ITEM_IS_TEST_SQL + ' = $3::boolean');
    expect(values[2]).toBe(expected);
    await repo.claimReminder('i1', new Date());
    [sql, values] = last(query);
    expect(sql).toContain(REVIEW_ITEM_IS_TEST_SQL + ' = $3::boolean');
    expect(values[2]).toBe(expected);
  });
});

it('owner order is request, then package order, then the shop LINE account, else production', () => {
  const i = (s: string) => REVIEW_ITEM_IS_TEST_SQL.indexOf(s);
  expect(i('clip_requests')).toBeLessThan(i('package_orders'));
  expect(i('package_orders')).toBeLessThan(i('line_accounts'));
  expect(REVIEW_ITEM_IS_TEST_SQL.trim().endsWith('FALSE)')).toBe(true);
  // a non-UUID request_id never reaches a ::uuid cast
  expect(REVIEW_ITEM_IS_TEST_SQL).toMatch(/CASE\s+WHEN review_items\.request_id ~\*/);
});
