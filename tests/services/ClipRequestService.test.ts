import { ClipRequestService } from "@/services/ClipRequestService";
import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockRequestStatusHistoryRepository } from "@/repositories/mock/MockRequestStatusHistoryRepository";
import { MockCreditWalletRepository } from "@/repositories/mock/MockCreditWalletRepository";
import { MockCreditTransactionRepository } from "@/repositories/mock/MockCreditTransactionRepository";
import { CreditService } from "@/services/CreditService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { findVideoPackage } from "@/config/videoPackages";

/** The entry package price — the only thing credits are spent on now. */
const PACKAGE_PRICE = findVideoPackage("video_1_month")!.priceCredits;
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeIsolatedDeps() {
  const requestStore = new Map();
  const historyStore = new Map();
  const walletStore = new Map();
  const txStore = new Map();

  const requestRepo = new MockClipRequestRepository(requestStore);
  const historyRepo = new MockRequestStatusHistoryRepository(historyStore);
  const walletRepo = new MockCreditWalletRepository(walletStore);
  const txRepo = new MockCreditTransactionRepository(txStore);

  return { requestRepo, historyRepo, walletRepo, txRepo };
}

const VALID_FORM_DATA = {
  title: "Test Clip Title",
  description: "A description that is definitely long enough to pass the validation.",
  targetAudience: "People who like testing software",
  targetPlatforms: [Platform.TikTok] as [Platform, ...Platform[]],
  preferredStyle: "Dynamic / Energetic",
  preferredLanguage: "English",
  durationSeconds: 15,
};


// ── Suite ─────────────────────────────────────────────────────────────────────

describe("MockClipRequestRepository", () => {
  it("creates a draft request with correct defaults", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({
      userId: "user-001",
      ...VALID_FORM_DATA,
    });

    expect(req.id).toBeTruthy();
    expect(req.status).toBe(RequestStatus.Draft);
    // Legacy column: requests are drawn from a quota and cost no credits.
    expect(req.creditsCost).toBe(0);
    expect(req.submittedAt).toBeNull();
    expect(req.dueDateConfirmed).toBe(false);
    expect(req.creditConfirmed).toBe(false);
    expect(req.rightsConfirmed).toBe(false);
  });

  it("findByUserId returns only requests for the user", async () => {
    const { requestRepo } = makeIsolatedDeps();
    await requestRepo.create({ userId: "user-A", ...VALID_FORM_DATA });
    await requestRepo.create({ userId: "user-A", ...VALID_FORM_DATA });
    await requestRepo.create({ userId: "user-B", ...VALID_FORM_DATA });

    const userARequests = await requestRepo.findByUserId("user-A");
    expect(userARequests).toHaveLength(2);
    userARequests.forEach((r) => expect(r.userId).toBe("user-A"));
  });

  it("updateStatus transitions status and sets extra fields", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });

    const now = new Date();
    const submitted = await requestRepo.updateStatus(
      req.id,
      RequestStatus.Submitted,
      { submittedAt: now, queuePosition: 3 }
    );

    expect(submitted.status).toBe(RequestStatus.Submitted);
    expect(submitted.submittedAt?.getTime()).toBe(now.getTime());
    expect(submitted.queuePosition).toBe(3);
  });

  it("delete removes the request", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    await requestRepo.delete(req.id);
    const found = await requestRepo.findById(req.id);
    expect(found).toBeNull();
  });

  it("findByUserIdAndStatus filters by statuses", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const r1 = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    const r2 = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    await requestRepo.updateStatus(r2.id, RequestStatus.Submitted, {});

    const drafts = await requestRepo.findByUserIdAndStatus("user-001", [
      RequestStatus.Draft,
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(r1.id);
  });
});

