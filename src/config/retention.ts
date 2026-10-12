/**
 * Retention windows (see docs/storage-lifecycle-design.md, Addendum A).
 *
 * These drive the application-level retention logic. The S3 bucket-lifecycle
 * rules are only a coarse backstop and use deliberately longer ages so they
 * never delete a clip inside its availability window.
 */

/**
 * How long a finished video is kept, in days (Tho, 2026-10-12): every generated
 * video is kept at most this long — downloadable, sendable to Channel
 * Management, and then purged.
 *
 * The clock starts when the request is first delivered
 * (`clip_requests.videos_expire_at`, stamped by the repository's updateStatus)
 * and restarts ONCE for a free video, when a package purchase unlocks it
 * (VideoAccessService.unlockForPackage). The user is shown the date on every
 * video.
 */
export const FINAL_CLIP_AVAILABILITY_DAYS = 30;

/** Alias with the product's own name for the same window. */
export const VIDEO_LIFETIME_DAYS = FINAL_CLIP_AVAILABILITY_DAYS;

/**
 * How long a FREE (locked) video is kept, in days (Tho, 2026-10-12): 14 days
 * from its first delivery. Buying a package within that time unlocks it and
 * gives it VIDEO_LIFETIME_DAYS (30) from the purchase; otherwise it is gone.
 * A request unlocked before it is delivered gets the full 30 at delivery.
 */
export const FREE_VIDEO_LIFETIME_DAYS = 14;

/** The lifetime a video gets at its first delivery. */
export function lifetimeDaysAtDelivery(downloadUnlocked: boolean | undefined): number {
  return downloadUnlocked ? VIDEO_LIFETIME_DAYS : FREE_VIDEO_LIFETIME_DAYS;
}

/** Days of inactivity before a non-terminal request is auto-cancelled + purged. */
export const INACTIVITY_CANCEL_DAYS = 30;

/** Thumbnail retention (matches the Spaces `expire-thumbnails-2y` rule). */
export const THUMBNAIL_RETENTION_DAYS = 730;

/** Add whole days to a date without mutating the input. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
