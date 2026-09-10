import type { VideoProductCode } from "@/domain/enums/VideoProductCode";

/**
 * RClipper Video — the quota model.
 *
 * WHAT IS FREE AND WHAT COSTS MONEY
 *   Free:  3 video requests per rolling 30 days, rendered at LOW queue priority.
 *          The deliverable is the real thing — no watermark, fully downloadable.
 *   Paid:  a prepaid package grants 10 requests per month at HIGH queue priority.
 *
 * WHY A QUOTA AND NOT A PER-REQUEST PRICE. One render costs 2–3 hours on a
 * single worker, so the scarce resource is the render line, not money. A monthly
 * quota caps how much of that line any one account can take, and priority
 * decides who goes first — which a per-request charge could not express.
 *
 * PAYMENT MODEL: identical to Management packages (src/config/management.ts).
 * Prepaid, credit-bought, one-time. There is no subscription object, no renewal
 * timer, and nothing that can charge a user again. When a window expires,
 * nothing happens except that new requests fall back to the free allowance.
 *
 * Credit unit: 1 credit = ฿1 on web. The number of credits a package costs is
 * the SAME on every platform; what differs per platform is the real-money price
 * of a credit top-up, which is where App Store / Play Store commission is
 * absorbed (see src/config/mobilePurchases.ts).
 */

/** Requests a free account may submit per rolling window. */
export const FREE_REQUESTS_PER_WINDOW = 3;

/**
 * The free allowance window, in days.
 *
 * A SLIDING window: the allowance is "requests submitted in the last 30 days",
 * not a bucket that refills on a fixed date. That needs no anchor date, no reset
 * job and no per-user bookkeeping, and it cannot be gamed by timing submissions
 * around a boundary.
 */
export const FREE_WINDOW_DAYS = 30;

/** Requests one purchased month is worth. Never carried into the next month. */
export const REQUESTS_PER_PAID_MONTH = 10;

/**
 * How a package's monthly windows are laid out.
 *
 * The short packages are exact multiples of 30 days (1 month = 30 days,
 * 3 = 90, 6 = 180). The annual package instead advances by CALENDAR months so a
 * year bought on 2 Feb 2026 ends 1 Feb 2027 rather than drifting five days short.
 */
export type VideoWindowKind = "days" | "calendar_month";

export interface VideoPackageDefinition {
  code: VideoProductCode;
  /** i18n key for the display name. */
  nameKey: string;
  /** i18n key for the short description. */
  descriptionKey: string;
  /** How many monthly allowance windows one purchase grants. */
  months: number;
  windowKind: VideoWindowKind;
  /** Length of one window when `windowKind` is "days". */
  windowDays: number | null;
  /** Price in credits (= ฿ on web). Identical on every platform. */
  priceCredits: number;
  /** Display order in the pricing page. */
  sortOrder: number;
}

/**
 * The trusted catalogue — the SERVER-SIDE source of truth, mirrored into the
 * `video_products` table by migration 033.
 *
 * Nothing the client sends determines a price or an allowance: the client sends
 * a product CODE and nothing else, and the backend resolves everything here.
 *
 * The ladder tapers gently with commitment (200 → 190 → 190 → 180 credits/month):
 * enough to reward a longer term without discounting so hard that an annual
 * buyer locks in a year of render capacity at a price that cannot fund it.
 */
export const VIDEO_PACKAGES: readonly VideoPackageDefinition[] = [
  {
    code: "video_1_month",
    nameKey: "pricing.video.month1.name",
    descriptionKey: "pricing.video.month1.description",
    months: 1,
    windowKind: "days",
    windowDays: 30,
    priceCredits: 200,
    sortOrder: 1,
  },
  {
    code: "video_3_months",
    nameKey: "pricing.video.month3.name",
    descriptionKey: "pricing.video.month3.description",
    months: 3,
    windowKind: "days",
    windowDays: 30,
    priceCredits: 570,
    sortOrder: 2,
  },
  {
    code: "video_6_months",
    nameKey: "pricing.video.month6.name",
    descriptionKey: "pricing.video.month6.description",
    months: 6,
    windowKind: "days",
    windowDays: 30,
    priceCredits: 1140,
    sortOrder: 3,
  },
  {
    code: "video_12_months",
    nameKey: "pricing.video.year1.name",
    descriptionKey: "pricing.video.year1.description",
    months: 12,
    windowKind: "calendar_month",
    windowDays: null,
    priceCredits: 2160,
    sortOrder: 4,
  },
] as const;

