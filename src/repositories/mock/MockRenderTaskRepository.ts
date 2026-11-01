import { IRenderTaskRepository } from "@/repositories/interfaces/IRenderTaskRepository";
import {
  RenderTask,
  RenderTaskState,
  EnqueueRenderTaskInput,
} from "@/domain/models/RenderTask";
import { RenderStep } from "@/domain/enums/RenderStep";
import { compareRenderOrder } from "@/config/renderQueue";
import { isLineTestMode } from "@/config/reviewSystem";

// TODO: PostgreSQL — this mock mirrors PostgresRenderTaskRepository's SQL
// behaviour (priority + ageing claim order, stale reclaim, position count) for
// unit tests. Ordering goes through the shared `compareRenderOrder` so the mock
// and the SQL expression cannot drift apart.

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

/** Returns the active-state pair for the current mode. */
function activeStatePair(): [RenderTaskState, RenderTaskState] {
  return isLineTestMode()
    ? ["test_queued", "test_claimed"]
    : ["queued", "claimed"];
}

/** Active = still in the line for the current mode's worker. */
function isActive(t: RenderTask): boolean {
  return (
    t.state === "queued" ||
    t.state === "claimed" ||
    t.state === "test_queued" ||
    t.state === "test_claimed"
  );
}

/** Active = visible to the CURRENT mode's worker specifically. */
function isActiveForMode(t: RenderTask): boolean {
  const [stateA, stateB] = activeStatePair();
  return t.state === stateA || t.state === stateB;
}

export class MockRenderTaskRepository implements IRenderTaskRepository {
  private store: Map<string, RenderTask>;

  constructor(store?: Map<string, RenderTask>) {
    this.store = store ?? getStore();
  }

  private activeSorted(): RenderTask[] {
    return [...this.store.values()].filter(isActiveForMode).sort(compareRenderOrder);
  }

  async enqueue(input: EnqueueRenderTaskInput): Promise<RenderTask> {
    const [stateA, stateB] = activeStatePair();
    // DO NOTHING: if an active task already exists for this job in the current
    // mode's namespace, return it unchanged (mirrors PostgreSQL ON CONFLICT DO NOTHING).
    for (const t of this.store.values()) {
      if (t.jobId === input.jobId && (t.state === stateA || t.state === stateB)) {
        return { ...t };
      }
    }
    const now = new Date();
    const task: RenderTask = {
      id: crypto.randomUUID(),
      jobId: input.jobId,
      requestId: input.requestId,
      requesterId: input.requesterId ?? null,
      step: input.step,
      payload: input.payload ?? null,
      state: stateA,
      attempts: 0,
      priority: input.priority ?? 0,
      deviceOnly: input.deviceOnly ?? false,
      renderLane: input.renderLane ?? null,
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
    staleClaimSeconds: number,
    lane?: string | null
  ): Promise<RenderTask | null> {
    const staleBefore = Date.now() - staleClaimSeconds * 1000;
    const [stateA, stateB] = activeStatePair();
    const candidates = [...this.store.values()]
      .filter((t) => {
        // The worker has no copy of a device-held request's footage, so a
        // claim here could only ever end in a failed step. Excluding it from
        // the CLAIM makes that impossible rather than merely handled.
        if (t.deviceOnly) return false;
        // Test worker claims only test-namespace tasks; non-test claims only production.
        if (t.state !== stateA && t.state !== stateB) return false;
        // Lane routing (production mode only — test mode uses state-based isolation).
        if (!isLineTestMode()) {
          if (lane != null) {
            if (t.renderLane !== lane) return false;
          } else {
            if (t.renderLane === 'operator_pc') return false;
          }
        }
        if (t.state === stateA) return true;
        if (t.state === stateB) {
          const keepAlive = (t.heartbeatAt ?? t.claimedAt)?.getTime() ?? 0;
          return keepAlive < staleBefore;
        }
        return false;
      })
      // Highest effective priority first, oldest first within a priority.
      .sort(compareRenderOrder);

    const next = candidates[0];
    if (!next) return null;

    const now = new Date();
    const claimed: RenderTask = {
      ...next,
      state: stateB,
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

  async claimForDevice(
    taskId: string,
    requesterId: string,
    deviceClaimId: string,
    allowedSteps: RenderStep[]
  ): Promise<RenderTask | null> {
    const task = this.store.get(taskId);
    if (
      !task ||
      task.state !== "queued" ||
      task.requesterId !== requesterId ||
      // A device-only task exists BECAUSE its footage is on this requester's
      // phone and nowhere else, so the eligible-step list — which limits what a
      // phone may opportunistically take from the worker — does not apply.
      !(task.deviceOnly || allowedSteps.includes(task.step))
    ) {
      return null;
    }
    const now = new Date();
    const claimed: RenderTask = {
      ...task, state: "claimed", claimedBy: deviceClaimId,
      claimedAt: now, heartbeatAt: now, startedAt: task.startedAt ?? now,
      attempts: task.attempts + 1, updatedAt: now,
    };
    this.store.set(taskId, claimed);
    return { ...claimed };
  }

  async touchClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const task = this.store.get(taskId);
    if (!task || !["claimed", "test_claimed"].includes(task.state) || task.claimedBy !== deviceClaimId) return false;
    this.store.set(taskId, { ...task, heartbeatAt: new Date(), updatedAt: new Date() });
    return true;
  }

  async completeClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const task = this.store.get(taskId);
    if (!task || !["claimed", "test_claimed"].includes(task.state) || task.claimedBy !== deviceClaimId) return false;
    await this.complete(taskId, "done");
    return true;
  }

  async releaseClaim(taskId: string, deviceClaimId: string): Promise<boolean> {
    const task = this.store.get(taskId);
    if (!task || !["claimed", "test_claimed"].includes(task.state) || task.claimedBy !== deviceClaimId) return false;
    await this.release(taskId);
    return true;
  }

  async touch(taskId: string): Promise<void> {
    const t = this.store.get(taskId);
    if (t && ["claimed", "test_claimed"].includes(t.state)) {
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
    // Preserve test namespace: test_claimed → test_queued, claimed → queued.
    const newState: RenderTaskState = t.state === "test_claimed" ? "test_queued" : "queued";
    this.store.set(taskId, {
      ...t,
      state: newState,
      claimedBy: null,
      claimedAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    });
  }

  async findActiveByJob(jobId: string): Promise<RenderTask | null> {
    for (const t of this.store.values()) {
      if (t.jobId === jobId && isActiveForMode(t)) return { ...t };
    }
    return null;
  }

  async findActiveByRequest(requestId: string): Promise<RenderTask | null> {
    for (const t of this.store.values()) {
      if (t.requestId === requestId && isActiveForMode(t)) return { ...t };
    }
    return null;
  }

  async countAhead(taskId: string): Promise<number | null> {
    const target = this.store.get(taskId);
    if (!target || !isActiveForMode(target)) return null;
    // Tasks that would be CLAIMED first — not merely enqueued earlier. With
    // priorities those differ, and the enqueue-time count would understate the
    // wait for a low-priority task sitting behind a stream of paid work.
    let ahead = 0;
    for (const t of this.store.values()) {
      if (t.id === taskId || !isActiveForMode(t)) continue;
      if (compareRenderOrder(t, target) < 0) ahead += 1;
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
