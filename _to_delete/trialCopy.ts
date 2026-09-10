import { CREDITS_CONFIG } from "@/config/credits";
import { TRIAL_CONFIG, type RequestEntitlement } from "@/config/trial";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import type { MessageKey } from "@/i18n/messages";

/**
 * Trial-ladder copy, resolved in one place.
 *
 * The same three-way branch (free clean clip / free watermarked preview / paid up
 * front) drives the dashboard banner, the track chooser's price block, the
 * pre-submit charge tile and the submission consent clause. Duplicating the
 * branch across those four surfaces is how the price a user is shown drifts from
 * the price they are charged, so every surface calls into here instead.
 *
 * These are pure functions over a translate function, not hooks, so server
 * components (`getServerI18n`) and client components (`useI18n`) both use them.
 */

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>
) => string;

/**
 * Interpolation values shared by every trial message. `remaining` is the free
 * preview clips left INCLUDING the current one, so a user on their second clip
 * is told "3 left", not "2 left".
 */
export function trialCopyVars(entitlement: RequestEntitlement) {
  return {
    cost: CREDITS_CONFIG.REQUEST_COST_CREDITS,
    preview: TRIAL_CONFIG.FREE_PREVIEW_REQUESTS,
    total: TRIAL_CONFIG.FREE_REQUESTS_TOTAL,
    paidFrom: TRIAL_CONFIG.FREE_REQUESTS_TOTAL + 1,
    remaining: entitlement.previewRemaining,
  };
}

export interface TrialNotice {
  title: string;
  body: string;
  /** Which visual treatment the surface should use. */
  tone: "clean" | "preview" | "paid";
}

/** Headline + body for the banner shown on the dashboard and the request form. */
export function trialNotice(
  t: Translate,
  entitlement: RequestEntitlement
): TrialNotice {
  const vars = trialCopyVars(entitlement);
  switch (entitlement.tier) {
    case RequestPricingTier.FreeClean:
      return {
        title: t("trial.cleanTitle", vars),
        body: t("trial.cleanBody", vars),
        tone: "clean",
      };
    case RequestPricingTier.FreePreview:
      return {
        title: t("trial.previewTitle", vars),
        body: t("trial.previewBody", vars),
        tone: "preview",
      };
    default:
      return {
        title: t("trial.exhaustedTitle", vars),
        body: t("trial.exhaustedBody", vars),
        tone: "paid",
      };
  }
}

/**
 * The short line under a price. Null in the paid tier, where the existing
 * launch-price / all-steps-included note already occupies that slot.
 */
export function trialPriceNote(
  t: Translate,
  entitlement: RequestEntitlement
): string | null {
  const vars = trialCopyVars(entitlement);
  if (entitlement.tier === RequestPricingTier.FreeClean) {
    return t("trial.cleanPriceNote", vars);
  }
  if (entitlement.tier === RequestPricingTier.FreePreview) {
    return t("trial.previewPriceNote", vars);
  }
  return null;
}

/** Sub-label of the pre-submit charge tile ("what happens to my credits"). */
export function trialChargeSubLabel(
  t: Translate,
  entitlement: RequestEntitlement
): string {
  const vars = trialCopyVars(entitlement);
  switch (entitlement.tier) {
    case RequestPricingTier.FreeClean:
      return t("trial.chargeCleanSub", vars);
    case RequestPricingTier.FreePreview:
      return t("trial.chargePreviewSub", vars);
    default:
      return t("trial.chargePaidSub", vars);
  }
}

/**
 * Clause 1 of the submission consent modal — the legally operative statement of
 * what will be charged and when. It MUST agree with what `submitRequest()`
 * actually does, which is why it is derived from the same entitlement object.
 */
export function trialConsentClause(
  t: Translate,
  entitlement: RequestEntitlement
): string {
  const vars = trialCopyVars(entitlement);
  switch (entitlement.tier) {
    case RequestPricingTier.FreeClean:
      return t("trial.consentClean", vars);
    case RequestPricingTier.FreePreview:
      return t("trial.consentPreview", vars);
    default:
      return t("trial.consentPaid", vars);
  }
}
