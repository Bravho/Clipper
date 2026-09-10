/**
 * Which allowance a clip request was submitted against.
 *
 * Decided ONCE, at submission, and frozen on the request so the render queue and
 * the analytics all read the same answer for the rest of its life — changing the
 * quota configuration later never re-classifies a request already in flight.
 *
 * There is no per-request charge: a request is either drawn from the account's
 * free allowance or from a purchased monthly window (see src/config/videoPackages.ts).
 *
 * TODO: PostgreSQL — stored as TEXT on `clip_requests.pricing_tier`
 *   (migration 033, NOT NULL DEFAULT 'free').
 */
export enum RequestPricingTier {
  /**
   * Drawn from the free allowance: 3 requests per rolling 30 days, rendered at
   * LOW queue priority. The deliverable is the full, unwatermarked video.
   */
  Free = "free",

  /**
   * Drawn from a purchased monthly allowance window — 10 requests per month,
   * rendered at HIGH queue priority.
   */
  Paid = "paid",
}
