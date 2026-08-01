/**
 * Calendar arithmetic for RClipper Management access passes.
 *
 * These are the rules money depends on: a 3-month pass must grant three
 * CALENDAR months (not 90 days), month-end and leap-year dates must clamp
 * rather than roll forward into the next month, and buying a second pass must
 * preserve every remaining paid day.
 */

import {
  addCalendarMonths,
  daysInUtcMonth,
  accessExtensionStart,
  computeAccessWindow,
  isAccessActive,
  daysRemaining,
} from "@/lib/management/calendarMath";

const utc = (iso: string) => new Date(iso);

describe("daysInUtcMonth", () => {
  it("returns the correct length for each month", () => {
    expect(daysInUtcMonth(2026, 0)).toBe(31); // January
    expect(daysInUtcMonth(2026, 3)).toBe(30); // April
    expect(daysInUtcMonth(2026, 11)).toBe(31); // December — must not roll years
  });

  it("handles February in leap and non-leap years", () => {
    expect(daysInUtcMonth(2026, 1)).toBe(28);
    expect(daysInUtcMonth(2028, 1)).toBe(29);
    expect(daysInUtcMonth(2100, 1)).toBe(28); // century, not a leap year
    expect(daysInUtcMonth(2000, 1)).toBe(29); // divisible by 400, is a leap year
  });
});

describe("addCalendarMonths", () => {
  it("adds calendar months, not 30-day blocks", () => {
    // Feb has 28 days; a 30-day model would land on 17 April.
    expect(addCalendarMonths(utc("2026-02-15T00:00:00Z"), 3).toISOString()).toBe(
      "2026-05-15T00:00:00.000Z"
    );
  });

  it("preserves the time of day exactly", () => {
    expect(addCalendarMonths(utc("2026-01-15T09:30:45.123Z"), 3).toISOString()).toBe(
      "2026-04-15T09:30:45.123Z"
    );
  });

  it("clamps a month-end date into a shorter month", () => {
    // 31 Jan + 1 month must be 28 Feb, NOT 3 March.
    expect(addCalendarMonths(utc("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z"
    );
    expect(addCalendarMonths(utc("2026-03-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-04-30T00:00:00.000Z"
    );
  });

  it("clamps into February of a leap year", () => {
    expect(addCalendarMonths(utc("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z"
    );
  });

  it("clamps 29 February forward a year into a non-leap year", () => {
    expect(addCalendarMonths(utc("2028-02-29T00:00:00Z"), 12).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z"
    );
  });

  it("rolls over year boundaries", () => {
    expect(addCalendarMonths(utc("2026-12-01T00:00:00Z"), 3).toISOString()).toBe(
      "2027-03-01T00:00:00.000Z"
    );
    expect(addCalendarMonths(utc("2026-11-15T00:00:00Z"), 12).toISOString()).toBe(
      "2027-11-15T00:00:00.000Z"
    );
  });

  it("supports each purchasable duration", () => {
    const start = utc("2026-07-29T12:00:00Z");
    expect(addCalendarMonths(start, 3).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    expect(addCalendarMonths(start, 6).toISOString()).toBe("2027-01-29T12:00:00.000Z");
    expect(addCalendarMonths(start, 12).toISOString()).toBe("2027-07-29T12:00:00.000Z");
  });

  it("is unaffected by local daylight-saving transitions", () => {
    // Late March crosses a DST boundary in many zones. Because the maths runs
    // on UTC instants, the result is the same day-of-month regardless.
    expect(addCalendarMonths(utc("2026-02-28T23:30:00Z"), 1).toISOString()).toBe(
      "2026-03-28T23:30:00.000Z"
    );
  });

  it("rejects invalid input", () => {
    expect(() => addCalendarMonths(new Date("nonsense"), 3)).toThrow();
    expect(() => addCalendarMonths(utc("2026-01-01T00:00:00Z"), 1.5)).toThrow();
  });
});

describe("accessExtensionStart", () => {
  const now = utc("2026-12-01T00:00:00Z");

  it("starts now when the user has no access", () => {
    expect(accessExtensionStart(now, null)).toEqual(now);
  });

  it("starts at the current expiry when access is still live", () => {
    const expiry = utc("2026-12-31T00:00:00Z");
    expect(accessExtensionStart(now, expiry)).toEqual(expiry);
  });

  it("starts now when the previous access already lapsed", () => {
    expect(accessExtensionStart(now, utc("2026-06-01T00:00:00Z"))).toEqual(now);
  });
});

describe("computeAccessWindow — overlapping purchases preserve paid time", () => {
  it("matches the worked example from the specification", () => {
    // Access currently runs to 31 December. A 3-month pass bought on 1 December
    // must extend to 31 MARCH — not to 1 March, which would silently discard
    // the 30 days the user had already paid for.
    const { startsAt, expiresAt } = computeAccessWindow({
      now: utc("2026-12-01T00:00:00Z"),
      currentExpiresAt: utc("2026-12-31T00:00:00Z"),
      durationMonths: 3,
    });
    expect(startsAt.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(expiresAt.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });

  it("starts from now for a first purchase", () => {
    const { startsAt, expiresAt } = computeAccessWindow({
      now: utc("2026-07-29T00:00:00Z"),
      currentExpiresAt: null,
      durationMonths: 6,
    });
    expect(startsAt.toISOString()).toBe("2026-07-29T00:00:00.000Z");
    expect(expiresAt.toISOString()).toBe("2027-01-29T00:00:00.000Z");
  });

  it("stacks three consecutive purchases without losing a day", () => {
    const now = utc("2026-01-15T00:00:00Z");
    const first = computeAccessWindow({ now, currentExpiresAt: null, durationMonths: 3 });
    const second = computeAccessWindow({
      now,
      currentExpiresAt: first.expiresAt,
      durationMonths: 3,
    });
    const third = computeAccessWindow({
      now,
      currentExpiresAt: second.expiresAt,
      durationMonths: 6,
    });
    expect(first.expiresAt.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(second.expiresAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    // 3 + 3 + 6 = 12 calendar months from the original start.
    expect(third.expiresAt.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("does not resurrect time from an already-expired pass", () => {
    const { startsAt, expiresAt } = computeAccessWindow({
      now: utc("2026-12-01T00:00:00Z"),
      currentExpiresAt: utc("2026-01-01T00:00:00Z"),
      durationMonths: 3,
    });
    expect(startsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(expiresAt.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("rejects a non-positive duration", () => {
    expect(() =>
      computeAccessWindow({ now: new Date(), currentExpiresAt: null, durationMonths: 0 })
    ).toThrow();
  });
});

describe("isAccessActive / daysRemaining", () => {
  const now = utc("2026-07-29T00:00:00Z");

  it("treats a future expiry as active and a past one as not", () => {
    expect(isAccessActive(utc("2026-07-30T00:00:00Z"), now)).toBe(true);
    expect(isAccessActive(utc("2026-07-28T00:00:00Z"), now)).toBe(false);
    expect(isAccessActive(null, now)).toBe(false);
  });

  it("treats the exact expiry instant as no longer active", () => {
    expect(isAccessActive(now, now)).toBe(false);
  });

  it("floors the remaining days and never goes negative", () => {
    expect(daysRemaining(utc("2026-08-08T12:00:00Z"), now)).toBe(10);
    expect(daysRemaining(utc("2026-07-01T00:00:00Z"), now)).toBe(0);
    expect(daysRemaining(null, now)).toBe(0);
  });
});
