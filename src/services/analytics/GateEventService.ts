import { pool } from "@/lib/db";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/**
 * Pipeline review-gate recorder (migration 028, `pipeline_gate_events`).
 *
 * WHY this exists rather than being derived from `video_generation_step_history`:
 * the scene-plan express lane (`autoApproveRemaining`, migration 026) clears the
 * later gates on the requester's behalf, and `_autoAdvanceIfEnabled()` deliberately
 * reuses an existing approver id so the `*_approved_by` audit columns are never
 * blanked. The resulting step-history rows are byte-for-byte indistinguishable
 * from a human click, so "how long do requesters actually take at each gate" and
 * "what share of approvals were human" could not be answered. This table records
 * the actor and the open → resolve latency explicitly.
 *
 * One row per gate OPENING, closed in place when the gate resolves.
 *
 * EVERY method swallows its errors. Analytics must never break the pipeline
 * transition it is describing — the same contract `_recordStepHistory` follows.
 */

/** How a gate stopped waiting. Mirrors the `resolution` column's documented values. */
export type GateResolution = "approved" | "revised" | "reopened" | "abandoned";

/** Who resolved the gate. Mirrors the `actor_source` column's documented values. */
export type GateActorSource = "human" | "auto" | "system";

export interface OpenGateInput {
  jobId: string;
  requestId: string;
  /** The requester the gate is waiting on, when known. */
  userId?: string | null;
  step: VideoGenerationStep;
  /** Per-scene gates only; null for whole-job gates. */
  sceneIndex?: number | null;
}

export interface CloseGateInput {
  jobId: string;
  step: VideoGenerationStep;
  sceneIndex?: number | null;
  resolution: GateResolution;
  resolvedBy?: string | null;
  actorSource?: GateActorSource | null;
}

export interface MarkNotifiedInput {
  jobId: string;
  step: VideoGenerationStep;
  sceneIndex?: number | null;
}

/**
 * Minimal shape of the `pg` pool this service needs, so tests can inject a stub
 * without constructing a real Pool (which would try to open a socket).
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Is this step a requester review gate?
 *
 * Derived from the enum's own value convention (`awaiting_*`) rather than a
 * hand-maintained list: a gate added to the enum but forgotten here would be
 * invisible in the analytics with nothing to flag it. Every current gate —
 * including the legacy `awaiting_voice_recording` retained for old rows —
 * follows the convention.
 */
export function isAwaitingGate(
  step: VideoGenerationStep | null | undefined
): boolean {
  return typeof step === "string" && step.startsWith("awaiting_");
}

/**
 * The gates the pipeline reaches once PER SCENE, looping through them via
 * `currentSceneIndex`. Their rows are keyed by scene so each scene's wait is
 * measured separately instead of the last one overwriting the first.
 *
 * Kept in step with `PER_SCENE_NOTICE` in PushNotificationService, which splits
 * the same two gates per scene for push dedup. A gate in one list but not the
 * other would either collapse N scene waits into one row or notify once for N
 * scenes.
 */
const PER_SCENE_GATES: ReadonlySet<VideoGenerationStep> = new Set([
  VideoGenerationStep.AwaitingSceneScriptApproval,
  VideoGenerationStep.AwaitingVideoApproval,
]);

/**
 * The scene index a gate row should be keyed by.
 *
 * Whole-job gates get NULL even though the job still carries a
 * `currentSceneIndex` from the scene loop it just left: keying them by that
 * stale value would let the same gate open twice on one job (once per scene
 * index it happened to be sitting on), which the `uq_gate_events_open` index is
 * there to prevent.
 */
export function gateSceneIndex(
  step: VideoGenerationStep,
  currentSceneIndex: number | null | undefined
): number | null {
  if (!PER_SCENE_GATES.has(step)) return null;
  return currentSceneIndex ?? null;
}

export class GateEventService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * Record that a gate started waiting.
   *
   * `ON CONFLICT DO NOTHING` against `uq_gate_events_open`: the pipeline can
   * re-enter the same gate (a status poll racing the render worker's post-step
   * hook, or a revision landing back on the step it came from) and the FIRST
   * open is the one whose `opened_at` measures the real wait. A conflict is the
   * index doing its job, not an error, so it is not logged.
   */
  async openGate(input: OpenGateInput): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO pipeline_gate_events
           (job_id, request_id, user_id, step, scene_index)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          input.jobId,
          input.requestId,
          input.userId ?? null,
          input.step,
          input.sceneIndex ?? null,
        ]
      );
    } catch (err) {
      console.error("[gateEvents] failed to open gate:", err);
    }
  }

  /**
   * Close the open row for this gate, stamping who resolved it and how long it
   * waited.
   *
   * `wait_seconds` is computed in SQL from the stored `opened_at` rather than in
   * JS: the opening and the close usually happen in different processes (the web
   * request that reached the gate vs. the worker that cleared it), so only the
   * database has both clocks.
   *
   * A no-op when no open row exists — gates opened before this table shipped, or
   * a duplicate close, must not create one.
   */
  async closeGate(input: CloseGateInput): Promise<void> {
    try {
      await this.db.query(
        `UPDATE pipeline_gate_events
            SET resolved_at  = NOW(),
                resolution   = $4,
                resolved_by  = $5,
                actor_source = $6,
                wait_seconds = EXTRACT(EPOCH FROM (NOW() - opened_at))::int,
                updated_at   = NOW()
          WHERE job_id = $1
            AND step = $2
            AND COALESCE(scene_index, -1) = COALESCE($3::int, -1)
            AND resolved_at IS NULL`,
        [
          input.jobId,
          input.step,
          input.sceneIndex ?? null,
          input.resolution,
          input.resolvedBy ?? null,
          input.actorSource ?? null,
        ]
      );
    } catch (err) {
      console.error("[gateEvents] failed to close gate:", err);
    }
  }

  /**
   * Stamp that the "ready for review" push actually went out.
   *
   * A NULL `notified_at` on a resolved gate is meaningful data, not a gap: the
   * express lane deliberately suppresses push on the gates it auto-approves
   * (see `shouldSuppressPipelineNotice`), so notified-vs-not separates "the
   * requester was summoned and then took N seconds" from "nobody was ever told".
   */
  async markNotified(input: MarkNotifiedInput): Promise<void> {
    try {
      await this.db.query(
        `UPDATE pipeline_gate_events
            SET notified_at = NOW(),
                updated_at  = NOW()
          WHERE job_id = $1
            AND step = $2
            AND COALESCE(scene_index, -1) = COALESCE($3::int, -1)
            AND resolved_at IS NULL
            AND notified_at IS NULL`,
        [input.jobId, input.step, input.sceneIndex ?? null]
      );
    } catch (err) {
      console.error("[gateEvents] failed to mark gate notified:", err);
    }
  }
}

export const gateEventService = new GateEventService();
