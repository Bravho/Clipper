import { IVideoGenerationJobRepository } from "@/repositories/interfaces/IVideoGenerationJobRepository";
import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";

// TODO: PostgreSQL — replace this entire class with PostgresVideoGenerationJobRepository.

declare global {
  // eslint-disable-next-line no-var
  var __mockVideoGenerationJobStore: Map<string, VideoGenerationJob> | undefined;
  // eslint-disable-next-line no-var
  var __mockVideoGenerationStepHistory: VideoGenerationStepHistoryEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __mockRenderWorkerHeartbeats: Map<string, number> | undefined;
}

function getHeartbeats(): Map<string, number> {
  if (!global.__mockRenderWorkerHeartbeats) {
    global.__mockRenderWorkerHeartbeats = new Map();
  }
  return global.__mockRenderWorkerHeartbeats;
}

function getStore(): Map<string, VideoGenerationJob> {
  if (!global.__mockVideoGenerationJobStore) {
    global.__mockVideoGenerationJobStore = new Map();
  }
  return global.__mockVideoGenerationJobStore;
}

export class MockVideoGenerationJobRepository
  implements IVideoGenerationJobRepository
{
  private store: Map<string, VideoGenerationJob>;
  private history: VideoGenerationStepHistoryEntry[];

  constructor(
    store?: Map<string, VideoGenerationJob>,
    history?: VideoGenerationStepHistoryEntry[]
  ) {
    this.store = store ?? getStore();
    if (history) {
      this.history = history;
    } else {
      if (!global.__mockVideoGenerationStepHistory) {
        global.__mockVideoGenerationStepHistory = [];
      }
      this.history = global.__mockVideoGenerationStepHistory;
    }
  }

  private recordStep(job: VideoGenerationJob): void {
    this.history.push({
      id: crypto.randomUUID(),
      jobId: job.id,
      requestId: job.requestId,
      step: job.currentStep,
      sceneIndex: job.currentSceneIndex ?? null,
      createdAt: new Date(),
    });
  }

  async findById(id: string): Promise<VideoGenerationJob | null> {
    return this.store.has(id) ? { ...this.store.get(id)! } : null;
  }

  async findByRequestId(requestId: string): Promise<VideoGenerationJob | null> {
    for (const job of this.store.values()) {
      if (job.requestId === requestId) return { ...job };
    }
    return null;
  }

  async create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob> {
    const now = new Date();
    const job: VideoGenerationJob = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(job.id, job);
    this.recordStep(job);
    return { ...job };
  }

  async update(
    id: string,
    input: UpdateVideoGenerationJobInput
  ): Promise<VideoGenerationJob> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`VideoGenerationJob not found: ${id}`);
    const updated: VideoGenerationJob = {
      ...existing,
      ...input,
      id,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    if (input.currentStep !== undefined) this.recordStep(updated);
    return { ...updated };
  }

  async listStepHistory(jobId: string): Promise<VideoGenerationStepHistoryEntry[]> {
    return this.history
      .filter((entry) => entry.jobId === jobId)
      .map((entry) => ({ ...entry }));
  }

  // ── Render-queue seam (Mac Mini worker offload) ─────────────────────────────
  // Heartbeats live in a process-global map so a worker and the web side (which
  // construct separate instances) share liveness. Tests that never record a
  // heartbeat see `isRenderWorkerAlive` → false, so heavy steps run inline
  // exactly as before the seam existed.

  async recordWorkerHeartbeat(workerId: string): Promise<void> {
    getHeartbeats().set(workerId, Date.now());
  }

  async isRenderWorkerAlive(freshSeconds: number): Promise<boolean> {
    const cutoff = Date.now() - freshSeconds * 1000;
    for (const seen of getHeartbeats().values()) {
      if (seen > cutoff) return true;
    }
    return false;
  }

  async claimNextQueuedRenderStep(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<VideoGenerationJob | null> {
    const staleBefore = Date.now() - staleClaimSeconds * 1000;
    const candidates = [...this.store.values()].filter((j) => {
      if (j.renderState === "queued") return true;
      if (j.renderState === "claimed") {
        const keepAlive = (j.renderHeartbeatAt ?? j.claimedAt)?.getTime() ?? 0;
        return keepAlive < staleBefore;
      }
      return false;
    });
    candidates.sort(
      (a, b) => (a.claimedAt?.getTime() ?? 0) - (b.claimedAt?.getTime() ?? 0)
    );
    const next = candidates[0];
    if (!next) return null;
    const now = new Date();
    const claimed: VideoGenerationJob = {
      ...next,
      renderState: "claimed",
      claimedBy: workerId,
      claimedAt: now,
      renderHeartbeatAt: now,
      updatedAt: now,
    };
    this.store.set(next.id, claimed);
    return { ...claimed };
  }

  async touchRenderClaim(jobId: string): Promise<void> {
    const job = this.store.get(jobId);
    if (job && job.renderState === "claimed") {
      this.store.set(jobId, { ...job, renderHeartbeatAt: new Date() });
    }
  }

  async completeRenderClaim(jobId: string, state: "done" | "failed"): Promise<void> {
    const job = this.store.get(jobId);
    if (job) {
      this.store.set(jobId, {
        ...job,
        renderState: state,
        renderHeartbeatAt: new Date(),
      });
    }
  }
}
