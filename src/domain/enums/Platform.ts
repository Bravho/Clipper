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
 * TventApp and CDN are excluded — they are used internally by staff
 * for publishing link records, not selected by requesters.
 */
export const FORM_PLATFORMS: Platform[] = [
  Platform.TikTok,
  Platform.Facebook,
  Platform.Instagram,
  Platform.YouTube,
];
