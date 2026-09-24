import { pool } from "@/lib/db";
import type { IDeviceRenderAttemptRepository } from "@/repositories/interfaces/IDeviceRenderAttemptRepository";
import type {
  CreateDeviceRenderAttemptInput,
  DeviceRenderAttempt,
  DeviceRenderAttemptState,
  UpdateDeviceRenderAttemptInput,
} from "@/domain/models/DeviceRenderAttempt";
import type { RenderStep } from "@/domain/enums/RenderStep";
import type {
  DeviceRenderRatio,
  DeviceRenderStage,
} from "@/lib/mobile/deviceRenderContract";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToAttempt(row: Record<string, unknown>): DeviceRenderAttempt {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    jobId: row.job_id as string,
    requestId: row.request_id as string,
    requesterId: row.requester_id as string,
    step: row.step as RenderStep,
    ratio: row.ratio as DeviceRenderRatio,
    stage: row.stage as DeviceRenderStage,
    travy: Boolean(row.travy),
    manifestVersion: Number(row.manifest_version),
    platform: (row.platform as "ios" | "android" | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    state: row.state as DeviceRenderAttemptState,
    progressPercent: row.progress_percent == null ? null : Number(row.progress_percent),
    uploadStorageKey: row.upload_storage_key as string,
    uploadId: (row.upload_id as string | null) ?? null,
    resultAssetId: (row.result_asset_id as string | null) ?? null,
    result: parseJson<Record<string, unknown> | null>(row.result, null),
    error: (row.error as string | null) ?? null,
    leaseExpiresAt: new Date(row.lease_expires_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/** Requires migration 035. */
export class PostgresDeviceRenderAttemptRepository implements IDeviceRenderAttemptRepository {
  private readonly db = pool;

  async create(input: CreateDeviceRenderAttemptInput): Promise<DeviceRenderAttempt> {
    const { rows } = await this.db.query(
      `INSERT INTO device_render_attempts
         (id, task_id, job_id, request_id, requester_id, step, ratio, stage, travy,
          manifest_version, platform, app_version, state, upload_storage_key,
          upload_id, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'claimed',$13,$14,$15)
       RETURNING *`,
      [
        input.id,
        input.taskId,
        input.jobId,
        input.requestId,
        input.requesterId,
        input.step,
        input.ratio,
        input.stage,
        input.travy,
        input.manifestVersion,
        input.platform,
        input.appVersion,
        input.uploadStorageKey,
        input.uploadId,
        input.leaseExpiresAt,
      ]
    );
    return rowToAttempt(rows[0]);
  }

  async findById(id: string): Promise<DeviceRenderAttempt | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM device_render_attempts WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToAttempt(rows[0]) : null;
  }

  async findActiveByTask(taskId: string): Promise<DeviceRenderAttempt | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM device_render_attempts
        WHERE task_id = $1 AND state IN ('claimed','uploading')
        ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );
    return rows[0] ? rowToAttempt(rows[0]) : null;
  }

  async listByRequest(requestId: string): Promise<DeviceRenderAttempt[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM device_render_attempts
        WHERE request_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [requestId]
    );
    return rows.map(rowToAttempt);
  }

  async update(
    id: string,
    updates: UpdateDeviceRenderAttemptInput
  ): Promise<DeviceRenderAttempt | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (updates.state !== undefined) push("state", updates.state);
    if (updates.progressPercent !== undefined) push("progress_percent", updates.progressPercent);
    if (updates.resultAssetId !== undefined) push("result_asset_id", updates.resultAssetId);
    if (updates.result !== undefined) {
      push("result", updates.result == null ? null : JSON.stringify(updates.result));
    }
    if (updates.error !== undefined) push("error", updates.error);
    if (updates.leaseExpiresAt !== undefined) push("lease_expires_at", updates.leaseExpiresAt);
    if (updates.uploadId !== undefined) push("upload_id", updates.uploadId);

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE device_render_attempts
          SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    return rows[0] ? rowToAttempt(rows[0]) : null;
  }

  async completeOnce(
    id: string,
    result: { resultAssetId: string | null; result: Record<string, unknown> }
  ): Promise<{ attempt: DeviceRenderAttempt; firstCompletion: boolean } | null> {
    // One statement, so two concurrent retries cannot both see "not completed".
    // The guarded UPDATE returns a row only for the caller that actually
    // transitioned the attempt; everyone else falls through to the read below.
    const { rows } = await this.db.query(
      `UPDATE device_render_attempts
          SET state = 'completed',
              progress_percent = 100,
              result_asset_id = $2,
              result = $3,
              error = NULL,
              updated_at = NOW()
        WHERE id = $1 AND state <> 'completed'
       RETURNING *`,
      [id, result.resultAssetId, JSON.stringify(result.result)]
    );
    if (rows[0]) return { attempt: rowToAttempt(rows[0]), firstCompletion: true };

    const existing = await this.findById(id);
    if (!existing) return null;
    return { attempt: existing, firstCompletion: false };
  }

  async expireStale(now: Date): Promise<number> {
    const result = await this.db.query(
      `UPDATE device_render_attempts
          SET state = 'expired', updated_at = NOW()
        WHERE state IN ('claimed','uploading') AND lease_expires_at < $1`,
      [now]
    );
    return result.rowCount ?? 0;
  }
}
