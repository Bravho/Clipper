import { IRenderTaskRepository } from "@/repositories/interfaces/IRenderTaskRepository";
import {
  RenderTask,
  RenderTaskState,
  EnqueueRenderTaskInput,
} from "@/domain/models/RenderTask";

// TODO: PostgreSQL — this mock mirrors PostgresRenderTaskRepository's SQL
// behaviour (FIFO claim, stale reclaim, position count) for unit tests.

declare global {
  // eslint-disable-next-line no-var
  var __mockRenderTaskStore: Map<string, RenderTask> | undefined;
}

function getStore(): Map<string, RenderTask> {
  if (!global.__mockRenderTaskStore) {
    global.__mockRenderTaskStore = new Map();
  }
  return global.__mockRenderTaskStore;
}

/** Active = still in the line (waiting or rendering). */
function isActive(t: RenderTask): boolean {
  return t.state === "queued" || t.state === "claimed";
}

export class MockRenderTaskRepository implements IRenderTaskRepository {
  private store: Map<string, RenderTask>;

  constructor(store?: Map<string, RenderTask>) {
    this.store = store ?? getStore();
  }

  private activeSorted(): RenderTask[] {
    return [...this.store.values()]
      .filter(isActive)
      .sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime());
  }

  async enqueue(input: EnqueueRenderTaskInput): Promise<RenderTask> {
    // Idempotent per job: replace any existing active task for this job so we
    // never stack two queued steps for the same job.
    for (const [id, t] of this.store) {
      if (t.jobId === input.jobId && isActive(t)) this.store.delete(id);
    }
    const now = new Date();
    const task: RenderTask = {
      id: crypto.randomUUID(),
      jobId: input.jobId,
      requestId: input.requestId,
      requesterId: input.requesterId ?? null,
      step: input.step,
      payload: input.payload ?? null,
      state: "queued",
      attempts: 0,
      enqueuedAt: now,
      claimedBy: null,
      claimedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(task.id, task);
    return { ...task };
  }

  async claimNext(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<RenderTask | null> {
    const staleBefore = Date.now() - staleClaimSeconds * 1000;
    const candidates = [...this.store.values()]
      .filter((t) => {
        if (t.state === "queued") return true;
        if (t.state === "claimed") {
          const keepAlive = (t.heartbeatAt ?? t.claimedAt)?.getTime() ?? 0;
          return keepAlive < staleBefore;
        }
        return false;
      })
      // FIFO: oldest enqueued first.
      .sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime());

    const next = candidates[0];
    if (!next) return null;

    const now = new Date();
    const claimed: RenderTask = {
      ...next,
      state: "claimed",
      claimedBy: workerId,
      claimedAt: now,
      heartbeatAt: now,
      startedAt: next.startedAt ?? now,
      attempts: next.attempts + 1,
      updatedAt: now,
    };
    this.store.set(next.id, claimed);
    return { ...claimed };
  }

  async touch(taskId: string): Promise<void> {
    const t = this.store.get(taskId);
    if (t && t.state === "claimed") {
      this.store.set(taskId, { ...t, heartbeatAt: new Date(), updatedAt: new Date() });
    }
  }

  async complete(
    taskId: string,
    state: Extract<RenderTaskState, "done" | "failed">,
    error?: string | null
  ): Promise<void> {
    const t = this.store.get(taskId);
    if (!t) return;
    const now = new Date();
    const durationMs =
      t.durationMs ?? (t.startedAt ? now.getTime() - t.startedAt.getTime() : null);
    this.store.set(taskId, {
      ...t,
      state,
      finishedAt: now,
      durationMs,
      error: error ?? t.error,
      updatedAt: now,
    });
  }

  async release(taskId: string): Promise<void> {
    const t = this.store.get(taskId);
    if (!t) return;
    this.store.set(taskId, {
      ...t,
      state: "queued",
      claimedBy: null,
      claimedAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    });
  }

  async findActiveByJob(jobId: string): Promise<RenderTask | null> {
    for (const t of this.store.values()) {
      if (t.jobId === jobId && isActive(t)) return { ...t };
    }
    return null;
  }

  async findActiveByRequest(requestId: string): Promise<RenderTask | null> {
    for (const t of this.store.values()) {
      if (t.requestId === requestId && isActive(t)) return { ...t };
    }
    return null;
  }

  async countAhead(taskId: string): Promise<number | null> {
    const target = this.store.get(taskId);
    if (!target || !isActive(target)) return null;
    const at = target.enqueuedAt.getTime();
    let ahead = 0;
    for (const t of this.store.values()) {
      if (t.id === taskId || !isActive(t)) continue;
      if (t.enqueuedAt.getTime() < at) ahead += 1;
    }
    return ahead;
  }

  async listActive(): Promise<RenderTask[]> {
    return this.activeSorted().map((t) => ({ ...t }));
  }

  async findLatestByJob(jobId: string): Promise<RenderTask | null> {
    const latest = [...this.store.values()]
      .filter((t) => t.jobId === jobId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return latest ? { ...latest } : null;
  }
}
