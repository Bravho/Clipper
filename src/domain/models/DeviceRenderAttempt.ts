import type { RenderStep } from "@/domain/enums/RenderStep";
import type {
  DeviceRenderRatio,
  DeviceRenderStage,
} from "@/lib/mobile/deviceRenderContract";

/**
 * One attempt by ONE phone to render ONE queued render task.
 *
 * WHY THIS IS ITS OWN RECORD. `render_tasks` already has a claim
 * (`claimed_by` = the attempt id), but a claim is a lock, not a receipt. Three
 * things need a receipt:
 *
 *   - IDEMPOTENT COMPLETION. A phone that uploads its export and then loses the
 *     network retries the completion. The second call must return the FIRST
 *     result — the same asset, not a second `FinalClip` pointing at a second
 *     object in Spaces.
 *   - HONEST VALIDATION. Completion has to be checked against what was actually
 *     handed out: this job, this step, this ratio, this stage, this manifest
 *     version, this upload key. Without a record the server would have to trust
 *     the body it is validating.
 *   - LOSING A RACE SAFELY. A lease expires, the Mac worker reclaims the task
 *     and finishes it. The phone, unaware, comes back with its own output. The
 *     attempt is no longer the claim owner, so the completion is refused and the
 *     worker's result stands.
 */
export type DeviceRenderAttemptState =
  | "claimed"
  | "uploading"
  | "completed"
  | "released"
  | "failed"
  | "expired";

export interface DeviceRenderAttempt {
  /** The attempt id, which is also the render task's `claimed_by` value. */
  id: string;
  taskId: string;
  jobId: string;
  requestId: string;
  /** The owning requester. A device may only ever claim its own work. */
  requesterId: string;
  step: RenderStep;
  ratio: DeviceRenderRatio;
  stage: DeviceRenderStage;
  travy: boolean;
  manifestVersion: number;
  platform: "ios" | "android" | null;
  /** App build identifier, for support and cohort metrics. */
  appVersion: string | null;
  state: DeviceRenderAttemptState;
  /** 0–100, last reported by the device. */
  progressPercent: number | null;
  /** The ONLY key this attempt is authorised to write. */
  uploadStorageKey: string;
  uploadId: string | null;
  /** Set once the server has verified the object and created the asset. */
  resultAssetId: string | null;
  /** The completion response, replayed verbatim on a repeat completion. */
  result: Record<string, unknown> | null;
  error: string | null;
  leaseExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeviceRenderAttemptInput {
  id: string;
  taskId: string;
  jobId: string;
  requestId: string;
  requesterId: string;
  step: RenderStep;
  ratio: DeviceRenderRatio;
  stage: DeviceRenderStage;
  travy: boolean;
  manifestVersion: number;
  platform: "ios" | "android" | null;
  appVersion: string | null;
  uploadStorageKey: string;
  uploadId: string | null;
  leaseExpiresAt: Date;
}

export type UpdateDeviceRenderAttemptInput = Partial<
  Pick<
    DeviceRenderAttempt,
    | "state"
    | "progressPercent"
    | "resultAssetId"
    | "result"
    | "error"
    | "leaseExpiresAt"
    | "uploadId"
  >
>;
