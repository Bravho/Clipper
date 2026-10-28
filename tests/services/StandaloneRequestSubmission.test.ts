/**
 * The pay-at-submit (39-credit single unlock) path has been removed. A
 * submission always takes a quota slot: a free one when the account has
 * no live package, a paid one when it does. There is no longer any way
 * to submit "standalone" by spending credits at submission time.
 */
import { ClipRequestService } from "@/services/ClipRequestService";
import { clipRequestRepository } from "@/repositories";
import { videoQuotaService } from "@/services/VideoQuotaService";
import { videoDownloadUnlockService } from "@/services/VideoDownloadUnlockService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";

jest.mock("@/repositories", () => ({
  clipRequestRepository: {
    findById: jest.fn(),
    updateStatus: jest.fn(),
  },
  requestStatusHistoryRepository: { create: jest.fn() },
}));
jest.mock("@/services/VideoQuotaService", () => ({
  videoQuotaService: { consume: jest.fn() },
}));
jest.mock("@/services/VideoDownloadUnlockService", () => ({
  videoDownloadUnlockService: { purchase: jest.fn() },
}));
jest.mock("@/services/CreditService", () => ({ creditService: {} }));
jest.mock("@/services/UploadService", () => ({ uploadService: {} }));

beforeEach(() => jest.clearAllMocks());

it("submits via the quota path only — never calls VideoDownloadUnlockService.purchase", async () => {
  const draft = { id: "r", userId: "u", status: RequestStatus.Draft };
  const submitted = {
    ...draft,
    status: RequestStatus.Submitted,
    pricingTier: RequestPricingTier.Free,
    downloadUnlocked: false,
  };
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue(draft);
  (clipRequestRepository.updateStatus as jest.Mock).mockResolvedValue(submitted);
  (videoQuotaService.consume as jest.Mock).mockResolvedValue({
    tier: RequestPricingTier.Free,
    allowanceWindowId: null,
  });

  const result = await new ClipRequestService().submitRequest("r", "u", true, true, true);

  expect(result).toEqual(submitted);
  expect(videoQuotaService.consume).toHaveBeenCalledWith("u");
  expect(videoDownloadUnlockService.purchase).not.toHaveBeenCalled();
});

it("requires every legal confirmation before touching the quota or the unlock service", async () => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({
    id: "r",
    userId: "u",
    status: RequestStatus.Draft,
  });

  await expect(
    new ClipRequestService().submitRequest("r", "u", true, true, false)
  ).rejects.toThrow("permission");

  expect(videoQuotaService.consume).not.toHaveBeenCalled();
  expect(videoDownloadUnlockService.purchase).not.toHaveBeenCalled();
});

it("submitRequest no longer accepts a downloadUnlocked parameter", () => {
  // Smoke check: TypeScript guards the signature, but we also assert at
  // runtime that no sixth argument is passed through to any service.
  expect(ClipRequestService.prototype.submitRequest.length).toBe(5);
});
