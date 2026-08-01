/**
 * Calendar arithmetic for RClipper Management access passes.
 *
 * WHY NOT A LIBRARY: the repository has no date library installed (no date-fns,
 * dayjs or luxon) and adding one for three functions is not worth the dependency
 * surface. These helpers are pure, UTC-only and unit-tested against the exact
 * edge cases the access-pass rules care about.
 *
 * INVARIANTS
 *   * Every value in and out is a UTC instant. Access windows are stored in
 *     TIMESTAMPTZ columns and only converted to the user's local time for
 *     display, in the browser.
 *   * "Add N calendar months" means the same day-of-month N months later, NOT
 *     N * 30 days. A 3-month pass bought on 15 January expires on 15 April.
 *   * When the target month is too short, the day is CLAMPED to that month's
 *     last day (31 January + 1 month -> 28 or 29 February). Clamping is the
 *     conventional, user-favourable behaviour: it never silently rolls the
 *     expiry forward into the following month, which would hand out free days,
 *     and never rolls it backward past the paid period.
 *   * Time-of-day is preserved exactly, so a pass never gains or loses hours.
 *
 * DAYLIGHT SAVING: because all arithmetic happens on UTC instants, DST
 * transitions in the user's local zone cannot shift a stored expiry. A user in
 * a DST zone may see the local clock time of their expiry differ by an hour
 * across a transition; the underlying instant, and therefore the amount of
 * access paid for, is unchanged. This is the correct trade-off for a paid
 * entitlement: the duration is exact even though the wall-clock label moves.
 */

/** Days in a given UTC month. `month` is 0-based, matching Date.getUTCMonth(). */
export function daysInUtcMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one. Date.UTC normalises a
  // month index of 12 into January of the following year, so December is safe.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add `months` calendar months to a UTC instant, clamping the day-of-month to
 * the length of the target month.
 *
 * Examples:
 *   2026-01-15T09:30Z  + 3  -> 2026-04-15T09:30Z
 *   2026-01-31T00:00Z  + 1  -> 2026-02-28T00:00Z   (clamped, non-leap)
 *   2028-01-31T00:00Z  + 1  -> 2028-02-29T00:00Z   (clamped, leap)
 *   2028-02-29T00:00Z  + 12 -> 2029-02-28T00:00Z   (clamped, leap -> non-leap)
 *   2026-12-01T00:00Z  + 3  -> 2027-03-01T00:00Z   (year rollover)
 */
export function addCalendarMonths(start: Date, months: number): Date {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error("addCalendarMonths: start must be a valid Date.");
  }
  if (!Number.isInteger(months)) {
    throw new Error("addCalendarMonths: months must be an integer.");
  }

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  // Absolute month index lets us cross year boundaries in either direction
  // without special-casing negative months.
  const absoluteMonth = year * 12 + month + months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth - targetYear * 12;

  const clampedDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds()
    )
  );
}

/**
 * Where a newly purchased access pass should START.
 *
 * Overlapping purchases must PRESERVE remaining paid time: buying a 3-month
 * pass on 1 December while access already runs to 31 December must extend to
 * 31 March, not replace the expiry with 1 March. So the new pass begins at the
 * later of "now" and the current active expiry.
 *
 * `currentExpiresAt` should be the effective expiry across all active,
 * non-revoked passes, or null when the user has no live access.
 */
export function accessExtensionStart(
  now: Date,
  currentExpiresAt: Date | null
): Date {
  if (!currentExpiresAt) return now;
  return currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : now;
}

/**
 * Full access window for a newly purchased pass, honouring any remaining time.
 *
 *   extensionStart = later of (now, current active expiry)
 *   expiresAt      = extensionStart + durationMonths calendar months
 */
export function computeAccessWindow(params: {
  now: Date;
  currentExpiresAt: Date | null;
  durationMonths: number;
}): { startsAt: Date; expiresAt: Date } {
  const { now, currentExpiresAt, durationMonths } = params;
  if (!Number.isInteger(durationMonths) || durationMonths <= 0) {
    throw new Error("computeAccessWindow: durationMonths must be a positive integer.");
  }
  const startsAt = accessExtensionStart(now, currentExpiresAt);
  return { startsAt, expiresAt: addCalendarMonths(startsAt, durationMonths) };
}

/** True when `expiresAt` is strictly in the future relative to `now`. */
export function isAccessActive(expiresAt: Date | null, now: Date = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() > now.getTime();
}

/**
 * Whole days remaining until `expiresAt`, floored at 0. Used only for display
 * ("expires in 12 days") and for choosing which expiry reminder to send.
 */
export function daysRemaining(expiresAt: Date | null, now: Date = new Date()): number {
  if (!expiresAt) return 0;
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}
