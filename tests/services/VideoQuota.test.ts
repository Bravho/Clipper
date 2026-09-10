/**
 * The monthly quota — who may make a video, on whose ticket, and what happens
 * when a render dies.
 *
 * Render capacity is the scarcest thing in the product (one clip is 2–3 hours on
 * a single worker), so these pin the two failures that cost real money: handing
 * out more videos than an account is entitled to, and charging someone a monthly
 * slot for a render that failed.
 */

jest.mock("@/repositories", () => {
  const {
    MockClipRequestRepository,
  } = require("@/repositories/mock/MockClipRequestRepository");
  const {
    MockVideoAllowanceWindowRepository,
  } = require("@/repositories/mock/MockVideoAllowanceWindowRepository");
  const {
    MockCreditWalletRepository,
  } = require("@/repositories/mock/MockCreditWalletRepository");
  const {
    MockCreditTransactionRepository,
  } = require("@/repositories/mock/MockCreditTransactionRepository");

  return {
    clipRequestRepository: new MockClipRequestRepository(new Map()),
    videoAllowanceWindowRepository: new MockVideoAllowanceWindowRepository(new Map()),
    creditWalletRepository: new MockCreditWalletRepository(new Map()),
    creditTransactionRepository: new MockCreditTransactionRepository(new Map()),
    creditPurchaseLogRepository: { create: jest.fn(), findByUserId: jest.fn(async () => []) },
  };
});