export function findVideoPackage(
  code: VideoProductCode
): VideoPackageDefinition | null {
  return VIDEO_PACKAGES.find((p) => p.code === code) ?? null;
}

/** Effective credits per month, for the "save X%" badge on the pricing page. */
export function creditsPerMonth(pkg: VideoPackageDefinition): number {
  return pkg.priceCredits / pkg.months;
}

export interface AllowanceWindowSpec {
  startsAt: Date;
  expiresAt: Date;
  allowance: number;
}

/**
 * Add `count` calendar months to `from`, clamping the day-of-month so month-end
 * dates do not roll into the following month.
 *
 * 31 Jan + 1 month is 28 Feb (29 in a leap year), not 3 March — the naive
 * `setMonth` would overflow and silently hand out an extra window.
 */
function addCalendarMonths(from: Date, count: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + count;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(from.getUTCDate(), daysInTargetMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

/**
 * Expand a package into its consecutive monthly allowance windows.
 *
 * One row per month is what makes allowances non-aggregating: month 2 begins
 * exactly when month 1 expires, so month 1's unspent requests die with it. No
 * carry-over logic is needed anywhere — the expiry does the work.
 *
 * `from` is normally "now", but a purchase made while an earlier package is
 * still running starts at that package's expiry so paid time is never lost.
 */
function expandWindows(
  months: number,
  windowKind: VideoWindowKind,
  windowDays: number | null,
  from: Date
): AllowanceWindowSpec[] {
  // Every boundary is measured from the ORIGINAL start, not from the previous
  // boundary. Stepping month-by-month would compound the day-of-month clamp: a
  // year bought on 31 January would land on 28 January, three days short of the
  // anniversary the buyer paid for, because February's clamp is never recovered.
  const boundary = (monthsFromStart: number): Date =>
    windowKind === "calendar_month"
      ? addCalendarMonths(from, monthsFromStart)
      : new Date(from.getTime() + monthsFromStart * (windowDays ?? 30) * 86_400_000);

  const windows: AllowanceWindowSpec[] = [];
  for (let i = 0; i < months; i++) {
    windows.push({
      startsAt: boundary(i),
      expiresAt: boundary(i + 1),
      allowance: REQUESTS_PER_PAID_MONTH,
    });
  }

  return windows;
}

export function expandPackageWindows(
  pkg: VideoPackageDefinition,
  from: Date
): AllowanceWindowSpec[] {
  return expandWindows(pkg.months, pkg.windowKind, pkg.windowDays, from);
}

/**
 * The window layout the video ladder uses for a term of `months`.
 *
 * Short terms are exact 30-day multiples; a full year advances by CALENDAR
 * months so it lands on the anniversary rather than five days short. Bundles
 * (src/config/management.ts) read this so a bundle month is laid out exactly
 * like a video-package month — one rule, one place.
 */
export function videoWindowLayoutForMonths(months: number): {
  windowKind: VideoWindowKind;
  windowDays: number | null;
} {
  return months >= 12
    ? { windowKind: "calendar_month", windowDays: null }
    : { windowKind: "days", windowDays: 30 };
}

/**
 * Expand a bare number of months into allowance windows, using the same layout
 * rule as the packages. Used by bundle purchases, which carry a month count
 * rather than a VideoPackageDefinition.
 */
export function expandVideoMonths(months: number, from: Date): AllowanceWindowSpec[] {
  const { windowKind, windowDays } = videoWindowLayoutForMonths(months);
  return expandWindows(months, windowKind, windowDays, from);
}

/** The start of the free allowance's sliding window, relative to `now`. */
export function freeWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - FREE_WINDOW_DAYS * 86_400_000);
}
