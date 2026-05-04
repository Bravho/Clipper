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
  [Platform.TventApp]: "Tvent App",
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