import { VideoQuotaService, QuotaExhaustedError } from "@/services/VideoQuotaService";
import { VideoPackagePurchaseService } from "@/services/VideoPackagePurchaseService";
import {
  FREE_REQUESTS_PER_WINDOW,
  REQUESTS_PER_PAID_MONTH,
  FREE_WINDOW_DAYS,
  findVideoPackage,
} from "@/config/videoPackages";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import type { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import type { MockVideoAllowanceWindowRepository } from "@/repositories/mock/MockVideoAllowanceWindowRepository";
import type { MockCreditWalletRepository } from "@/repositories/mock/MockCreditWalletRepository";

const repos = jest.requireMock("@/repositories") as {
  clipRequestRepository: MockClipRequestRepository;
  videoAllowanceWindowRepository: MockVideoAllowanceWindowRepository;
  creditWalletRepository: MockCreditWalletRepository;
};

const quota = new VideoQuotaService();
const purchases = new VideoPackagePurchaseService();

const DAY = 86_400_000;
const USER = "user-quota-1";

const FORM = {
  title: "Quota Test Clip",
  placeName: "Pho 54",
  latitude: 13.7563,
  longitude: 100.5018,
  description: "A description that is definitely long enough to pass validation.",
  targetAudience: "People who like testing software",
  targetPlatforms: [Platform.TikTok] as [Platform, ...Platform[]],
  preferredStyle: "Dynamic",
  preferredLanguage: "English",
  durationSeconds: 15,
};

/** Record a submitted request, as `submitRequest` would. */
async function submitted(userId: string, opts: { at?: Date; windowId?: string } = {}) {
  const draft = await repos.clipRequestRepository.create({ userId, ...FORM });
  return repos.clipRequestRepository.updateStatus(draft.id, RequestStatus.Submitted, {
    submittedAt: opts.at ?? new Date(),
    pricingTier: opts.windowId ? RequestPricingTier.Paid : RequestPricingTier.Free,
    videoAllowanceWindowId: opts.windowId ?? null,
  });
}

/**
 * Fund exactly what these packages cost.
 *
 * Deriving the amount from the catalogue rather than writing a literal is what
 * stops this fixture rotting the next time prices move — a repriced ladder
 * should not turn every purchase test red for a reason that has nothing to do
 * with what they assert.
 */
async function fundForPackages(
  userId: string,
  ...codes: Parameters<typeof findVideoPackage>[0][]
) {
  const total = codes.reduce(
    (sum, code) => sum + findVideoPackage(code)!.priceCredits,
    0
  );
  return fundWallet(userId, total);
}

async function fundWallet(userId: string, balance: number) {
  return repos.creditWalletRepository.create({
    userId,
    balance,
    initialCreditsGranted: true,
  });
}

beforeEach(() => {
  for (const repo of Object.values(repos)) {
    (repo as unknown as { store?: Map<string, unknown> }).store?.clear();
  }
});

describe("free allowance", () => {
  it("gives 3 videos per rolling 30 days, then refuses", async () => {
    for (let n = 0; n < FREE_REQUESTS_PER_WINDOW; n++) {
      const q = await quota.getQuota(USER);
      expect(q.tier).toBe(RequestPricingTier.Free);
      expect(q.remaining).toBe(FREE_REQUESTS_PER_WINDOW - n);
      await quota.consume(USER);
      await submitted(USER);
    }

    const spent = await quota.getQuota(USER);
    expect(spent.canSubmit).toBe(false);
    expect(spent.remaining).toBe(0);
    await expect(quota.consume(USER)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("slides: a submission older than the window stops counting", async () => {
    const now = new Date();
    // Three submissions, but the oldest is 31 days back and has aged out.
    await submitted(USER, { at: new Date(now.getTime() - 31 * DAY) });
    await submitted(USER, { at: new Date(now.getTime() - 2 * DAY) });
    await submitted(USER, { at: new Date(now.getTime() - 1 * DAY) });

    const q = await quota.getQuota(USER, now);
    expect(q.remaining).toBe(1);
    expect(q.canSubmit).toBe(true);
  });

  it("tells the user when their next free video arrives", async () => {
    const now = new Date("2026-09-08T12:00:00Z");
    const oldest = new Date(now.getTime() - 10 * DAY);
    await submitted(USER, { at: oldest });
    await submitted(USER, { at: new Date(now.getTime() - 5 * DAY) });
    await submitted(USER, { at: new Date(now.getTime() - 1 * DAY) });

    const q = await quota.getQuota(USER, now);
    expect(q.canSubmit).toBe(false);
    // A slot opens exactly 30 days after the oldest counted submission.
    expect(q.renewsAt?.getTime()).toBe(oldest.getTime() + FREE_WINDOW_DAYS * DAY);
  });

  it("counts only submitted requests — a draft never burns a slot", async () => {
    await repos.clipRequestRepository.create({ userId: USER, ...FORM });
    await repos.clipRequestRepository.create({ userId: USER, ...FORM });
    expect((await quota.getQuota(USER)).remaining).toBe(FREE_REQUESTS_PER_WINDOW);
  });

  it("does not count another user's submissions", async () => {
    await submitted("someone-else");
    expect((await quota.getQuota(USER)).remaining).toBe(FREE_REQUESTS_PER_WINDOW);
  });
});

describe("purchased allowance", () => {
  it("grants 10 videos a month and takes precedence over the free tier", async () => {
    await fundForPackages(USER, "video_1_month");
    await purchases.purchase(USER, "video_1_month");

    const q = await quota.getQuota(USER);
    expect(q.tier).toBe(RequestPricingTier.Paid);
    expect(q.total).toBe(REQUESTS_PER_PAID_MONTH);
    expect(q.remaining).toBe(REQUESTS_PER_PAID_MONTH);

    const consumed = await quota.consume(USER);
    expect(consumed.tier).toBe(RequestPricingTier.Paid);
    expect(consumed.allowanceWindowId).toBeTruthy();
  });

  it("debits the catalogue price, never a client-supplied one", async () => {
    const price = findVideoPackage("video_3_months")!.priceCredits;
    await fundWallet(USER, price + 100);
    const result = await purchases.purchase(USER, "video_3_months");
    expect(result.creditsSpent).toBe(price);
    expect(await repos.creditWalletRepository.findByUserId(USER).then((w) => w?.balance)).toBe(
      100
    );
  });

  it("refuses when the wallet is short, without granting anything", async () => {
    await fundWallet(USER, findVideoPackage("video_1_month")!.priceCredits - 1);
    await expect(purchases.purchase(USER, "video_1_month")).rejects.toThrow(
      /Insufficient credits/
    );
    expect(await repos.videoAllowanceWindowRepository.findByUserId(USER)).toHaveLength(0);
  });

  it("is idempotent: a double-clicked checkout grants one run of months", async () => {
    await fundForPackages(USER, "video_1_month", "video_1_month");
    const first = await purchases.purchase(USER, "video_1_month", "token-1");
    const second = await purchases.purchase(USER, "video_1_month", "token-1");

    expect(first.charged).toBe(true);
    expect(second.charged).toBe(false);
    expect(second.creditsSpent).toBe(0);
    expect(await repos.videoAllowanceWindowRepository.findByUserId(USER)).toHaveLength(1);
  });

  it("stacks a second purchase after existing paid time instead of overwriting it", async () => {
    await fundForPackages(USER, "video_1_month", "video_1_month");
    const first = await purchases.purchase(USER, "video_1_month", "token-a");
    const second = await purchases.purchase(USER, "video_1_month", "token-b");

    // Buying early must never destroy time already paid for.
    expect(second.windows[0].startsAt.getTime()).toBe(
      first.windows[0].expiresAt.getTime()
    );
    expect(second.activeUntil.getTime()).toBeGreaterThan(first.activeUntil.getTime());
  });

  it("does NOT aggregate: month 2's allowance is separate from month 1's", async () => {
    await fundForPackages(USER, "video_3_months");
    const { windows } = await purchases.purchase(USER, "video_3_months");

    // Spend everything in month 1.
    for (let n = 0; n < REQUESTS_PER_PAID_MONTH; n++) await quota.consume(USER);
    const afterMonth1 = await quota.getQuota(USER);
    expect(afterMonth1.tier).toBe(RequestPricingTier.Free);

    // Inside month 2 the allowance is a fresh 10 — not 10 plus anything unused.
    const insideMonth2 = new Date(windows[1].startsAt.getTime() + DAY);
    const q = await quota.getQuota(USER, insideMonth2);
    expect(q.tier).toBe(RequestPricingTier.Paid);
    expect(q.remaining).toBe(REQUESTS_PER_PAID_MONTH);
  });

  it("falls back to the free allowance once every window has elapsed", async () => {
    await fundForPackages(USER, "video_1_month");
    const { activeUntil } = await purchases.purchase(USER, "video_1_month");
    const afterExpiry = new Date(activeUntil.getTime() + DAY);

    const q = await quota.getQuota(USER, afterExpiry);
    expect(q.tier).toBe(RequestPricingTier.Free);
    expect(q.remaining).toBe(FREE_REQUESTS_PER_WINDOW);
  });

  it("cannot be driven below zero by simultaneous submissions", async () => {
    await fundForPackages(USER, "video_1_month");
    await purchases.purchase(USER, "video_1_month");

    // One more caller than there are requests in the month.
    const attempts = await Promise.allSettled(
      Array.from({ length: REQUESTS_PER_PAID_MONTH + 3 }, () => quota.consume(USER))
    );
    const paid = attempts.filter(
      (a) => a.status === "fulfilled" && a.value.tier === RequestPricingTier.Paid
    );
    expect(paid).toHaveLength(REQUESTS_PER_PAID_MONTH);

    const window = (await repos.videoAllowanceWindowRepository.findByUserId(USER))[0];
    expect(window.remaining).toBe(0);
  });
});

describe("refund on failure", () => {
  it("returns the video when a paid render fails", async () => {
    await fundForPackages(USER, "video_1_month");
    await purchases.purchase(USER, "video_1_month");
    const consumed = await quota.consume(USER);
    const request = await submitted(USER, { windowId: consumed.allowanceWindowId! });

    expect((await quota.getQuota(USER)).remaining).toBe(REQUESTS_PER_PAID_MONTH - 1);

    expect(await quota.refundRequest(request.id)).toBe(true);
    expect((await quota.getQuota(USER)).remaining).toBe(REQUESTS_PER_PAID_MONTH);
  });

  it("cannot refund the same request twice", async () => {
    await fundForPackages(USER, "video_1_month");
    await purchases.purchase(USER, "video_1_month");
    const consumed = await quota.consume(USER);
    const request = await submitted(USER, { windowId: consumed.allowanceWindowId! });

    await quota.refundRequest(request.id);
    // A retry that fails again must not manufacture a second video.
    expect(await quota.refundRequest(request.id)).toBe(false);
    expect((await quota.getQuota(USER)).remaining).toBe(REQUESTS_PER_PAID_MONTH);
  });

  it("is a no-op for a free-tier request", async () => {
    const request = await submitted(USER);
    // Free allowance is derived from submissions; the failed one ages out on its
    // own, so there is nothing to give back.
    expect(await quota.refundRequest(request.id)).toBe(false);
  });
});
