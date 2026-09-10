/**
 * The four RClipper Video packages.
 *
 * All are ONE-TIME, prepaid purchases paid for with credits — the same shape as
 * the Management products (see ManagementProductCode). Nothing renews, nothing
 * can charge a user again, and no new payment provider is involved: buying is a
 * wallet debit, and money only ever enters through the platform's own billing
 * (Stripe on web, Apple IAP / Google Play Billing in the native shells).
 *
 * Each package grants a run of MONTHLY ALLOWANCE WINDOWS, one per month bought,
 * each worth `REQUESTS_PER_PAID_MONTH` video requests. Allowances do NOT
 * aggregate: an unused request expires with the month it belonged to.
 */
export type VideoProductCode =
  | "video_1_month"
  | "video_3_months"
  | "video_6_months"
  | "video_12_months";

export const VIDEO_PRODUCT_CODES: readonly VideoProductCode[] = [
  "video_1_month",
  "video_3_months",
  "video_6_months",
  "video_12_months",
] as const;

export function isVideoProductCode(value: unknown): value is VideoProductCode {
  return (
    typeof value === "string" &&
    (VIDEO_PRODUCT_CODES as readonly string[]).includes(value)
  );
}
