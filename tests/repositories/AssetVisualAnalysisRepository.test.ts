import { PostgresAssetVisualAnalysisRepository } from '@/repositories/postgres/PostgresAssetVisualAnalysisRepository';
jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
test('Postgres queue uses conflict-safe key, atomic skip-locked claim and immutable results', async () => {
  const query = jest.fn(async () => ({ rows: [] }));
  const repo = new PostgresAssetVisualAnalysisRepository({ query } as never);
  await repo.enqueue('asset','1'); await repo.claim('1'); await repo.get('asset','1');
  await repo.save({ assetId: 'asset',version: '1',frames: [] } as never);
  await repo.pending('asset','1'); await repo.expireClaims('1',900);
  const calls = query.mock.calls as unknown as [string,unknown[]][];
  expect(calls[0][0]).toContain('ON CONFLICT DO NOTHING');
  expect(calls[1][0]).toContain('FOR UPDATE OF ava SKIP LOCKED');
  // Second param is testMode (false when LINE_TEST_MODE is unset)
  expect(calls[1][1]).toEqual(['1', false]);
  expect(calls[2][0]).toContain("state='done'");
  expect(calls[3][0]).toContain("AND state='claimed'");
  expect(calls[5][0]).toContain("state='failed'"); expect(calls[5][1]).toEqual(['1',900,false]);
});

test('opaque non-UUID asset IDs round-trip as TEXT in the Postgres cache', async () => {
 const analysis = { assetId: 'line-upload/photo-001', version: '1', frames: [] } as never;
 const query = jest.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT result') ? [{ result: analysis }] : sql.includes('RETURNING asset_id') ? [{ asset_id: 'line-upload/photo-001' }] : [] }));
 const repo = new PostgresAssetVisualAnalysisRepository({ query } as never);
 await repo.enqueue('line-upload/photo-001', '1');
 expect(query.mock.calls[0]).toEqual([expect.stringContaining('$1::text'), ['line-upload/photo-001', '1']]);
 expect(await repo.claim('1')).toBe('line-upload/photo-001');
 expect(await repo.get('line-upload/photo-001', '1')).toEqual(analysis);
 await repo.save(analysis);
});
