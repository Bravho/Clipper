import { MockRenderTaskRepository } from '@/repositories/mock/MockRenderTaskRepository';
import { RenderStep } from '@/domain/enums/RenderStep';

function makeRepo() {
  return new MockRenderTaskRepository(new Map());
}

const BASE_ENQUEUE = {
  jobId: 'job-001',
  requestId: 'req-001',
  step: RenderStep.FfmpegComposition,
  payload: null,
};

describe('RenderQueue lane routing', () => {
  it('Mac Mini (no lane) never sees operator_pc tasks', async () => {
    const repo = makeRepo();
    await repo.enqueue({ ...BASE_ENQUEUE, renderLane: 'operator_pc' });

    const claimed = await repo.claimNext('mac-mini-worker', 60, undefined);
    expect(claimed).toBeNull();
  });

  it('Mac Mini claims tasks with no render lane', async () => {
    const repo = makeRepo();
    await repo.enqueue({ ...BASE_ENQUEUE, renderLane: null });

    const claimed = await repo.claimNext('mac-mini-worker', 60, undefined);
    expect(claimed).not.toBeNull();
    expect(claimed?.renderLane).toBeNull();
  });

  it('operator_pc worker only claims its own lane', async () => {
    const repo = makeRepo();
    // Enqueue one server task (null lane) and one operator_pc task
    await repo.enqueue({ ...BASE_ENQUEUE, jobId: 'job-server', renderLane: null });
    await repo.enqueue({ ...BASE_ENQUEUE, jobId: 'job-line', renderLane: 'operator_pc' });

    const claimed = await repo.claimNext('mar-pc-worker', 60, 'operator_pc');
    expect(claimed).not.toBeNull();
    expect(claimed?.renderLane).toBe('operator_pc');
    expect(claimed?.jobId).toBe('job-line');
  });

  it('operator_pc worker does NOT claim null-lane tasks', async () => {
    const repo = makeRepo();
    await repo.enqueue({ ...BASE_ENQUEUE, renderLane: null });

    const claimed = await repo.claimNext('mar-pc-worker', 60, 'operator_pc');
    expect(claimed).toBeNull();
  });

  it('enqueued task records renderLane correctly', async () => {
    const repo = makeRepo();
    const task = await repo.enqueue({ ...BASE_ENQUEUE, renderLane: 'operator_pc' });
    expect(task.renderLane).toBe('operator_pc');
  });

  it('null renderLane task is not claimed by operator_pc lane', async () => {
    const repo = makeRepo();
    await repo.enqueue({ ...BASE_ENQUEUE, renderLane: null });

    const claimed = await repo.claimNext('worker', 60, 'operator_pc');
    expect(claimed).toBeNull();
  });

  it('multiple workers on different lanes can claim concurrently', async () => {
    const repo = makeRepo();
    await repo.enqueue({ ...BASE_ENQUEUE, jobId: 'j1', renderLane: null });
    await repo.enqueue({ ...BASE_ENQUEUE, jobId: 'j2', renderLane: 'operator_pc' });

    const macClaim = await repo.claimNext('mac', 60, undefined);
    const marClaim = await repo.claimNext('mar', 60, 'operator_pc');

    expect(macClaim?.jobId).toBe('j1');
    expect(marClaim?.jobId).toBe('j2');
  });
});
