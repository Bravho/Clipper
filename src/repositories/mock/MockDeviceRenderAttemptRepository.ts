import type { IDeviceRenderAttemptRepository } from "@/repositories/interfaces/IDeviceRenderAttemptRepository";
import type {
  CreateDeviceRenderAttemptInput,
  DeviceRenderAttempt,
  UpdateDeviceRenderAttemptInput,
} from "@/domain/models/DeviceRenderAttempt";

/**
 * In-memory device render attempts.
 *
 * Tests construct this directly with a fresh `new Map()`, following the pattern
 * every other mock repository uses, so no test can see another test's attempts.
 */
export class MockDeviceRenderAttemptRepository implements IDeviceRenderAttemptRepository {
  constructor(private readonly store: Map<string, DeviceRenderAttempt> = new Map()) {}

  async create(input: CreateDeviceRenderAttemptInput): Promise<DeviceRenderAttempt> {
    if (this.store.has(input.id)) {
      throw new Error(`Device render attempt already exists: ${input.id}`);
    }
    const now = new Date();
    const attempt: DeviceRenderAttempt = {
      ...input,
      state: "claimed",
      progressPercent: null,
      resultAssetId: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(attempt.id, attempt);
    return { ...attempt };
  }

  async findById(id: string): Promise<DeviceRenderAttempt | null> {
    const attempt = this.store.get(id);
    return attempt ? { ...attempt } : null;
  }

  async findActiveByTask(taskId: string): Promise<DeviceRenderAttempt | null> {
    const active = [...this.store.values()]
      .filter((a) => a.taskId === taskId && (a.state === "claimed" || a.state === "uploading"))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return active[0] ? { ...active[0] } : null;
  }

  async listByRequest(requestId: string): Promise<DeviceRenderAttempt[]> {
    return [...this.store.values()]
      .filter((a) => a.requestId === requestId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((a) => ({ ...a }));
  }

  async update(
    id: string,
    updates: UpdateDeviceRenderAttemptInput
  ): Promise<DeviceRenderAttempt | null> {
    const attempt = this.store.get(id);
    if (!attempt) return null;
    const next: DeviceRenderAttempt = { ...attempt, ...updates, updatedAt: new Date() };
    this.store.set(id, next);
    return { ...next };
  }

  async completeOnce(
    id: string,
    result: { resultAssetId: string | null; result: Record<string, unknown> }
  ): Promise<{ attempt: DeviceRenderAttempt; firstCompletion: boolean } | null> {
    const attempt = this.store.get(id);
    if (!attempt) return null;

    // Already completed: hand back what was stored. Never a second asset.
    if (attempt.state === "completed") {
      return { attempt: { ...attempt }, firstCompletion: false };
    }

    const next: DeviceRenderAttempt = {
      ...attempt,
      state: "completed",
      progressPercent: 100,
      resultAssetId: result.resultAssetId,
      result: result.result,
      error: null,
      updatedAt: new Date(),
    };
    this.store.set(id, next);
    return { attempt: { ...next }, firstCompletion: true };
  }

  async expireStale(now: Date): Promise<number> {
    let swept = 0;
    for (const [id, attempt] of this.store) {
      if (
        (attempt.state === "claimed" || attempt.state === "uploading") &&
        attempt.leaseExpiresAt.getTime() < now.getTime()
      ) {
        this.store.set(id, { ...attempt, state: "expired", updatedAt: now });
        swept++;
      }
    }
    return swept;
  }
}
