/**
 * Lab render driver. It does NOT upload anything itself. Each step is one call
 * to the existing `runDeviceRender` (claim, render, authorise, PUT parts,
 * finish, complete), so the normal device-render lifecycle and its checks
 * still apply. This file only decides:
 *  - whether to start another step (flag still on, not cancelled, step limit);
 *  - which outputs are durable (only a completed step whose server `complete`
 *    returned an assetId, which the server gives only after verifying the object);
 *  - when to stop, and what to keep.
 * Nothing is deleted here. The caller decides cleanup from `durableAssetIds`.
 */

export type RenderOutcomeLike = {
  status: "completed" | "refused" | "released" | "failed";
  reason?: string;
  assetId?: string | null;
  /** The attempt that produced the asset. Absent today: see the proposal for runDeviceRender. */
  attemptId?: string | null;
};

export interface LabRenderDriverDeps {
  /** Re-read on every step, so switching the flag off stops the next step. */
  flagOn(): boolean;
  /** One existing device-render step (runDeviceRender in production). */
  runOnce(input: { requestId: string; shouldCancel: () => boolean }): Promise<RenderOutcomeLike>;
}

export interface LabRenderDriverInput {
  requestId: string;
  /** Hard limit on steps for one run, so the loop is bounded. */
  maxSteps: number;
  cancelled(): boolean;
}

export type LabRenderDriverResult =
  | { status: "done"; durableAssetIds: string[] }
  | { status: "cancelled"; durableAssetIds: string[] }
  | { status: "flag_off"; durableAssetIds: string[] }
  | { status: "bounded_exhausted"; durableAssetIds: string[] }
  | { status: "failed"; step: number; reason: string; durableAssetIds: string[] };

/** Server reason for "nothing left to render" on this request. */
const NOTHING_LEFT = "no_render_queued";

export async function driveLabRender(
  input: LabRenderDriverInput,
  deps: LabRenderDriverDeps
): Promise<LabRenderDriverResult> {
  const durable: string[] = [];

  for (let step = 1; step <= input.maxSteps; step++) {
    if (input.cancelled()) return { status: "cancelled", durableAssetIds: durable };
    if (!deps.flagOn()) return { status: "flag_off", durableAssetIds: durable };

    const outcome = await deps.runOnce({ requestId: input.requestId, shouldCancel: input.cancelled });

    if (outcome.status === "refused" && outcome.reason === NOTHING_LEFT) {
      return { status: "done", durableAssetIds: durable };
    }
    if (outcome.status === "completed") {
      // Durable only with the server's asset id. A completed step without one
      // is not counted, and the run stops so nothing is cleaned up on a guess.
      if (typeof outcome.assetId === "string" && outcome.assetId.length > 0) {
        durable.push(outcome.assetId);
        continue;
      }
      return { status: "failed", step, reason: "completed_without_asset", durableAssetIds: durable };
    }
    // A step that stopped because the user cancelled is a cancellation, not a failure.
    if (input.cancelled()) return { status: "cancelled", durableAssetIds: durable };
    return {
      status: "failed",
      step,
      reason: outcome.reason ?? outcome.status,
      durableAssetIds: durable,
    };
  }
  return { status: "bounded_exhausted", durableAssetIds: durable };
}
