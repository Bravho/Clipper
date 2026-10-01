/** Emergency rollback only. Native capability decides the normal default. */
export const LOCAL_FIRST_MEDIA_ENABLED =
  process.env.NEXT_PUBLIC_LOCAL_FIRST_MEDIA !== "false";

/**
 * How long the app keeps the private copy of the photos and clips picked for a
 * video, in days (Tho, 27 Sep 2026).
 *
 * Every frame is rendered on the phone from these copies, so a request can only
 * be rendered — its main video and each extra channel shape — while they are
 * kept. After this many days the studio deletes them and the request can no
 * longer be rendered; the person starts a new video instead. Picking the same
 * files again is NOT offered: a request is priced for one set of AI work
 * (script, voice, scene design), not for being rebuilt later.
 *
 * Counted on the phone from when each file was copied into the app, and on the
 * server (a backstop) from when the request was submitted, which is always
 * later — so the server never refuses a render the phone could still make.
 */
export const ORIGINALS_KEPT_DAYS = 7;

/** When originals copied at `keptAt` stop being usable. */
export function originalsExpireAt(keptAt: Date): Date {
  return new Date(keptAt.getTime() + ORIGINALS_KEPT_DAYS * 86_400_000);
}
