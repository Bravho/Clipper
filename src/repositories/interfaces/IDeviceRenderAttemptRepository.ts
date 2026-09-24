import type {
  CreateDeviceRenderAttemptInput,
  DeviceRenderAttempt,
  UpdateDeviceRenderAttemptInput,
} from "@/domain/models/DeviceRenderAttempt";

/** Data access for phone render attempts. See the model for why they exist. */
export interface IDeviceRenderAttemptRepository {
  create(input: CreateDeviceRenderAttemptInput): Promise<DeviceRenderAttempt>;

  findById(id: string): Promise<DeviceRenderAttempt | null>;

  /** The attempt currently holding a lease on a task, if any. */
  findActiveByTask(taskId: string): Promise<DeviceRenderAttempt | null>;

  /** Every attempt for a request, newest first — support and admin drill-down. */
  listByRequest(requestId: string): Promise<DeviceRenderAttempt[]>;

  update(
    id: string,
    updates: UpdateDeviceRenderAttemptInput
  ): Promise<DeviceRenderAttempt | null>;

  /**
   * Record a completion exactly once.
   *
   * Returns the attempt as it now stands. If the attempt was ALREADY completed,
   * the stored result is returned untouched and `firstCompletion` is false —
   * this is the idempotency guarantee the completion endpoint depends on, and
   * it has to live in the repository so two concurrent retries cannot both
   * create an asset.
   */
  completeOnce(
    id: string,
    result: { resultAssetId: string | null; result: Record<string, unknown> }
  ): Promise<{ attempt: DeviceRenderAttempt; firstCompletion: boolean } | null>;

  /**
   * Move every `claimed`/`uploading` attempt whose lease has passed to
   * `expired`. Returns how many were swept, for the ops log.
   */
  expireStale(now: Date): Promise<number>;
}
