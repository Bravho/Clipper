jest.mock('@/lib/db', () => ({ pool: { connect: jest.fn() } }));
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/review/[id]/decision/route';
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

// Exercise real SQL adapters: automation must never send a label to UUID FKs.
test('automation decision uses nullable UUID foreign keys', async () => {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('UPDATE review_items')) {
      const actorParam = sql.match(/decided_by = \$(\d+)/);
      expect(actorParam).not.toBeNull();
      expect(params?.[Number(actorParam![1]) - 1]).toBeNull();
      return { rows: [{ ...row, status: 'approved', version: 2 }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO review_actions')) {
      expect(params?.[3]).toBeNull();
      expect(params?.[4]).toBe('grokbot_app');
    }
    return { rows: [row], rowCount: 1 };
  });
  (pool.connect as jest.Mock).mockResolvedValue({ query, release: jest.fn() });
  process.env.REVIEW_ADMIN_TOKEN = 'fixture-token';
  try {
    const response = await POST(new NextRequest('http://localhost/api/admin/review/i/decision', {
      method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body: JSON.stringify({ version: 1, decision: 'approve' }),
    }), { params: { id: 'i' } });
    expect(response.status).toBe(200);
  } finally { delete process.env.REVIEW_ADMIN_TOKEN; }
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO review_actions'))).toBe(true);
});
