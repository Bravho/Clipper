import type { AdLabChannel, AdLabChannelPublishingSettings } from "@/domain/models/AdLab";

/**
 * Paid promotion in Ad Lab is a PLAN, not a purchase.
 *
 * Post for Me publishes organic posts only; nothing in RClipper is connected to
 * the platforms' ad-buying APIs or charges the owner for ads. The owner pays the
 * platform directly. What Ad Lab does with the plan: show the real total before
 * publishing, ask the owner to acknowledge they will pay it on the platform, and
 * store it as the target's planned budget so Analyze can compare against it.
 */

export const DEFAULT_PROMOTION_DAYS = 7;
export const PROMOTION_DAY_PRESETS = [1, 3, 7, 14, 30] as const;
export const MAX_PROMOTION_DAYS = 365;

/** Where the owner actually pays for the promotion, per channel. */
export const PROMOTION_PAY_AT: Record<AdLabChannel, string> = {
  tiktok: "TikTok Promote (ในแอป TikTok) หรือ TikTok Ads Manager",
  instagram: "ปุ่ม Boost post ใน Instagram หรือ Meta Ads Manager",
  facebook: "ปุ่ม Boost post ใน Facebook หรือ Meta Ads Manager",
  youtube: "Google Ads (แคมเปญวิดีโอ YouTube)",
};

export function promotionDays(settings: AdLabChannelPublishingSettings): number {
  const days = Math.round(Number(settings.durationDays) || DEFAULT_PROMOTION_DAYS);
  return Math.min(MAX_PROMOTION_DAYS, Math.max(1, days));
}

/** Whole-run cost in THB for one account on this channel (0 when promotion is off). */
export function promotionTotal(settings: AdLabChannelPublishingSettings): number {
  if (!settings.publish || !settings.advertisingEnabled) return 0;
  const budget = Math.max(0, Number(settings.budget) || 0);
  return settings.budgetType === "daily" ? budget * promotionDays(settings) : budget;
}

/** Per-day equivalent in THB, for showing both sides of the same plan. */
export function promotionDaily(settings: AdLabChannelPublishingSettings): number {
  if (!settings.publish || !settings.advertisingEnabled) return 0;
  const budget = Math.max(0, Number(settings.budget) || 0);
  return settings.budgetType === "daily" ? budget : budget / promotionDays(settings);
}

export function formatBaht(value: number): string {
  return `฿${value.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
}
