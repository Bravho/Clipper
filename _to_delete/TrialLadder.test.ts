/**
 * End-to-end trial ladder through ClipRequestService.submitRequest().
 *
 * The ladder is the money path: request #1 is free and unwatermarked, #2–#4 are
 * free but locked behind the watermark, and #5 onward is charged before anything
 * is generated. These tests submit five requests for one user and pin what each
 * one costs and what it is allowed to download — the failure this guards against
 * is a user being shown "free" and then charged, or being handed a clean master
 * they never paid for.
 */

// UploadService pulls in `sharp`, whose native binary is not present in every
// environment this suite runs in — and none of the ladder paths touch uploads.
jest.mock("@/services/UploadService", () => ({
  uploadService: { deleteAssetsByRequestId: jest.fn(async () => {}) },
}));

jest.mock("@/lib/spaces", () => ({
  spacesMoveObject: jest.fn(),
  spacesPublicUrl: jest.fn((k: string) => `https://cdn.test/${k}`),
  SPACES_BUCKET: "test-bucket",
  spacesClient: {},
}));

jest.mock("@/repositories", () => {
  const {
    MockClipRequestRepository,
  } = require("@/repositories/mock/MockClipRequestRepository");
  const {
    MockRequestStatusHistoryRepository,
  } = require("@/repositories/mock/MockRequestStatusHistoryRepository");
  const { MockUserRepository } = require("@/repositories/mock/MockUserRepository");
  const {
    MockCreditWalletRepository,
  } = require("@/repositories/mock/MockCreditWalletRepository");
  const {
    MockCreditTransactionRepository,
  } = require("@/repositories/mock/MockCreditTransactionRepository");
  const {
    MockUploadedAssetRepository,
  } = require("@/repositories/mock/MockUploadedAssetRepository");

  return {
    clipRequestRepository: new MockClipRequestRepository(new Map()),
    requestStatusHistoryRepository: new MockRequestStatusHistoryRepository(new Map()),
    userRepository: new MockUserRepository(new Map()),
    creditWalletRepository: new MockCreditWalletRepository(new Map()),
    creditTransactionRepository: new MockCreditTransactionRepository(new Map()),
    creditPurchaseLogRepository: { create: jest.fn(), findByUserId: jest.fn(async () => []) },
    uploadedAssetRepository: new MockUploadedAssetRepository(new Map()),
    // unlockDownload resumes the pipeline through this; a stub is enough because
    // the dispatch itself is asserted via the mocked video service below.
    videoGenerationJobRepository: { findByRequestId: jest.fn(async () => null) },
  };
});

// Payment now STARTS the expensive multi-ratio render, so unlockDownload reaches
// into the video pipeline. Mock it: this suite is about who gets charged and what
// gets dispatched, not about FFmpeg.
const generateAdditionalRatiosMock = jest.fn(async () => ({}));
jest.mock("@/services/VideoGenerationService", () => ({
  videoGenerationService: {
    generateAdditionalRatiosByRequester: (...args: unknown[]) =>
      generateAdditionalRatiosMock(...(args as [])),
  },
}));

