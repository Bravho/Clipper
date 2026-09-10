import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";

/**
 * Trial allowance configuration.
 *
 * Every account gets a ladder of free requests before the paywall closes:
 *
 *   #1        `free_clean`   — free to generate, NO watermark, download unlocked
 *   #2 – #4   `free_preview` — free to generate, watermarked preview only;
 *                              pay the request price to remove the watermark and
 *                              download the clean master
 *   #5 …      `paid_upfront` — the request price is charged BEFORE generation
 *                              starts; the clean master is downloadable at once
 *
 * The price itself is not configured here — a request costs
 * `CREDITS_CONFIG.REQUEST_COST_CREDITS` in every tier that charges at all.
 *
 * These two numbers are the ONLY place the tier boundaries live. Everything else
 * (services, UI copy, analytics) goes through {@link resolveEntitlement}.
 */
export const TRIAL_CONFIG = {
  /** Requests delivered free AND watermark-free. */
  FREE_CLEAN_REQUESTS: 1,
  /** Requests delivered free but watermarked, unlockable by paying. */
  FREE_PREVIEW_REQUESTS: 3,
  /** Total requests that are not charged at submission time. */
  get FREE_REQUESTS_TOTAL(): number {
    return this.FREE_CLEAN_REQUESTS + this.FREE_PREVIEW_REQUESTS;
  },
} as const;

/**
 * What the account's NEXT request is entitled to, derived from how much of the
 * allowance has already been consumed.
 */
export interface RequestEntitlement {
  /** Tier the next submission falls into. */
  tier: RequestPricingTier;
  /**
   * Trial requests already consumed by this identity — this account's submitted
   * requests plus anything carried over from a previously deleted account. Kept
   * uncapped so callers can tell "just used the last free one" from "long past".
   */
  trialUsed: number;
  /**
   * How many free CLEAN clips remain (0 or 1). Non-zero only in the
   * `free_clean` tier — it is the current request itself.
   */
  cleanRemaining: number;
  /**
   * How many free WATERMARKED preview clips remain, counting the current
   * request. 3 while the free clean clip is still unused, then 3 → 2 → 1, then 0.
   */
  previewRemaining: number;
  /** True when credits must be deducted at submission. */
  chargeAtSubmit: boolean;
  /** Value to persist as `ClipRequest.downloadUnlocked` at submission. */
  downloadUnlockedOnSubmit: boolean;
  /** True while ANY part of the free allowance is still available. */
  hasFreeAllowanceLeft: boolean;
}

/**
 * Resolve the entitlement for the next request of an account that has already
 * consumed `trialUsed` trial requests.
 *
 * Pure — no I/O, no clock, no config beyond {@link TRIAL_CONFIG} — so it is
 * cheap to call anywhere and trivially testable. Negative or non-integer input
 * is clamped rather than trusted.
 */
export function resolveEntitlement(trialUsed: number): RequestEntitlement {
  const used = Math.max(0, Math.floor(trialUsed || 0));

  const cleanRemaining = Math.max(0, TRIAL_CONFIG.FREE_CLEAN_REQUESTS - used);
  const previewRemaining = Math.max(
    0,
    TRIAL_CONFIG.FREE_REQUESTS_TOTAL - Math.max(used, TRIAL_CONFIG.FREE_CLEAN_REQUESTS)
  );

  const tier =
    cleanRemaining > 0
      ? RequestPricingTier.FreeClean
      : previewRemaining > 0
        ? RequestPricingTier.FreePreview
        : RequestPricingTier.PaidUpfront;

  return {
    tier,
    trialUsed: used,
    cleanRemaining,
    previewRemaining,
    chargeAtSubmit: tier === RequestPricingTier.PaidUpfront,
    // Only the watermarked preview tier withholds the clean master.
    downloadUnlockedOnSubmit: tier !== RequestPricingTier.FreePreview,
    hasFreeAllowanceLeft: tier !== RequestPricingTier.PaidUpfront,
  };
}

/**
 * The entitlement of an account that has used its whole allowance. Handy as a
 * safe default wherever an entitlement must be supplied but cannot be resolved
 * (e.g. a component rendering before its props arrive) — it is the strictest
 * state, so it can never accidentally hand out a free clip.
 */
export const EXHAUSTED_ENTITLEMENT: RequestEntitlement = resolveEntitlement(
  TRIAL_CONFIG.FREE_REQUESTS_TOTAL
);
