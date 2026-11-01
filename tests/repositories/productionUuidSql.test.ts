import { PostgresAssetVisualAnalysisRepository } from '@/repositories/postgres/PostgresAssetVisualAnalysisRepository';
import { PostgresStoryboardVersionRepository } from '@/repositories/postgres/PostgresStoryboardVersionRepository';
import { PostgresReviewOutboxRepository } from '@/repositories/postgres/PostgresReviewOutboxRepository';
jest.mock('@/lib/db', () => ({ pool: {} }));

test('visual analysis inserts and predicates bind UUID assets', async () => {
 const query = jest.fn().mockResolvedValue({ rows: [] });
 const repo = new PostgresAssetVisualAnalysisRepository({ query } as never);
 await repo.enqueue('asset', 'v'); await repo.get('asset', 'v');
 await repo.pending('asset', 'v'); await repo.fail('asset', 'v');
 await repo.save({ assetId: 'asset', version: 'v' } as never);
 for (const [sql] of query.mock.calls) expect(sql).toContain('$1::uuid');
 expect(query.mock.calls[0][0]).not.toContain('$1::text');
});
test('delivery compares UUID asset IDs with a UUID array', async () => {
 const query = jest.fn().mockResolvedValue({ rows: [] });
 await new PostgresStoryboardVersionRepository({ query } as never).linkDelivery('request', 'version', ['asset']);
 expect(query.mock.calls[1][0]).toContain('id=ANY($3::uuid[])');
 expect(query.mock.calls[1][0]).not.toContain('::text[]');
});
test('outbox UUID owners compare to text payloads without casting malformed payloads to UUID', async () => {
 const query = jest.fn().mockResolvedValue({ rows: [] });
 await new PostgresReviewOutboxRepository({ query } as never).claimNext();
 const sql = query.mock.calls[0][0];
 for (const expected of ["sv.id::text=review_outbox.payload->>'version_id'", "vj.id::text=review_outbox.payload->>'job_id'", 'cr.id::text=COALESCE(ri.request_id::text,', 'sv.request_id::text, vj.request_id::text', 'po.id::text=COALESCE(ri.package_order_id::text,', 'la.user_id::text=COALESCE(ri.shop_user_id::text,']) expect(sql).toContain(expected);
 expect(sql).not.toContain('::uuid');
});

const columns = [
 ['asset_visual_analyses', 'asset_id'], ['storyboard_versions', 'request_id'],
 ['clip_requests', 'storyboard_version_id'], ['clip_requests', 'delivered_storyboard_version_id'],
 ['uploaded_assets', 'storyboard_version_id'], ['video_generation_jobs', 'storyboard_version_id'],
].map(([table_name, column_name]) => ({ table_name, column_name, data_type: 'uuid' }));
const fks = [
 { table_name: 'asset_visual_analyses', column_name: 'asset_id', target_table: 'uploaded_assets', target_column: 'id', confdeltype: 'c', convalidated: true },
 { table_name: 'storyboard_versions', column_name: 'request_id', target_table: 'clip_requests', target_column: 'id', confdeltype: 'a', convalidated: true },
];
const indexes = ['uq_render_tasks_active_test_job', 'uq_render_tasks_active_all_job'].map(name => ({
 name, indisunique: true, indisvalid: true, key: 'job_id', indnkeyatts: 1, indnatts: 1,
 predicate: name.includes('test_job') ? "state IN ('test_queued', 'test_claimed')" : "state IN ('queued', 'claimed', 'test_queued', 'test_claimed')",
}));
const check = require('../../scripts/check-phase2-schema.cjs').checkPhase2Schema;
const dbFor = (cols = columns, constraints = fks) => ({ query: jest.fn()
 .mockResolvedValueOnce({ rows: indexes }).mockResolvedValueOnce({ rows: cols }).mockResolvedValueOnce({ rows: constraints }) });
test('catalog checker verifies UUID columns and validated foreign keys with SELECT only', async () => {
 const db = dbFor(); await expect(check(db)).resolves.toBeUndefined();
 for (const [sql] of db.query.mock.calls) expect(sql.trim()).toMatch(/^SELECT/);
});
test.each(columns)('catalog checker rejects missing or TEXT $table_name.$column_name', async col => {
 await expect(check(dbFor(columns.filter(c => c !== col)))).rejects.toThrow(col.table_name + '.' + col.column_name);
 await expect(check(dbFor(columns.map(c => c === col ? { ...c, data_type: 'text' } : c)))).rejects.toThrow('prerequisite');
});
test.each(fks)('catalog checker rejects missing or invalid $table_name FK', async fk => {
 await expect(check(dbFor(columns, fks.filter(f => f !== fk)))).rejects.toThrow('FK');
 await expect(check(dbFor(columns, fks.map(f => f === fk ? { ...f, convalidated: false } : f)))).rejects.toThrow('FK');
 await expect(check(dbFor(columns, fks.map(f => f === fk ? { ...f, target_table: 'wrong' } : f)))).rejects.toThrow('FK');
});

test('outbox writes use only production columns', async () => {
 const query = jest.fn().mockResolvedValue({ rows: [] });
 const repo = new PostgresReviewOutboxRepository({ query } as never);
 await repo.defer('1', new Date()); await repo.markFailed('1', 'error');
 for (const [sql] of query.mock.calls) expect(sql).not.toContain('updated_at');
});
