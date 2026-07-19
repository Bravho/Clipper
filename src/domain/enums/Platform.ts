/**
 * Publishing platforms supported by the Clipper service.
 *
 * These are used in two contexts:
 * 1. Requester form — requester selects intended target platforms.
 * 2. Publishing links — staff records which platforms the clip was published to.
 *
 * TODO: PostgreSQL — store as TEXT[] on clip_requests (target_platforms)
 *       and as TEXT on publishing_links (platform).
 */
export enum Platform {
  TikTok = "tiktok",
  Facebook = "facebook",
  Instagram = "instagram",
  YouTube = "youtube",
  TventApp = "tvent_app",
  CDN = "cdn",
}

/** Human-readable labels for display in the UI. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  [Platform.TikTok]: "TikTok",
  [Platform.Facebook]: "Facebook",
  [Platform.Instagram]: "Instagram",
  [Platform.YouTube]: "YouTube",
  [Platform.TventApp]: "Travy",
  [Platform.CDN]: "Download / CDN Link",
};

/** All selectable platforms in preferred display order. */
export const ALL_PLATFORMS: Platform[] = [
  Platform.TikTok,
  Platform.Facebook,
  Platform.Instagram,
  Platform.YouTube,
  Platform.TventApp,
  Platform.CDN,
];

/**
 * Platforms shown in the requester request form.
 * TventApp is mandatory (always pre-selected). CDN is excluded (internal only).
 */
export const FORM_PLATFORMS: Platform[] = [
  Platform.TventApp,   // mandatory — always selected, shown first
  Platform.TikTok,
  Platform.Facebook,
  Platform.Instagram,
  Platform.YouTube,
];

/** Platforms that the requester may optionally check (Tvent is mandatory, not optional). */
export const OPTIONAL_FORM_PLATFORMS: Platform[] = [
  Platform.TikTok,
  Platform.Facebook,
  Platform.Instagram,
  Platform.YouTube,
];

/**
 * Maps each platform to its preferred aspect ratio for base video generation.
 * The requester's #1 priority platform determines which ratio is sent to the
 * video generator (Veo). Veo only accepts "16:9"/"9:16", so other ratios are
 * mapped onto the nearest of those for the source clip; the final per-platform
 * crops are produced later by FFmpeg. This mapping also drives FFmpeg export
 * priority.
 */
export const PLATFORM_ASPECT_RATIOS: Record<Platform, string> = {
  [Platform.TikTok]: "9:16",
  [Platform.Facebook]: "16:9",
  [Platform.Instagram]: "4:5",
  [Platform.YouTube]: "16:9",
  // Travy is FIXED at 16:9 (same as YouTube): the Travy clip is uploaded to
  // YouTube and embedded in the Travy web app, so it never mirrors the
  // primary channel's ratio.
  [Platform.TventApp]: "16:9",
  [Platform.CDN]: "16:9",
};
