/**
 * Credit configuration.
 *
 * Credit unit: **1 credit = ฿1 ON WEB**. Anything priced in credits costs the
 * SAME number of credits on every platform; what differs is the real-money price
 * of a TOP-UP, because App Store and Play Store commission has to be absorbed
 * somewhere. See src/config/mobilePurchases.ts for the per-platform tables.
 *
 * REQUESTS ARE NO LONGER CHARGED INDIVIDUALLY. Access to video generation is a
 * monthly quota — 3 free per rolling 30 days, or 10 per month on a purchased
 * package (src/config/videoPackages.ts). Credits remain the currency for buying
 * those packages and Channel Management packages.
 */
export const CREDITS_CONFIG = {
  /** No free credits on signup; the free allowance is quota, not credit. */
  SIGNUP_BONUS_CREDITS: 0,
  /** 1 credit == ฿1 on web. */
  CREDIT_TO_BAHT_VALUE: 1,
} as const;

/**
 * Prepaid top-up bundles offered at checkout / first-step top-up.
 * `credits` is the wallet amount granted; `baht` is the amount charged.
 * Bundling amortises any per-transaction gateway minimum and reduces how often a
 * user has to scan a PromptPay QR.
 *
 * THE LADDER MUST REACH THE DEAREST PACKAGE IN ONE TOP-UP. It previously stopped
 * at 1,000 while the annual bundle costs 3,500, so the highest-intent buyer in
 * the product was the one forced through four separate payments. The two entry
 * rungs are set to the exact price of the two entry packages (200 video, 350
 * bundle) so the commonest purchase leaves no stranded remainder.
 * `tests/config/storeCatalogue.test.ts` holds this invariant across all three
 * payment rails.
 */
export const TOPUP_BUNDLES = [
  { credits: 50, baht: 50, label: "50 เครดิต" },
  { credits: 200, baht: 200, label: "200 เครดิต · แพ็กเกจวิดีโอ 1 เดือน", popular: true },
  { credits: 350, baht: 350, label: "350 เครดิต · แพ็กรวม 1 เดือน" },
  { credits: 1000, baht: 1000, label: "1,000 เครดิต" },
  { credits: 2000, baht: 2000, label: "2,000 เครดิต" },
  { credits: 4000, baht: 4000, label: "4,000 เครดิต · แพ็กรวม 1 ปี" },
] as const;

/**
 * @deprecated Per-step / per-second pipeline pricing is retired, and so is the
 * flat per-request price that replaced it. Access is now a monthly quota
 * (src/config/videoPackages.ts) and nothing charges credits per request. Kept
 * only because `ProductionPipeline` still renders the step breakdown as an
 * explanation of what the pipeline does. Do not use for new work.
 */
export const PIPELINE_STEP_COSTS = {
  CONTENT_ANALYSIS: 10,
  VIDEO_GEN_PER_SECOND: 10,
  MUSIC_SOUND_PER_SECOND: 7,
  SUBTITLE_PER_SECOND: 3,
  RESIZE_FREE_CHANNELS: 2,
  RESIZE_PER_EXTRA_CHANNEL: 30,
  REWORK_BUFFER_PERCENT: 10,
  MIN_DURATION_SECONDS: 5,
  MAX_DURATION_SECONDS: 30,
  DEFAULT_DURATION_SECONDS: 15,
} as const;

/**
 * The longest video the PHONE STUDIO may ask for. Every frame of a studio
 * request is made on the phone, so the server's 30-second cap (which bounds
 * the Mac Mini's render time) does not apply to it. Every other path — the web
 * request form, older app builds, anything rendered on the server — keeps
 * {@link PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS}.
 */
export const STUDIO_MAX_DURATION_SECONDS = 90;

export interface PipelineCostBreakdown {
  step1: number;
  step2: number;
  step3: number;
  step4: number;
  step5: number;
  extraChannels: number;
  base: number;
  rework: number;
  total: number;
}

export function calcPipelineCost(
  durationSeconds: number,
  totalChannels: number
): PipelineCostBreakdown {
  const step1 = PIPELINE_STEP_COSTS.CONTENT_ANALYSIS;
  const step2 = durationSeconds * PIPELINE_STEP_COSTS.VIDEO_GEN_PER_SECOND;
  const step3 = durationSeconds * PIPELINE_STEP_COSTS.MUSIC_SOUND_PER_SECOND;
  const step4 = durationSeconds * PIPELINE_STEP_COSTS.SUBTITLE_PER_SECOND;
  const extraChannels = Math.max(0, totalChannels - PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS);
  const step5 = extraChannels * PIPELINE_STEP_COSTS.RESIZE_PER_EXTRA_CHANNEL;
  const base = step1 + step2 + step3 + step4 + step5;
  const rework = Math.ceil((base * PIPELINE_STEP_COSTS.REWORK_BUFFER_PERCENT) / 100);
  return { step1, step2, step3, step4, step5, extraChannels, base, rework, total: base + rework };
}

// Backwards-compatible re-export for callers outside the requester UI. New
// presentation code should import from pipelinePresentation directly.
export { PIPELINE_PHASES, STEP_TO_PHASE } from "@/config/pipelinePresentation";

export const AI_TRACK_BASE_COST = calcPipelineCost(
  PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
  PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS
).total;
