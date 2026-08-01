/**
 * DigitalOcean Spaces lifecycle mirror.
 *
 * The bucket (`clipper-space`) auto-expires objects by KEY PREFIX. This module
 * mirrors those rules so the app can TELL a user when a stored file will be
 * purged, without a per-object HEAD request to Spaces. Keep this in sync with
 * the bucket's actual lifecycle configuration — it is a display/estimation aid,
 * not the enforcement (Spaces enforces; this only predicts).
 *
 * Retention is counted from the object's creation. We do not store the object's
 * exact Space creation time, so callers pass the best baseline they have (the
 * asset/transfer/created timestamp); the result is therefore an ESTIMATE, and
 * should be presented as "around" a date, not a guarantee.
 *
 * MANAGEMENT SELF-UPLOADS are governed by bucket rules (not the app sweep):
 *   management_uploads/  → 7 days  (free tier)
 *   management_retained/ → 30 days (after payment; the object is MOVED here,
 *                          which resets the lifecycle clock)
 * A paid RClipper Management TRANSFER has no prefix of its own — the clip is
 * relocated into `management_retained/` too, so both paid paths share one
 * 30-day window (RClipper Management does not schedule posts ahead, so nothing
 * needs to outlive it). DISTRIBUTION-PAID generation exports move from
 * `final_exports/` into `paid_exports/` (also 30 days).
 *
 * The numbers below are the NOMINAL windows (what we tell the user). Each
 * app-driven prefix's actual bucket rule is this value + 1 safety day, so Spaces
 * never deletes before the app's own window closes. Keep them in sync.
 */

/** Prefix → retention days, mirroring the bucket lifecycle. Longest match wins. */
const LIFECYCLE_RULES: readonly { prefix: string; days: number }[] = [
  { prefix: "tmp/", days: 1 },
  { prefix: "processing/", days: 1 },
  { prefix: "request_mat/", days: 30 },
  // Intermediates — large but reproducible from request_mat/, and worthless once
  // the final is approved. Short window (bucket rule 7 + 1).
  { prefix: "ai_videos/", days: 7 },
  { prefix: "animated_videos/", days: 7 },
  { prefix: "animated_overlays/", days: 7 },
  { prefix: "processed_audio/", days: 7 },
  { prefix: "voice_recordings/", days: 7 },
  // final_exports/ is the delivered clip. Nominal 14 (bucket rule 14 + 1): the
  // user is TOLD 7 days (deliveredAt + FINAL_CLIP_AVAILABILITY_DAYS, enforced by
  // the app sweep), while the age-based bucket keeps ~2x that as headroom because
  // the S3 clock counts from object CREATION, which happens a few approval-gates
  // BEFORE delivery. A distribution payment moves the clip into paid_exports/,
  // and a paid RClipper Management transfer copies it into management_retained/.
  { prefix: "final_exports/", days: 14 },
  // preview_exports/ — watermarked sibling of final_exports/, disposable once the
  // download unlocks. Never longer than the master it previews.
  { prefix: "preview_exports/", days: 14 },
  { prefix: "clips/", days: 60 },
  { prefix: "thumbnails/", days: 730 },
  // RClipper Management self-uploads. Free tier lives in management_uploads/
  // (7-day rule); paying MOVES the object to management_retained/ (30-day rule),
  // which resets the lifecycle clock. Both must exist as bucket rules.
  { prefix: "management_uploads/", days: 7 },
  { prefix: "management_retained/", days: 30 },
  // paid_exports/ — a generation export the user paid to distribute, moved out of
  // final_exports/ so its clock restarts on the 30-day window.
  { prefix: "paid_exports/", days: 30 },
];

/**
 * The Spaces retention window (days) for a storage key, or null when no
 * lifecycle rule matches the key's prefix (e.g. `management_uploads/`).
 */
export function retentionDaysForKey(storageKey: string | null | undefined): number | null {
  if (!storageKey) return null;
  let best: { prefix: string; days: number } | null = null;
  for (const rule of LIFECYCLE_RULES) {
    if (storageKey.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best ? best.days : null;
}

/**
 * Estimated Spaces purge date for an object, given its key and a baseline
 * (its creation, or the closest timestamp available). Null when the prefix has
 * no lifecycle rule — the caller should then fall back to the app's own
 * `media_expires_at`.
 */
export function estimatedSpaceExpiry(
  storageKey: string | null | undefined,
  baseline: Date | null | undefined
): Date | null {
  const days = retentionDaysForKey(storageKey);
  if (days === null || !baseline) return null;
  return new Date(baseline.getTime() + days * 86_400_000);
}
