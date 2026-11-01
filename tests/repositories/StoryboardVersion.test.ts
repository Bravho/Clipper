import { PostgresStoryboardVersionRepository } from '@/repositories/postgres/PostgresStoryboardVersionRepository';
import type { NewStoryboardVersion } from '@/domain/models/StoryboardVersion';
jest.mock('@/lib/db', () => ({ pool: {} }));
describe('version/revision/outbox transaction (mock SQL)', () => {
 const input: NewStoryboardVersion = { requestId: 'request', parentVersionId: 'v1', scenes: [], createdBy: 'shop', reason: 'line_scene_edit', isTest: true };
 const row = { id: 'v2', request_id: 'request', parent_version_id: 'v1', scenes: [], created_by: 'shop', reason: 'line_scene_edit', is_test: true, created_at: new Date() };
 const setup = (revision = 0, parent = 'v1') => {
  const query = jest.fn(async (sql: string) => sql.startsWith('SELECT storyboard') ? { rows: [{ storyboard_version_id: parent, revision_count: revision, is_test: true }] } : sql.startsWith('INSERT INTO storyboard') ? { rows: [row] } : { rows: [] });
  const release = jest.fn(); const db = { connect: jest.fn(async () => ({ query, release })), query };
  const repo = new PostgresStoryboardVersionRepository(db as never); return { repo, query, release };
 };
 test('locks parent, appends, debits and queues before commit', async () => {
  const { repo, query, release } = setup(); await repo.append(input, true);
  const sql = query.mock.calls.map(c => c[0]);
  expect(sql[0]).toBe('BEGIN'); expect(sql[1]).toContain('FOR UPDATE'); expect(sql.join('\n')).toContain('revision_count=revision_count+$3');
  expect(sql.join('\n')).toContain("'storyboard.render'"); expect(sql[sql.length-1]).toBe('COMMIT'); expect(release).toHaveBeenCalled();
 });
 test.each([[2,'v1','max_revisions_exceeded'],[0,'v0','version_conflict']])('rolls back rejected append %s/%s', async (count, parent, error) => {
  const { repo, query } = setup(count as number,parent as string); await expect(repo.append(input,true)).rejects.toThrow(error as string);
  expect(query.mock.calls.map(c => c[0])).toContain('ROLLBACK'); expect(query.mock.calls.some(c => c[0].startsWith('INSERT'))).toBe(false);
 });
 test('queue failure rolls back version and debit together', async () => {
  const { repo, query } = setup(); query.mockImplementation(async sql => {
   if (sql.includes('INSERT INTO review_outbox')) throw new Error('outbox unavailable');
   if (sql.startsWith('SELECT')) return { rows: [{ storyboard_version_id: 'v1', revision_count: 0, is_test: true }] } as never;
   return { rows: [row] } as never;
  });
  await expect(repo.append(input,true)).rejects.toThrow('outbox unavailable'); const calls = query.mock.calls; expect(calls[calls.length-1][0]).toBe('ROLLBACK');
 });
});