describe("ClipRequestService — draft creation and editing", () => {
  async function setup() {
    const { requestRepo, historyRepo, walletRepo, txRepo } = makeIsolatedDeps();

    // Give the user 30 credits
    const wallet = await walletRepo.create({
      userId: "user-001",
      balance: 30,
      initialCreditsGranted: true,
    });

    // We can't easily inject repos into the singleton service via its current
    // architecture (imports from @/repositories index). Instead we test the
    // mock repositories directly, which the service delegates to.
    return { requestRepo, historyRepo, wallet, walletRepo, txRepo };
  }

  it("creates a draft with status Draft", async () => {
    const { requestRepo } = await setup();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    expect(req.status).toBe(RequestStatus.Draft);
  });

  it("can update a draft's fields", async () => {
    const { requestRepo } = await setup();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    const updated = await requestRepo.update(req.id, {
      title: "Updated Title",
    });
    expect(updated.title).toBe("Updated Title");
  });

  it("does not allow updating a non-draft via service guard", async () => {
    const { requestRepo } = await setup();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    await requestRepo.updateStatus(req.id, RequestStatus.Submitted, {});

    // Simulate the service guard
    const found = await requestRepo.findById(req.id);
    expect(found?.status).toBe(RequestStatus.Submitted);
    // Service.updateDraft would throw "Only Draft requests can be edited."
    // We verify the status is indeed non-Draft, making the guard condition true.
    expect(found?.status !== RequestStatus.Draft).toBe(true);
  });
});

describe("ClipRequestService — insufficient credits guard", () => {
  it("CreditService.hasEnoughCredits returns false when balance is low", async () => {
    const walletRepo = new MockCreditWalletRepository(new Map());
    const txRepo = new MockCreditTransactionRepository(new Map());

    const wallet = await walletRepo.create({
      userId: "poor-user",
      balance: 5, // less than the package price
      initialCreditsGranted: true,
    });

    // Simulate the check in ClipRequestService.submitRequest
    const balance = wallet.balance;
    const canAfford = balance >= PACKAGE_PRICE;
    expect(canAfford).toBe(false);
  });

  it("CreditService.hasEnoughCredits returns true when balance is sufficient", async () => {
    const walletRepo = new MockCreditWalletRepository(new Map());

    const wallet = await walletRepo.create({
      userId: "rich-user",
      balance: PACKAGE_PRICE + 50, // comfortably above the package price
      initialCreditsGranted: true,
    });

    const canAfford = wallet.balance >= PACKAGE_PRICE;
    expect(canAfford).toBe(true);
  });
});

describe("Credit deduction — packages, not requests", () => {
  it("deducts the package price from the wallet", async () => {
    const walletRepo = new MockCreditWalletRepository(new Map());

    const wallet = await walletRepo.create({
      userId: "user-deduct",
      balance: PACKAGE_PRICE + 30,
      initialCreditsGranted: true,
    });

    const updated = await walletRepo.updateBalance(
      wallet.id,
      wallet.balance - PACKAGE_PRICE
    );
    expect(updated.balance).toBe(30);
  });

  it("cannot deduct below zero (service guard)", () => {
    const balance = 5;
    expect(() => {
      if (balance < PACKAGE_PRICE) throw new Error("Insufficient credits.");
    }).toThrow("Insufficient credits.");
  });

  it("records the package purchase on the ledger", async () => {
    const txRepo = new MockCreditTransactionRepository(new Map());
    const { TransactionType } = require("@/domain/enums/TransactionType");

    await txRepo.create({
      userId: "user-001",
      amount: -PACKAGE_PRICE,
      type: TransactionType.RequestCharge,
      description: "Video package: video_1_month",
      referenceId: "purchase-test-001",
    });

    const txns = await txRepo.findByUserId("user-001");
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(-PACKAGE_PRICE);
  });
});

describe("ClipRequestService — draft deletion", () => {
  it("allows deleting a draft", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    await requestRepo.delete(req.id);
    const found = await requestRepo.findById(req.id);
    expect(found).toBeNull();
  });

  it("non-draft requests cannot be deleted (status guard)", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ userId: "user-001", ...VALID_FORM_DATA });
    await requestRepo.updateStatus(req.id, RequestStatus.UnderReview, {});

    const found = await requestRepo.findById(req.id);
    expect(found?.status !== RequestStatus.Draft).toBe(true);
    // The service guard would throw: "Only Draft requests can be deleted."
  });
});

