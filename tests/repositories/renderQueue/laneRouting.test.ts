jest.mock('@/lib/db', () => ({ pool: {} }));
import { PostgresRenderTaskRepository } from '@/repositories/postgres/PostgresRenderTaskRepository';
import { RenderStep } from '@/domain/enums/RenderStep';
import baseline from './fixtures/pre049.json';
const task = { jobId: 'j', requestId: 'r', step: RenderStep.FfmpegComposition, renderLane: 'mac_mini' };
afterEach(() => { delete process.env.RENDER_LANE_ENABLED; });
test('disabled flag uses byte-for-byte original INSERT and claim SQL without migration 049', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ id: 't' }] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.enqueue(task); await repo.claimNext('main',60);
  expect(query.mock.calls[0][0]).toBe(baseline.insert);
  expect(query.mock.calls[1][0]).toBe(baseline.claim);
  expect(query.mock.calls[0][1]).toHaveLength(7);
  expect(query.mock.calls[1][1]).toHaveLength(4);
});
test('enabled LINE enqueue carries main lane and backup claims only on stale heartbeat or excessive wait', async () => {
  process.env.RENDER_LANE_ENABLED = 'true';
  const query = jest.fn().mockResolvedValue({ rows: [{ id: 't' }] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.enqueue(task); await repo.claimNext('mar',60,'backup');
  expect(query.mock.calls[0][1][7]).toBe('mac_mini');
  const [sql, params] = query.mock.calls[1];
  expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  expect(sql).toContain("render_lane = 'mac_mini'");
  expect(sql).toContain('NOT EXISTS (SELECT 1 FROM render_lane_heartbeats');
  expect(sql).toContain("lane = 'main'");
  expect(sql).toContain("OR enqueued_at < NOW()");
  expect(params.slice(4)).toEqual(['90','600']);
});
test('enabled main worker still claims studio and LINE jobs', async () => {
  process.env.RENDER_LANE_ENABLED = 'true';
  const query = jest.fn().mockResolvedValue({ rows: [] });
  await new PostgresRenderTaskRepository({ query } as never).claimNext('mac',60,'main');
  expect(query.mock.calls[0][0]).not.toContain('NOT EXISTS');
  expect(query.mock.calls[0][1]).toHaveLength(4);
});
