jest.mock('@/lib/db', () => ({ pool: { connect: jest.fn() } }));
import { pool } from '@/lib/db';
import { createReviewService } from '@/repositories';
const row = { id: 'i', type_key: 'script', status: 'pending', version: 1, render_state: 'none',
  expires_at: new Date(Date.now() + 86400000), due_at: new Date(), created_at: new Date(), updated_at: new Date() };
test.each([false, true])('production decision transaction commits or rolls back all three writes (outbox fails=%s)', async fail => {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM review_items')) return { rows: [row], rowCount: 1 };
    if (sql.startsWith('UPDATE review_items')) return { rows: [{ ...row, version: 2, status: 'approved' }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO review_actions')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO review_outbox')) {
      if (fail) throw new Error('outbox failed');
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = jest.fn();
  (pool.connect as jest.Mock).mockResolvedValue({ query, release });
  const result = createReviewService().decide({ itemId: 'i', expectedVersion: 1, actorVia: 'web', decision: 'approve' });
  if (fail) await expect(result).rejects.toThrow('outbox failed');
  else await expect(result).resolves.toMatchObject({ status: 'approved', version: 2 });
  const statements = query.mock.calls.map(([sql]) => sql);
  expect(statements[0]).toBe('BEGIN');
  expect(statements.at(-1)).toBe(fail ? 'ROLLBACK' : 'COMMIT');
  expect(statements.filter(sql => sql.startsWith('INSERT'))).toHaveLength(2);
  expect(release).toHaveBeenCalledTimes(1);
});
