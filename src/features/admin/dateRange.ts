/**
 * Shared `?from=&to=` handling for admin analytics pages.
 *
 * Every analytics page takes the same range, so parsing lives here rather than
 * being re-implemented per page. Before this, no admin page read `searchParams`
 * at all.
 *
 * Timezone: all timestamps in the database are TIMESTAMPTZ (stored UTC), but
 * the business runs in Asia/Bangkok. A "day" in these reports is a Bangkok day,
 * so the boundaries are computed as Bangkok midnight expressed as an instant.
 * Bucketing inside SQL uses `AT TIME ZONE REPORTING_TIMEZONE` for the same
 * reason — otherwise a 7am Bangkok approval lands on the previous UTC day and
 * the time-of-day histogram is shifted by seven hours.
 */

/** The business timezone. Used for both range edges and SQL bucketing. */
export const REPORTING_TIMEZONE = "Asia/Bangkok";

/** Fixed +07:00 — Thailand has no daylight saving, so a constant is safe. */
const BANGKOK_UTC_OFFSET_MINUTES = 7 * 60;

export interface DateRange {
  /** Inclusive lower bound (an instant). */
  from: Date;
  /** Exclusive upper bound (an instant). */
  to: Date;
  /** Whole days covered — used for per-day averages and axis sizing. */
  days: number;
  /** `YYYY-MM-DD` in Bangkok, for round-tripping into form inputs and links. */
  fromInput: string;
  toInput: string;
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 730;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Bangkok-local midnight at the start of `YYYY-MM-DD`, as a UTC instant. */
function bangkokMidnight(isoDate: string): Date | null {
  if (!DATE_PATTERN.test(isoDate)) return null;
  const utcMidnight = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) return null;
  return new Date(utcMidnight - BANGKOK_UTC_OFFSET_MINUTES * 60_000);
}

/** `YYYY-MM-DD` for the Bangkok day that `instant` falls in. */
export function toBangkokDateInput(instant: Date): string {
  const shifted = new Date(instant.getTime() + BANGKOK_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

/**
 * Resolve a range from raw search params.
 *
 * Both bounds are optional and independently defaulted, so `?from=2026-01-01`
 * alone means "from that date until now". Invalid or reversed input silently
 * falls back to the default window rather than erroring — an admin mistyping a
 * URL should see a dashboard, not a stack trace.
 */
export function parseDateRange(params?: {
  from?: string | string[];
  to?: string | string[];
}): DateRange {
  const rawFrom = Array.isArray(params?.from) ? params?.from[0] : params?.from;
  const rawTo = Array.isArray(params?.to) ? params?.to[0] : params?.to;

  // Upper bound is exclusive: the END of the requested Bangkok day.
  const now = new Date();
  const parsedTo = rawTo ? bangkokMidnight(rawTo) : null;
  const to = parsedTo
    ? addDays(parsedTo, 1)
    : addDays(bangkokMidnight(toBangkokDateInput(now))!, 1);

  const parsedFrom = rawFrom ? bangkokMidnight(rawFrom) : null;
  let from = parsedFrom ?? addDays(to, -DEFAULT_DAYS);

  if (from >= to) {
    from = addDays(to, -DEFAULT_DAYS);
  }

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  if (days > MAX_DAYS) {
    from = addDays(to, -MAX_DAYS);
  }

  return {
    from,
    to,
    days: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
    fromInput: toBangkokDateInput(from),
    // The input shows the last INCLUDED day, not the exclusive bound.
    toInput: toBangkokDateInput(addDays(to, -1)),
  };
}

/** Preset windows offered in the range picker. */
export const RANGE_PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
] as const;

/** Build `?from=&to=` for a preset, anchored on today in Bangkok. */
export function presetRangeQuery(days: number, now: Date = new Date()): string {
  const todayInput = toBangkokDateInput(now);
  const fromInput = toBangkokDateInput(addDays(bangkokMidnight(todayInput)!, -(days - 1)));
  return `?from=${fromInput}&to=${todayInput}`;
}
