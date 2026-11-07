/**
 * HeyGen POST /v3/videos `aspect_ratio` values for type "avatar".
 * Source: https://developers.heygen.com/reference/create-video (checked 2026-10-13).
 * Documented values: 16:9, 9:16, 4:5, 5:4, 1:1, auto (API default 16:9). No engine-specific
 * restriction is documented for avatar_v vs avatar_iv; "auto" keeps the source frame ratio.
 */
export const HEYGEN_ASPECT_RATIOS = ["9:16", "16:9", "1:1", "4:5", "5:4", "auto"] as const;
export type HeyGenAspectRatio = (typeof HEYGEN_ASPECT_RATIOS)[number];
export const DEFAULT_HEYGEN_ASPECT_RATIO: HeyGenAspectRatio = "9:16";

export function isHeyGenAspectRatio(v: unknown): v is HeyGenAspectRatio {
  return typeof v === "string" && (HEYGEN_ASPECT_RATIOS as readonly string[]).includes(v);
}

export const HEYGEN_ASPECT_RATIO_OPTIONS: ReadonlyArray<{ value: HeyGenAspectRatio; label: string; w: number; h: number }> = [
  { value: "9:16", label: "9:16 TikTok / Reels / Shorts", w: 9, h: 16 },
  { value: "16:9", label: "16:9 YouTube", w: 16, h: 9 },
  { value: "1:1", label: "1:1 Feed", w: 1, h: 1 },
  { value: "4:5", label: "4:5 Instagram / Facebook Feed", w: 4, h: 5 },
  { value: "5:4", label: "5:4 Feed (landscape)", w: 5, h: 4 },
  { value: "auto", label: "\u0E15\u0E32\u0E21\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A (auto)", w: 0, h: 0 },
];

/**
 * Thai note when the chosen ratio differs from the look's own frame, i.e. the
 * avatar will be cropped (cover) or padded (contain). Returns "" when they match
 * (within 3%), when the ratio is auto, or when the look size is unknown.
 */
export function aspectFramingNote(ratio: HeyGenAspectRatio, lookW?: number, lookH?: number): string {
  if (ratio === "auto" || !lookW || !lookH) return "";
  const opt = HEYGEN_ASPECT_RATIO_OPTIONS.find((o) => o.value === ratio);
  if (!opt || !opt.w) return "";
  const target = opt.w / opt.h;
  const source = lookW / lookH;
  if (Math.abs(target - source) / source < 0.03) return "";
  const shape = source > 1.03 ? "\u0E41\u0E19\u0E27\u0E19\u0E2D\u0E19" : source < 0.97 ? "\u0E41\u0E19\u0E27\u0E15\u0E31\u0E49\u0E07" : "\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21\u0E08\u0E31\u0E15\u0E38\u0E23\u0E31\u0E2A";
  return `Avatar นี้เป็นภาพ${shape} (${lookW}×${lookH}) - วิดีโอ ${ratio} จะถูกครอปให้เต็มเฟรม (fit: cover) ขอบด้านข้าง/บน-ล่างบางส่วนจะถูกตัดออก เลือก fit: contain ในตั้งค่าขั้นสูงหากต้องการเห็นทั้งภาพ (มีขอบดำ)`;
}