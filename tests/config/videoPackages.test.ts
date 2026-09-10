import {
  VIDEO_PACKAGES,
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  REQUESTS_PER_PAID_MONTH,
  findVideoPackage,
  creditsPerMonth,
  expandPackageWindows,
  freeWindowStart,
} from "@/config/videoPackages";

/**
 * The package catalogue decides both what a user pays and how much render
 * capacity they can take, so its arithmetic is pinned here rather than inferred
 * from whatever the services happen to do.
 */

const DAY = 86_400_000;

describe("catalogue", () => {
  it("matches the advertised ladder", () => {
    expect(FREE_REQUESTS_PER_WINDOW).toBe(3);
    expect(FREE_WINDOW_DAYS).toBe(30);
    expect(REQUESTS_PER_PAID_MONTH).toBe(10);

    expect(
      VIDEO_PACKAGES.map((p) => [p.code, p.months, p.priceCredits])
    ).toEqual([
      ["video_1_month", 1, 200],
      ["video_3_months", 3, 570],
      ["video_6_months", 6, 1140],
      ["video_12_months", 12, 2160],
    ]);
  });

  it("never charges MORE per month for a longer commitment", () => {
    // The ladder is meant to taper. A longer term that costs more per month is a
    // pricing bug users would notice immediately.
    const perMonth = VIDEO_PACKAGES.map(creditsPerMonth);
    for (let i = 1; i < perMonth.length; i++) {
      expect(perMonth[i]).toBeLessThanOrEqual(perMonth[i - 1]);
    }
  });

  it("resolves and rejects codes", () => {
    expect(findVideoPackage("video_3_months")?.months).toBe(3);
    expect(findVideoPackage("nope" as never)).toBeNull();
  });
});

describe("expandPackageWindows", () => {
  it("gives one window of 10 requests per month bought", () => {
    const pkg = findVideoPackage("video_3_months")!;
    const windows = expandPackageWindows(pkg, new Date("2026-02-02T00:00:00Z"));
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.allowance === REQUESTS_PER_PAID_MONTH)).toBe(true);
  });

  it("runs the windows back-to-back, which is what stops allowances aggregating", () => {
    const pkg = findVideoPackage("video_6_months")!;
    const start = new Date("2026-02-02T00:00:00Z");
    const windows = expandPackageWindows(pkg, start);

    for (let i = 1; i < windows.length; i++) {
      // Month N+1 begins exactly when month N expires, so month N's unspent
      // requests die with it. No carry-over logic exists anywhere else.
      expect(windows[i].startsAt.getTime()).toBe(windows[i - 1].expiresAt.getTime());
    }
    expect(windows[0].startsAt.getTime()).toBe(start.getTime());
  });

  it("treats a month as 30 days for the short packages", () => {
    for (const code of ["video_1_month", "video_3_months", "video_6_months"] as const) {
      const pkg = findVideoPackage(code)!;
      const start = new Date("2026-02-02T00:00:00Z");
      const windows = expandPackageWindows(pkg, start);
      const totalDays =
        (windows[windows.length - 1].expiresAt.getTime() - start.getTime()) / DAY;
      expect(totalDays).toBe(pkg.months * 30);
    }
  });

  it("makes the annual package land on a real calendar year", () => {
    // 2 Feb 2026 → 2 Feb 2027, not 30×12 = 360 days later.
    const pkg = findVideoPackage("video_12_months")!;
    const start = new Date("2026-02-02T00:00:00Z");
    const windows = expandPackageWindows(pkg, start);

    expect(windows).toHaveLength(12);
    expect(windows[11].expiresAt.toISOString()).toBe("2027-02-02T00:00:00.000Z");
  });

  it("clamps month-end starts without letting the clamp compound", () => {
    // 31 Jan + 1 month is 28 Feb, not 3 March — the naive setMonth would overflow
    // and hand out a longer window than was paid for. But the clamp must not
    // carry: measuring each boundary from the previous one would drag the whole
    // year back to 28 Jan, three days short of the anniversary the buyer paid for.
    const pkg = findVideoPackage("video_12_months")!;
    const windows = expandPackageWindows(pkg, new Date("2026-01-31T00:00:00Z"));
    expect(windows[0].expiresAt.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(windows[1].expiresAt.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(windows[11].expiresAt.toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });

  it("handles a 29 February start without losing or gaining a day", () => {
    const pkg = findVideoPackage("video_12_months")!;
    const windows = expandPackageWindows(pkg, new Date("2028-02-29T00:00:00Z"));
    // 2029 has no 29 Feb, so the anniversary clamps to the 28th.
    expect(windows[11].expiresAt.toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

describe("freeWindowStart", () => {
  it("is a sliding 30-day window, not a fixed reset date", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(freeWindowStart(now).toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });
});
