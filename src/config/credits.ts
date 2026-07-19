/**
 * Credit / pricing configuration.
 *
 * Credit unit: **1 credit = 1 THB** (฿). Top-ups are 1:1 — pay ฿100, get 100 credits.
 *
 * Launch pricing: the full list price of a request is 98 credits (฿98). During the
 * launch window a 50% "founding member" discount applies, so the effective charge
 * is 49 credits (฿49). No free signup credits are granted at launch.
 *
 * `REQUEST_COST_CREDITS` is the *effective* price charged at submission and is what
 * the rest of the app reads. Toggle `LAUNCH_DISCOUNT_ACTIVE` to end the promotion
 * and charge the full price.
 */
export const CREDITS_CONFIG = {
  /** No free credits granted on signup at launch. */
  SIGNUP_BONUS_CREDITS: 0,
  /** Full (pre-discount) list price of one request, in credits (= ฿). */
  REQUEST_FULL_PRICE_CREDITS: 98,
  /** Discounted launch price of one request, in credits (= ฿). */
  REQUEST_LAUNCH_PRICE_CREDITS: 49,
  /** When true, requests are charged the launch price; otherwise the full price. */
  LAUNCH_DISCOUNT_ACTIVE: true,
  /** Effective price charged at submission. Derived from the flag above. */
  get REQUEST_COST_CREDITS(): number {
    return this.LAUNCH_DISCOUNT_ACTIVE
      ? this.REQUEST_LAUNCH_PRICE_CREDITS
      : this.REQUEST_FULL_PRICE_CREDITS;
  },
  /** 1 credit == 1 baht. */
  CREDIT_TO_BAHT_VALUE: 1,
} as const;

/**
 * Prepaid top-up bundles offered at checkout / first-step top-up.
 * `credits === baht` (1:1). Bundling amortises any per-transaction gateway minimum
 * and reduces how often a user has to scan a PromptPay QR.
 */
export const TOPUP_BUNDLES = [
  { credits: 49, baht: 49, label: "1 คลิป" },
  { credits: 98, baht: 98, label: "2 คลิป" },
  { credits: 296, baht: 296, label: "6 คลิป" },
  { credits: 490, baht: 490, label: "10 คลิป", popular: true },
  { credits: 980, baht: 980, label: "20 คลิป" },
] as const;

/**
 * @deprecated Per-step / per-second pipeline pricing is retired. Requests are now
 * charged a single flat price (`CREDITS_CONFIG.REQUEST_COST_CREDITS`) at submission,
 * because no AI video generation runs in the current process. Kept only for
 * historical reference; nothing charges from this model. Do not use for new work.
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

export const PIPELINE_PHASES = [
  {
    id: 1,
    label: "วิเคราะห์เนื้อหา",
    desc: "AI วิเคราะห์รูปภาพและเขียนบทพูดให้ตรวจสอบ",
  },
  {
    id: 2,
    label: "เสียงพากย์",
    desc: "AI สร้างเสียงพากย์จากบทที่อนุมัติ",
  },
  {
    id: 3,
    label: "สคริปต์วิดีโอและสร้างวิดีโอ",
    desc: "AI เขียนแผนฉากจากความยาวเสียงพากย์ก่อน แล้วจึงสร้างวิดีโอหลังอนุมัติ",
  },
  {
    id: 4,
    label: "ซับไตเติ้ล",
    desc: "ใส่ subtitle 3 ภาษา: ไทย · อังกฤษ · จีน",
  },
  {
    id: 5,
    label: "ปรับขนาดและดาวน์โหลด",
    desc: "Export 4 ratio ในอัตราส่วนที่เหมาะกับแต่ละช่องทาง พร้อมดาวน์โหลดไปโพสต์เอง",
  },
] as const;

export const AI_TRACK_BASE_COST = calcPipelineCost(
  PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
  PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS
).total;
