/**
 * Maximum reservation basis for one lab run, traced from existing code.
 *
 * Findings (read-only trace, 2026-11-07):
 *  - Submit (`ClipRequestService.submitRequest`) takes a QUOTA SLOT via
 *    `videoQuotaService.consume`. Its code comment says the per-request credit
 *    field is historical and "nothing is charged". So no credits are billed
 *    per request today, and the 350/1000 CREDIT caps are a local budget, not
 *    a billing cap.
 *  - The credit price formula still exists (`calcPipelineCost` in
 *    src/config/credits.ts). This file uses it as the only numeric basis
 *    available for the cap, and refuses any run it cannot bound.
 *  - Render runs on the phone. Voice, script, and scene steps call paid
 *    providers, whose per-call cost is NOT mapped here. This basis does not
 *    cover them. That gap is stated, not hidden.
 */

import { calcPipelineCost, STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import { LAB_LEDGER_PER_RUN_CAP } from "@/lib/lab/labSpendLedger";

export const LAB_FIXED_DURATION_SECONDS = 15;
export const LAB_FIXED_CHANNELS = 1;

export type LabMaxBasis =
  | { ok: true; maxCredits: number; durationSeconds: number; channels: number }
  | { ok: false; reason: "duration_unknown" | "duration_out_of_range" | "channels_unknown" | "over_cap"; maxCredits: number | null };

/**
 * Maximum credits for a run of `durationSeconds` with `channels` output shapes,
 * using the same formula as the pipeline's price. Refuses unknown inputs and any
 * total over the per-run cap.
 */
export function labMaxRunCredits(durationSeconds: number | null | undefined, channels: number | null | undefined): LabMaxBasis {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) {
    return { ok: false, reason: "duration_unknown", maxCredits: null };
  }
  if (durationSeconds <= 0 || durationSeconds > STUDIO_MAX_DURATION_SECONDS) {
    return { ok: false, reason: "duration_out_of_range", maxCredits: null };
  }
  if (typeof channels !== "number" || !Number.isInteger(channels) || channels < 1) {
    return { ok: false, reason: "channels_unknown", maxCredits: null };
  }
  const maxCredits = calcPipelineCost(durationSeconds, channels).total;
  if (maxCredits > LAB_LEDGER_PER_RUN_CAP) {
    return { ok: false, reason: "over_cap", maxCredits };
  }
  return { ok: true, maxCredits, durationSeconds, channels };
}
