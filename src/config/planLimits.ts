/**
 * Every number a user is told about what a plan includes and what one video may
 * use — in ONE place, read from the configs that ENFORCE them.
 *
 * The pricing page, the credits page, the public /plans page and the purchase
 * confirmation all show these. Reading them from the enforcing configs (rather
 * than writing "5 voice makes" into copy) means a limit changed in code changes
 * on every page with it, and a page can never promise more than the server
 * allows. See config/requestLimits.ts and config/packageTiers.ts.
 */

import { STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import { ORIGINALS_KEPT_DAYS } from "@/config/localMedia";
import {
  managementPriceCredits,
  managementRetainedDays,
  packagesForTier,
} from "@/config/management";
import { PACKAGE_TIER_REQUESTS, type PackageTier } from "@/config/packageTiers";
import {
  MAX_CHANNEL_SHAPES_PER_REQUEST,
  MAX_VOICE_MAKES_PER_REQUEST,
} from "@/config/requestLimits";
import { FINAL_CLIP_AVAILABILITY_DAYS } from "@/config/retention";
import { FREE_REQUESTS_PER_WINDOW, FREE_WINDOW_DAYS } from "@/config/videoPackages";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";
import type { MessageKey } from "@/i18n/messages";

/** What one tier of plan includes. */
export interface TierFacts {
  videosPerMonth: number;
  /** Price of the 1-month package, in credits. */
  monthlyPrice: number;
  /** Lowest price per month (the 12-month package), in credits, rounded. */
  lowestPerMonth: number;
}

export function tierFacts(tier: PackageTier): TierFacts {
  const packages = packagesForTier(tier);
  const monthly = packages.find((p) => p.durationMonths === 1);
  const perMonth = packages.map(
    (p) => managementPriceCredits(p) / Math.max(1, p.durationMonths ?? 1)
  );
  return {
    videosPerMonth: PACKAGE_TIER_REQUESTS[tier],
    monthlyPrice: monthly ? managementPriceCredits(monthly) : 0,
    lowestPerMonth: perMonth.length > 0 ? Math.round(Math.min(...perMonth)) : 0,
  };
}

/** The free allowance. */
export const FREE_FACTS = {
  videos: FREE_REQUESTS_PER_WINDOW,
  days: FREE_WINDOW_DAYS,
} as const;

/**
 * Limits that apply to EVERY video, on every plan (free included). Each is
 * enforced on the server; see the file each number comes from.
 */
export function perVideoLimits() {
  return {
    /** Photos and clips per video (MAX_UPLOAD_COUNT). */
    maxItems: MAX_UPLOAD_COUNT,
    /** Longest finished video, seconds (STUDIO_MAX_DURATION_SECONDS). */
    maxSeconds: STUDIO_MAX_DURATION_SECONDS,
    /** Voice makes per video, the first one included. */
    voiceMakes: MAX_VOICE_MAKES_PER_REQUEST,
    /** Channel shapes per video, each made once. */
    shapes: MAX_CHANNEL_SHAPES_PER_REQUEST,
    /** Days a delivered video stays downloadable. */
    downloadDays: FINAL_CLIP_AVAILABILITY_DAYS,
    /** Days a video handed to Channel Management is kept for posting. */
    managementDays: managementRetainedDays(),
    /** Days the app keeps the picked photos and clips (renders need them). */
    originalsDays: ORIGINALS_KEPT_DAYS,
  };
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * The one-line summary of the per-video limits, for a package card and the
 * purchase confirmation (a client component, so it is built on the server and
 * passed down as text).
 */
export function perVideoLimitsSummary(t: Translate): string {
  const limits = perVideoLimits();
  return t("limits.video.summary", {
    seconds: limits.maxSeconds,
    makes: limits.voiceMakes,
    shapes: limits.shapes,
  });
}
