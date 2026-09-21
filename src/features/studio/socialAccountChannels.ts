import type { StudioChannel } from "@/domain/models/Studio";

/**
 * Provider platform keys map onto the four Studio channels. TikTok Business
 * posts to the same channel as personal TikTok, so both resolve to "tiktok".
 * A platform without an entry here is not publishable from Studio yet and is
 * hidden rather than shown as an unusable option.
 */
export const PLATFORM_CHANNEL: Record<string, StudioChannel> = {
  tiktok: "tiktok",
  tiktok_business: "tiktok",
  instagram: "instagram",
  facebook: "facebook",
  youtube: "youtube",
};

export const CHANNEL_LABELS: Record<StudioChannel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

/** Channel accent colours keep each platform recognisable at a glance. */
export const CHANNEL_ACCENT: Record<StudioChannel, string> = {
  tiktok: "bg-slate-900 text-white",
  instagram: "bg-pink-100 text-pink-800",
  facebook: "bg-blue-100 text-blue-800",
  youtube: "bg-red-100 text-red-800",
};

export function channelForPlatform(platform: string): StudioChannel | undefined {
  return PLATFORM_CHANNEL[platform];
}
