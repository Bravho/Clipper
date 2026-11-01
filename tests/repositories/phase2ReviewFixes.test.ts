import fs from 'fs';
import { PostgresRenderTaskRepository } from '@/repositories/postgres/PostgresRenderTaskRepository';
import { PostgresAssetVisualAnalysisRepository } from '@/repositories/postgres/PostgresAssetVisualAnalysisRepository';
import { RenderStep } from '@/domain/enums/RenderStep';
jest.mock('@/lib/db', () => ({ pool: {} }));
const input = { jobId: 'j', requestId: 'r', step: RenderStep.MontageMerge };
const task = { id: 't', request_id: 'r', state: 'test_claimed', attempts: 4 };
const oldMode = process.env.LINE_TEST_MODE;
const oldLane = process.env.RENDER_LANE_ENABLED;
afterEach(() => {
  if (oldMode === undefined) delete process.env.LINE_TEST_MODE; else process.env.LINE_TEST_MODE = oldMode;
  if (oldLane === undefined) delete process.env.RENDER_LANE_ENABLED; else process.env.RENDER_LANE_ENABLED = oldLane;
});

test.each([false, true])('1: persisted test request uses test namespace in process mode %s', async mode => {
  process.env.LINE_TEST_MODE = String(mode);
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: true }] }).mockResolvedValue({ rows: [task] });
  await new PostgresRenderTaskRepository({ query } as never).enqueue(input);
  expect(query.mock.calls[0]).toEqual([expect.stringContaining('FROM clip_requests'), ['r']]);
  expect(query.mock.calls[1][1][7]).toBe('test_queued');
  expect(query.mock.calls[1][0]).toContain('WHERE NOT EXISTS');
  expect(query.mock.calls[1][0]).toContain("state IN ('queued', 'claimed', 'test_queued', 'test_claimed')");
});
test('1: test process refuses production or missing request', async () => {
  process.env.LINE_TEST_MODE = 'true';
  for (const rows of [[{ is_test: false }], []]) {
    const query = jest.fn().mockResolvedValue({ rows });
    await expect(new PostgresRenderTaskRepository({ query } as never).enqueue(input)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  }
});
test.each([false, true])('1: production enqueue preserves lane compatibility: %s', async lane => {
  process.env.LINE_TEST_MODE = 'false'; process.env.RENDER_LANE_ENABLED = String(lane);
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: false }] }).mockResolvedValue({ rows: [task] });
  await new PostgresRenderTaskRepository({ query } as never).enqueue(input);
  expect(query.mock.calls[1][1][7]).toBe('queued');
  expect(query.mock.calls[1][0].includes('render_lane')).toBe(lane);
});
test.each([[false, false], [false, true], [true, false]])('1: claims enforce ownership mode=%s lane=%s', async (mode, lane) => {
  process.env.LINE_TEST_MODE = String(mode); process.env.RENDER_LANE_ENABLED = String(lane);
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.claimNext('worker', 60);
  expect(query.mock.calls[0][0]).toContain('cr.id::text = render_tasks.request_id');
  expect(query.mock.calls[0][0]).toContain(`COALESCE(cr.is_test, FALSE) = ${mode ? 'TRUE' : 'FALSE'}`);
});
test.each([false, true])('2: all claim transitions require claimed state and request ownership mode=%s', async mode => {
  process.env.LINE_TEST_MODE = String(mode);
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const repo = new PostgresRenderTaskRepository({ query } as never);
  await repo.touch('t'); await repo.complete('t', 'done'); await repo.complete('t', 'failed');
  await repo.release('t'); await repo.release('t');
  expect(await repo.touchClaim('t', 'owner')).toBe(false);
  expect(await repo.completeClaim('t', 'owner')).toBe(false);
  expect(await repo.releaseClaim('t', 'owner')).toBe(false);
  for (const [sql] of query.mock.calls) {
    expect(sql).toContain(`state = '${mode ? 'test_claimed' : 'claimed'}'`);
    expect(sql).toContain(`COALESCE(cr.is_test, FALSE) = ${mode ? 'TRUE' : 'FALSE'}`);
  }
  for (const [sql, params] of query.mock.calls.slice(5)) {
    expect(sql).toContain('claimed_by = $2'); expect(params).toEqual(['t', 'owner']);
  }
});
test('5: empty insert uses fresh SELECT and preserves the existing claimed task', async () => {
  process.env.LINE_TEST_MODE = 'false';
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: true }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [task] });
  const result = await new PostgresRenderTaskRepository({ query } as never).enqueue(input);
  expect(result.state).toBe('test_claimed'); expect(result.attempts).toBe(4);
  expect(query.mock.calls[2][0]).toMatch(/^SELECT/);
  expect(query.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/UPDATE/);
});
test('5: concurrent completion retries insert; persistent contention is bounded', async () => {
  process.env.LINE_TEST_MODE = 'false';
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ is_test: false }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [task] });
  await new PostgresRenderTaskRepository({ query } as never).enqueue(input);
  expect(query).toHaveBeenCalledTimes(4);
  query.mockReset().mockResolvedValueOnce({ rows: [{ is_test: false }] }).mockResolvedValue({ rows: [] });
  await expect(new PostgresRenderTaskRepository({ query } as never).enqueue(input)).rejects.toThrow('retry limit');
  expect(query).toHaveBeenCalledTimes(7);
});
test.each([false, true])('3/4: TEXT asset joins and expiry ownership mode=%s', async mode => {
  process.env.LINE_TEST_MODE = String(mode);
  const query = jest.fn().mockResolvedValue({ rows: [{ asset_id: 'opaque/photo' }] });
  const repo = new PostgresAssetVisualAnalysisRepository({ query } as never);
  expect(await repo.claim('1')).toBe('opaque/photo');
  expect(await repo.expireClaims('1', 90)).toEqual(['opaque/photo']);
  for (const [sql] of query.mock.calls) {
    expect(sql).toContain('ua.id = ava.asset_id'); expect(sql).not.toContain('asset_id::uuid');
    expect(sql).toContain('cr.is_test');
  }
  expect(query.mock.calls[1][1]).toEqual(['1', 90, mode]);
  expect(query.mock.calls[1][0]).toContain('RETURNING ava.asset_id');
  expect(query.mock.calls[1][0]).toContain('FALSE) = $3::boolean');
});
test('7: startup fails closed on missing or invalid unique indices', async () => {
  const { checkPhase2Schema } = require('../../scripts/check-phase2-schema.cjs');
  const names = ['uq_render_tasks_active_test_job', 'uq_render_tasks_active_all_job'];
  const rows = names.map(name => ({ name, indisunique: true, indisvalid: true,
    key: 'job_id', indnkeyatts: 1, indnatts: 1,
    predicate: name.includes('test_job') ? "state IN ('test_queued', 'test_claimed')" : "state IN ('queued', 'claimed', 'test_queued', 'test_claimed')" }));
  await expect(checkPhase2Schema({ query: async () => ({ rows }) })).resolves.toBeUndefined();
  for (const invalid of [[], rows.slice(0, 1), rows.map(row => ({ ...row, indisvalid: false }))]) {
    await expect(checkPhase2Schema({ query: async () => ({ rows: invalid }) })).rejects.toThrow('prerequisite');
  }
  const startup = fs.readFileSync('scripts/phase2-start.ps1', 'utf8');
  expect(startup.indexOf('node scripts/check-phase2-schema.cjs')).toBeLessThan(startup.indexOf('Start-Process'));
  const migration = fs.readFileSync('src/db/migrations/058_render_task_active_namespace.sql', 'utf8');
  expect(migration).toContain("WHERE state IN ('queued', 'claimed', 'test_queued', 'test_claimed')");
  expect(migration).not.toMatch(/DELETE|DROP|UPDATE/);
});
