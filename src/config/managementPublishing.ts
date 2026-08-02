/**
 * Aspect-ratio rules for RClipper Management publishing.
 *
 * WHY THIS EXISTS. One content item is fanned out to several social channels,
 * and the shape a channel wants differs: TikTok is vertical (9:16), YouTube is
 * landscape (16:9), an Instagram feed post is portrait (4:5). The composer
 * therefore lets each destination use its own video VARIANT, and this module is
 * the single source of truth for which variants a platform will accept and which
 * one to offer by default.
 *
 * TWO SOURCES, ONE RULE.
 *   * A transferred generation project already carries per-ratio exports
 *     (9:16, 16:9, 4:5), so each selected channel is matched to the export
 *     that fits it.
 *   * A user upload is ONE video for ONE channel. The uploaded file's aspect
 *     ratio must match the channel it is meant for, and that is checked here.
 *
 * Everything here is pure so it can be unit-tested and reused on both the server
 * (validation, the authority) and the client (the composer's default picks).
 *
 * The platform strings are the provider-neutral `SocialPlatform` values from
 * `src/services/social-publishing/types.ts`, NOT the video generator's
 * `Platform` enum (which includes Travy and a CDN download that are not social
 * destinations).
 */

import type { SocialPlatform } from "@/services/social-publishing/types";

/** The video shapes RClipper produces and accepts. */
export type ManagementAspectRatio = "9:16" | "16:9" | "4:5";

export const MANAGEMENT_ASPECT_RATIOS: readonly ManagementAspectRatio[] = [
  "9:16",
  "16:9",
  "4:5",
] as const;

export function isManagementAspectRatio(v: unknown): v is ManagementAspectRatio {
  return (
    typeof v === "string" &&
    (MANAGEMENT_ASPECT_RATIOS as readonly string[]).includes(v)
  );
}

/**
 * Which aspect ratios each platform will accept for a video post.
 *
 * The FIRST entry is that platform's preferred/default shape — `defaultVariant`
 * returns it. Order therefore matters. These reflect each platform's dominant
 * video surface (vertical short-form where that is the norm, landscape for
 * YouTube's main feed) and are deliberately a little permissive: the aim is to
 * stop an obviously wrong shape (a landscape clip sent to TikTok), not to police
 * every pixel.
 */
const PLATFORM_ACCEPTED_RATIOS: Record<SocialPlatform, readonly ManagementAspectRatio[]> = {
  tiktok: ["9:16"],
  tiktok_business: ["9:16"],
  instagram: ["9:16", "4:5"],
  youtube: ["16:9", "9:16"],
  facebook: ["16:9", "9:16", "4:5"],
  x: ["16:9", "9:16"],
  linkedin: ["16:9", "9:16", "4:5"],
  pinterest: ["9:16", "4:5"],
  threads: ["9:16", "4:5"],
  bluesky: ["16:9", "9:16"],
};

/** The aspect ratios a platform accepts, or an empty list if unknown. */
export function acceptedRatiosForPlatform(
  platform: string
): readonly ManagementAspectRatio[] {
  return PLATFORM_ACCEPTED_RATIOS[platform as SocialPlatform] ?? [];
}

/**
 * The default video variant to pre-select for a platform (its preferred shape).
 * Null when the platform is not recognised.
 */
export function defaultVariantForPlatform(
  platform: string
): ManagementAspectRatio | null {
  return acceptedRatiosForPlatform(platform)[0] ?? null;
}

/**
 * Does a connected Management account represent a generator channel suggestion?
 * TikTok Business is a publishing-account variant of the generator's single
 * TikTok choice; every other supported channel matches exactly.
 */
export function connectionMatchesSuggestedPlatform(
  connectionPlatform: string,
  suggestedPlatform: string
): boolean {
  return (
    connectionPlatform === suggestedPlatform ||
    (suggestedPlatform === "tiktok" && connectionPlatform === "tiktok_business")
  );
}

/**
 * Is `aspectRatio` acceptable for `platform`?
 *
 * A NULL ratio returns true — "unknown", not "incompatible". We only reject a
 * shape we can positively identify as wrong, so a legacy asset with no recorded
 * ratio is never blocked from publishing on that ground alone; the composer
 * still nudges the user toward the right variant.
 *
 * An UNKNOWN platform also returns true: gating publishing on a platform this
 * table has not caught up with would be the more surprising failure.
 */
export function isAspectRatioCompatibleWithPlatform(
  platform: string,
  aspectRatio: string | null
): boolean {
  if (aspectRatio === null) return true;
  const accepted = acceptedRatiosForPlatform(platform);
  if (accepted.length === 0) return true;
  return (accepted as readonly string[]).includes(aspectRatio);
}

/**
 * Best-effort aspect ratio for a content asset.
 *
 * Prefers the stored `aspectRatio` string (set on transferred exports). Falls
 * back to classifying the pixel dimensions — the case that matters for a user
 * upload, whose ratio is only known from the file the completion step measured.
 * Returns null when neither is available.
 */
export function assetAspectRatio(asset: {
  aspectRatio: string | null;
  width: number | null;
  height: number | null;
}): ManagementAspectRatio | null {
  if (isManagementAspectRatio(asset.aspectRatio)) return asset.aspectRatio;
  return classifyDimensions(asset.width, asset.height);
}

/**
 * Snap raw pixel dimensions to the nearest supported aspect ratio.
 *
 * Real files are never exactly 9:16; a 1080×1920 upload and a 1082×1918 upload
 * are both "9:16". We compare the width/height ratio to each supported shape and
 * take the closest, but only accept it inside a tolerance band so a genuinely
 * odd shape (e.g. an ultrawide 21:9) stays null rather than being forced into a
 * bucket it does not belong in.
 */
export function classifyDimensions(
  width: number | null,
  height: number | null
): ManagementAspectRatio | null {
  if (!width || !height || width <= 0 || height <= 0) return null;

  const ratio = width / height;
  const targets: { name: ManagementAspectRatio; value: number }[] = [
    { name: "9:16", value: 9 / 16 },
    { name: "16:9", value: 16 / 9 },
    { name: "4:5", value: 4 / 5 },
  ];

  let best: { name: ManagementAspectRatio; delta: number } | null = null;
  for (const t of targets) {
    // Relative difference, so the tolerance means the same thing for a
    // landscape ratio (1.78) as for a portrait one (0.56).
    const delta = Math.abs(ratio - t.value) / t.value;
    if (!best || delta < best.delta) best = { name: t.name, delta };
  }

  // ~8 % tolerance — comfortably absorbs real-world rounding without merging
  // distinct shapes (9:16 = 0.5625 and 4:5 = 0.80 are well over 8 % apart).
  if (best && best.delta <= 0.08) return best.name;
  return null;
}
