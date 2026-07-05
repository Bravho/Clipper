/**
 * Retention windows (see docs/storage-lifecycle-design.md, Addendum A).
 *
 * These drive the application-level retention logic. The S3 bucket-lifecycle
 * rules are only a coarse backstop and use deliberately longer ages so they
 * never delete a clip inside its availability window.
 */

/** Days a delivered/published final clip stays downloadable before purge. */
export const FINAL_CLIP_AVAILABILITY_DAYS = 7;

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