import { ClipRequestService } from "@/services/ClipRequestService";
import { CREDITS_CONFIG } from "@/config/credits";
import { TRIAL_CONFIG } from "@/config/trial";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import { Platform } from "@/domain/enums/Platform";
import { Role } from "@/domain/enums/Role";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import type { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import type { MockUserRepository } from "@/repositories/mock/MockUserRepository";
import type { MockCreditWalletRepository } from "@/repositories/mock/MockCreditWalletRepository";
import type { MockCreditTransactionRepository } from "@/repositories/mock/MockCreditTransactionRepository";

const repos = jest.requireMock("@/repositories") as {
  clipRequestRepository: MockClipRequestRepository;
  userRepository: MockUserRepository;
  creditWalletRepository: MockCreditWalletRepository;
  creditTransactionRepository: MockCreditTransactionRepository;
  videoGenerationJobRepository: { findByRequestId: jest.Mock };
};

const COST = CREDITS_CONFIG.REQUEST_COST_CREDITS;
const service = new ClipRequestService();

const FORM = {
  title: "Ladder Test Clip",
  placeName: "Pho 54",
  latitude: 13.7563,
  longitude: 100.5018,
  description: "A description that is definitely long enough to pass validation.",
  targetAudience: "People who like testing software",
  targetPlatforms: [Platform.TikTok] as [Platform, ...Platform[]],
  preferredStyle: "Dynamic / Energetic",
  preferredLanguage: "English",
  durationSeconds: 15,
};

function clearStores() {
  for (const repo of Object.values(repos)) {
    (repo as unknown as { store?: Map<string, unknown> }).store?.clear();
  }
}

async function makeUser(priorTrialRequestsUsed = 0) {
  return repos.userRepository.create({
    email: `ladder-${crypto.randomUUID()}@example.com`,
    name: "Ladder Tester",
    role: Role.Requester,
    emailVerified: true,
    priorTrialRequestsUsed,
  });
}

async function fundWallet(userId: string, balance: number) {
  return repos.creditWalletRepository.create({
    userId,
    balance,
    initialCreditsGranted: true,
  });
}

async function balanceOf(userId: string) {
  return (await repos.creditWalletRepository.findByUserId(userId))?.balance ?? 0;
}

/** Create a draft and submit it, returning the submitted request. */
async function submitOne(userId: string) {
  const draft = await service.createDraft(userId, FORM);
  return service.submitRequest(draft.id, userId, true, true, true);
}

beforeEach(() => {
  clearStores();
  generateAdditionalRatiosMock.mockClear();
  repos.videoGenerationJobRepository.findByRequestId.mockReset();
  repos.videoGenerationJobRepository.findByRequestId.mockResolvedValue(null);
});

/** Park a fake pipeline job for `requestId` at the given step. */
function jobAtStep(requestId: string, currentStep: string) {
  repos.videoGenerationJobRepository.findByRequestId.mockImplementation(
    async (id: string) =>
      id === requestId ? { id: `job-${requestId}`, requestId, currentStep } : null
  );
}

describe("Trial ladder — submitRequest", () => {
  it("walks 1 free clean → 3 free previews → paid, charging only the fifth", async () => {
    const user = await makeUser();
    // Enough for exactly one paid request, so an accidental charge on any of the
    // free rungs would show up as a shortfall on the fifth.
    await fundWallet(user.id, COST);

    const first = await submitOne(user.id);
    expect(first.pricingTier).toBe(RequestPricingTier.FreeClean);
    expect(first.isTrialRequest).toBe(true);
    expect(first.downloadUnlocked).toBe(true);
    expect(await balanceOf(user.id)).toBe(COST);

    for (let n = 2; n <= 4; n++) {
      const preview = await submitOne(user.id);
      expect(preview.pricingTier).toBe(RequestPricingTier.FreePreview);
      expect(preview.isTrialRequest).toBe(true);
      expect(preview.downloadUnlocked).toBe(false);
      expect(await balanceOf(user.id)).toBe(COST);
    }

    const paid = await submitOne(user.id);
    expect(paid.pricingTier).toBe(RequestPricingTier.PaidUpfront);
    expect(paid.isTrialRequest).toBe(false);
    expect(paid.downloadUnlocked).toBe(true);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("lets a zero-credit user spend all four free clips, then blocks the fifth", async () => {
    const user = await makeUser();
    await fundWallet(user.id, 0);

    for (let n = 1; n <= TRIAL_CONFIG.FREE_REQUESTS_TOTAL; n++) {
      const req = await submitOne(user.id);
      expect(req.status).toBe(RequestStatus.Submitted);
    }

    await expect(submitOne(user.id)).rejects.toThrow(/Insufficient credits/);
  });

  it("counts only submitted requests — abandoned drafts do not burn a free clip", async () => {
    const user = await makeUser();
    await fundWallet(user.id, 0);

    await service.createDraft(user.id, FORM);
    await service.createDraft(user.id, FORM);

    const first = await submitOne(user.id);
    expect(first.pricingTier).toBe(RequestPricingTier.FreeClean);
  });

  it("resumes the ladder from a carried-over count after delete-and-recreate", async () => {
    // Previous life submitted 3 requests, so only the last preview slot remains.
    const user = await makeUser(3);
    await fundWallet(user.id, COST);

    const lastPreview = await submitOne(user.id);
    expect(lastPreview.pricingTier).toBe(RequestPricingTier.FreePreview);
    expect(lastPreview.downloadUnlocked).toBe(false);
    expect(await balanceOf(user.id)).toBe(COST);

    const paid = await submitOne(user.id);
    expect(paid.pricingTier).toBe(RequestPricingTier.PaidUpfront);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("an identity that spent the whole allowance starts paid immediately", async () => {
    const user = await makeUser(TRIAL_CONFIG.FREE_REQUESTS_TOTAL);
    await fundWallet(user.id, COST);

    const req = await submitOne(user.id);
    expect(req.pricingTier).toBe(RequestPricingTier.PaidUpfront);
    expect(await balanceOf(user.id)).toBe(0);
  });
});

describe("Trial ladder — unlockDownload", () => {
  it("charges once to unlock a watermarked preview, and is idempotent", async () => {
    const user = await makeUser(1); // straight onto the preview rung
    await fundWallet(user.id, COST * 2);

    const preview = await submitOne(user.id);
    expect(preview.downloadUnlocked).toBe(false);

    const unlocked = await service.unlockDownload(preview.id, user.id);
    expect(unlocked.downloadUnlocked).toBe(true);
    expect(await balanceOf(user.id)).toBe(COST);

    // Paying twice for the same clip is the bug this guards against.
    await service.unlockDownload(preview.id, user.id);
    expect(await balanceOf(user.id)).toBe(COST);
  });

  it("is a no-op on the free clean clip — it was never locked", async () => {
    const user = await makeUser();
    await fundWallet(user.id, COST);

    const free = await submitOne(user.id);
    expect(free.downloadUnlocked).toBe(true);

    await service.unlockDownload(free.id, user.id);
    expect(await balanceOf(user.id)).toBe(COST);
  });

  it("refuses to unlock when the wallet is short, without partially charging", async () => {
    const user = await makeUser(1);
    await fundWallet(user.id, COST - 1);

    const preview = await submitOne(user.id);
    await expect(service.unlockDownload(preview.id, user.id)).rejects.toThrow(
      /Insufficient credits/
    );
    expect(await balanceOf(user.id)).toBe(COST - 1);

    const stillLocked = await repos.clipRequestRepository.findById(preview.id);
    expect(stillLocked?.downloadUnlocked).toBe(false);
  });
});

describe("Trial ladder — getEntitlement", () => {
  it("reports the rung the next request will land on", async () => {
    const user = await makeUser();
    await fundWallet(user.id, 0);

    expect((await service.getEntitlement(user.id)).tier).toBe(
      RequestPricingTier.FreeClean
    );

    await submitOne(user.id);
    const afterFirst = await service.getEntitlement(user.id);
    expect(afterFirst.tier).toBe(RequestPricingTier.FreePreview);
    expect(afterFirst.previewRemaining).toBe(TRIAL_CONFIG.FREE_PREVIEW_REQUESTS);
    expect(afterFirst.hasFreeAllowanceLeft).toBe(true);
  });
});

/**
 * Paying is now what buys the expensive half of the pipeline: a preview renders
 * one ratio and parks at AwaitingAdditionalRatios until the unlock is paid. The
 * requester should not then have to hunt for a button — the payment presses it.
 */
describe("Trial ladder — unlock resumes the render", () => {
  const GATE = "awaiting_additional_ratios";

  it("starts the remaining-ratios render when the job is waiting at the paywall", async () => {
    const user = await makeUser(1);
    await fundWallet(user.id, COST);
    const preview = await submitOne(user.id);
    jobAtStep(preview.id, GATE);

    await service.unlockDownload(preview.id, user.id);

    expect(generateAdditionalRatiosMock).toHaveBeenCalledTimes(1);
    expect(generateAdditionalRatiosMock).toHaveBeenCalledWith(
      `job-${preview.id}`,
      user.id
    );
  });

  it("does not touch the pipeline when the job is somewhere else", async () => {
    const user = await makeUser(1);
    await fundWallet(user.id, COST);
    const preview = await submitOne(user.id);
    jobAtStep(preview.id, "awaiting_distribution_review");

    await service.unlockDownload(preview.id, user.id);

    expect(generateAdditionalRatiosMock).not.toHaveBeenCalled();
  });

  it("keeps the unlock even when the dispatch fails", async () => {
    const user = await makeUser(1);
    await fundWallet(user.id, COST);
    const preview = await submitOne(user.id);
    jobAtStep(preview.id, GATE);
    generateAdditionalRatiosMock.mockRejectedValueOnce(new Error("worker down"));

    // The user has been charged. A dispatch hiccup must not throw that away —
    // the gate stays pressable from the UI.
    const unlocked = await service.unlockDownload(preview.id, user.id);
    expect(unlocked.downloadUnlocked).toBe(true);
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("a repeat unlock neither re-charges nor re-dispatches", async () => {
    const user = await makeUser(1);
    await fundWallet(user.id, COST * 2);
    const preview = await submitOne(user.id);
    jobAtStep(preview.id, GATE);

    await service.unlockDownload(preview.id, user.id);
    await service.unlockDownload(preview.id, user.id);

    expect(generateAdditionalRatiosMock).toHaveBeenCalledTimes(1);
    expect(await balanceOf(user.id)).toBe(COST);
  });
});
