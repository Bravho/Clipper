import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  REQUESTS_PER_PAID_MONTH,
  VIDEO_PACKAGES,
} from "@/config/videoPackages";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import type { VideoQuota } from "@/services/VideoQuotaService";
import type { MessageKey } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/config";

/**
 * Quota copy, resolved in one place.
 *
 * The same three-way branch (free allowance left / paid month / nothing left)
 * drives the dashboard banner, the request list, the new-request form and the
 * pricing page. Duplicating it is how the number a user is shown drifts from the
 * number the server enforces, so every surface calls in here instead.
 *
 * Pure functions over a translate function, not hooks, so server components
 * (`getServerI18n`) and client components (`useI18n`) both use them.
 */

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>
) => string;

/** The cheapest package, quoted wherever we invite an upgrade. */
const ENTRY_PACKAGE = VIDEO_PACKAGES.reduce((cheapest, p) =>
  p.priceCredits < cheapest.priceCredits ? p : cheapest
);

function formatDate(date: Date | null, locale: AppLocale): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : locale, {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function quotaCopyVars(quota: VideoQuota, locale: AppLocale) {
  return {
    remaining: quota.remaining,
    total: quota.total,
    days: FREE_WINDOW_DAYS,
    freeTotal: FREE_REQUESTS_PER_WINDOW,
    paidTotal: REQUESTS_PER_PAID_MONTH,
    price: ENTRY_PACKAGE.priceCredits,
    renews: formatDate(quota.renewsAt, locale),
  };
}

export interface QuotaNotice {
  title: string;
  body: string;
  /** Which visual treatment the surface should use. */
  tone: "paid" | "free" | "exhausted";
}

/** Headline + body for the quota banner. */
export function quotaNotice(
  t: Translate,
  quota: VideoQuota,
  locale: AppLocale
): QuotaNotice {
  const vars = quotaCopyVars(quota, locale);

  if (quota.tier === RequestPricingTier.Paid) {
    return {
      title: t("quota.paidTitle", vars),
      body: t("quota.paidBody", vars),
      tone: "paid",
    };
  }
  if (quota.canSubmit) {
    return {
      title: t("quota.freeTitle", vars),
      body: t("quota.freeBody", vars),
      tone: "free",
    };
  }
  return {
    title: t("quota.exhaustedTitle", vars),
    body: t("quota.exhaustedBody", vars),
    tone: "exhausted",
  };
}

/** Tailwind classes per tone, so the three surfaces look like one system. */
export const QUOTA_TONE_STYLES: Record<
  QuotaNotice["tone"],
  { container: string; title: string; body: string }
> = {
  paid: {
    container: "border-blue-200 bg-blue-50",
    title: "text-blue-900",
    body: "text-blue-700",
  },
  free: {
    container: "border-green-200 bg-green-50",
    title: "text-green-800",
    body: "text-green-700",
  },
  exhausted: {
    container: "border-amber-200 bg-amber-50",
    title: "text-amber-900",
    body: "text-amber-700",
  },
};
