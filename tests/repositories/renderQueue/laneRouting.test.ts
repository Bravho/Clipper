jest.mock('@/lib/db', () => ({ pool: {} }));
import { PostgresRenderTaskRepository } from '@/repositories/postgres/PostgresRenderTaskRepository';
import { RenderStep } from '@/domain/enums/RenderStep';
const task = { jobId: 'j', requestId: 'r', step: RenderStep.FfmpegComposition, renderLane: 'mac_mini' };
afterEach(() => {
  delete process.env.RENDER_LANE_ENABLED;
  delete process.env.RENDER_MAIN_STALE_SECONDS;
  delete process.env.RENDER_BACKUP_QUEUE_SECONDS;
  delete process.env.LINE_TEST_MODE;
});
test('disabled flag omits render_lane while retaining request ownership and conflict safety', async () => {
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: process.env.LINE_TEST_MODE === 'true' }] }).mockResolvedValue({ rows: [{ id: 't' }] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.enqueue(task); await repo.claimNext('main',60);
  expect(query.mock.calls[1][0]).not.toContain('render_lane');
  expect(query.mock.calls[1][0]).toContain('DO NOTHING');
  expect(query.mock.calls[1][1]).toHaveLength(8);
  expect(query.mock.calls[2][0]).not.toContain('render_lane');
  expect(query.mock.calls[2][0]).toContain('cr.is_test');
  expect(query.mock.calls[2][1]).toHaveLength(4);
});
test('enabled LINE enqueue carries main lane and backup uses default 90s stale / 600s wait thresholds', async () => {
  process.env.RENDER_LANE_ENABLED = 'true';
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: process.env.LINE_TEST_MODE === 'true' }] }).mockResolvedValue({ rows: [{ id: 't' }] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.enqueue(task); await repo.claimNext('mar',60,'backup');
  expect(query.mock.calls[1][1][8]).toBe('mac_mini');
  const [sql, params] = query.mock.calls[2];
  expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  expect(sql).toContain("render_lane = 'mac_mini'");
  expect(sql).toContain('NOT EXISTS (SELECT 1 FROM render_lane_heartbeats');
  expect(sql).toContain("lane = 'main'");
  expect(sql).toContain("OR enqueued_at < NOW()");
  expect(params.slice(4)).toEqual(['90','600']);
});
test('backup worker uses custom RENDER_MAIN_STALE_SECONDS and RENDER_BACKUP_QUEUE_SECONDS when set', async () => {
  process.env.RENDER_LANE_ENABLED = 'true';
  process.env.RENDER_MAIN_STALE_SECONDS = '120';
  process.env.RENDER_BACKUP_QUEUE_SECONDS = '300';
  const query = jest.fn().mockResolvedValue({ rows: [] });
  await new PostgresRenderTaskRepository({ query } as never).claimNext('mar', 60, 'backup');
  const params = query.mock.calls[0][1];
  expect(params.slice(4)).toEqual(['120', '300']);
});
test('enabled main worker still claims studio and LINE jobs', async () => {
  process.env.RENDER_LANE_ENABLED = 'true';
  const query = jest.fn().mockResolvedValue({ rows: [] });
  await new PostgresRenderTaskRepository({ query } as never).claimNext('mac',60,'main');
  expect(query.mock.calls[0][0]).not.toContain('NOT EXISTS (SELECT 1 FROM render_lane_heartbeats');
  expect(query.mock.calls[0][1]).toHaveLength(4);
});
test('LINE_TEST_MODE enqueue uses test_queued state (invisible to old Mac Mini worker)', async () => {
  process.env.LINE_TEST_MODE = 'true';
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: process.env.LINE_TEST_MODE === 'true' }] }).mockResolvedValue({ rows: [{ id: 't' }] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.enqueue(task);
  const [sql, params] = query.mock.calls[1];
  expect(sql).toContain("'test_queued'");
  expect(params[7]).toBe("test_queued");
  expect(sql).toContain('DO NOTHING');
  expect(params).toHaveLength(9); // lane-enabled path in test mode always includes render_lane
});
test('LINE_TEST_MODE claimNext updates to test_claimed (old worker stale-reclaim cannot grab these)', async () => {
  process.env.LINE_TEST_MODE = 'true';
  const query = jest.fn().mockResolvedValue({ rows: [] });
  await new PostgresRenderTaskRepository({ query } as never).claimNext('mar-pc', 60);
  const [sql] = query.mock.calls[0];
  expect(sql).toContain("state = 'test_queued'");
  expect(sql).toContain("state = 'test_claimed'");
  expect(sql).toContain("state        = 'test_claimed'");
  expect(sql).not.toContain("state = 'queued'");
});
test('non-test claimNext only looks for queued/claimed — test_queued is invisible', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  await new PostgresRenderTaskRepository({ query } as never).claimNext('mac', 60);
  const [sql] = query.mock.calls[0];
  expect(sql).toContain("state = 'queued'");
  expect(sql).toContain("state = 'claimed'");
  expect(sql).not.toContain('test_queued');
  expect(sql).not.toContain('test_claimed');
});