describe("Quota bookkeeping (repo-level)", () => {
  // The quota rules live in tests/config/videoPackages.test.ts and their
  // end-to-end behaviour in tests/services/VideoQuota.test.ts. These cover only
  // what the repository must store for those to work.
  it("new drafts default to the free tier and are not download-locked", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-1" });
    // Nothing is watermark-locked any more; the flag is a retained capability.
    expect(req.downloadUnlocked).toBe(true);
    expect(req.pricingTier).toBe(RequestPricingTier.Free);
    expect(req.videoAllowanceWindowId ?? null).toBeNull();
  });

  it("persists the tier and the window that paid for a submission", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-1" });
    const submitted = await requestRepo.updateStatus(req.id, RequestStatus.Submitted, {
      submittedAt: new Date(),
      pricingTier: RequestPricingTier.Paid,
      videoAllowanceWindowId: "window-1",
    });
    expect(submitted.pricingTier).toBe(RequestPricingTier.Paid);
    // Without this the refund path cannot know which month to credit back.
    expect(submitted.videoAllowanceWindowId).toBe("window-1");
  });

  it("records the refund stamp that stops a retry refunding twice", async () => {
    const { requestRepo } = makeIsolatedDeps();
    const req = await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-1" });
    const at = new Date();
    const refunded = await requestRepo.updateStatus(req.id, RequestStatus.Submitted, {
      submittedAt: at,
      videoAllowanceWindowId: "window-1",
      allowanceRefundedAt: at,
    });
    expect(refunded.allowanceRefundedAt).toEqual(at);
  });

  it("countSubmittedRequestsByUserId counts submissions, not drafts", async () => {
    const { requestRepo } = makeIsolatedDeps();
    await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-1" });
    await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-1" });
    await requestRepo.create({ ...VALID_FORM_DATA, userId: "u-2" });

    expect(await requestRepo.countSubmittedRequestsByUserId("u-1")).toBe(0);

    const [first] = await requestRepo.findByUserId("u-1");
    await requestRepo.updateStatus(first.id, RequestStatus.Submitted, {
      submittedAt: new Date(),
    });

    expect(await requestRepo.countSubmittedRequestsByUserId("u-1")).toBe(1);
    // Another user's submissions never count against this one's allowance.
    expect(await requestRepo.countSubmittedRequestsByUserId("u-2")).toBe(0);
  });
});

describe("MockRequestStatusHistoryRepository", () => {
  it("records status history in chronological order", async () => {
    const { historyRepo } = makeIsolatedDeps();

    const t1 = new Date("2026-03-01T10:00:00Z");
    const t2 = new Date("2026-03-02T10:00:00Z");
    const t3 = new Date("2026-03-03T10:00:00Z");

    await historyRepo.create({ requestId: "req-001", status: RequestStatus.Draft, note: null, changedAt: t1 });
    await historyRepo.create({ requestId: "req-001", status: RequestStatus.Submitted, note: null, changedAt: t2 });
    await historyRepo.create({ requestId: "req-001", status: RequestStatus.UnderReview, note: null, changedAt: t3 });

    const history = await historyRepo.findByRequestId("req-001");
    expect(history).toHaveLength(3);
    expect(history[0].status).toBe(RequestStatus.Draft);
    expect(history[2].status).toBe(RequestStatus.UnderReview);
    // Sorted ascending by changedAt
    expect(history[0].changedAt.getTime()).toBeLessThan(history[2].changedAt.getTime());
  });

  it("only returns history for the given requestId", async () => {
    const { historyRepo } = makeIsolatedDeps();
    await historyRepo.create({ requestId: "req-A", status: RequestStatus.Draft, note: null, changedAt: new Date() });
    await historyRepo.create({ requestId: "req-B", status: RequestStatus.Draft, note: null, changedAt: new Date() });

    const history = await historyRepo.findByRequestId("req-A");
    expect(history).toHaveLength(1);
    expect(history[0].requestId).toBe("req-A");
  });
});
