import { ClipRequestService } from "@/services/ClipRequestService";
import { clipRequestRepository } from "@/repositories";
import { videoQuotaService } from "@/services/VideoQuotaService";
import { videoDownloadUnlockService } from "@/services/VideoDownloadUnlockService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";

jest.mock("@/repositories", () => ({ clipRequestRepository: { findById: jest.fn() } }));
jest.mock("@/services/VideoQuotaService", () => ({ videoQuotaService: { consume: jest.fn() } }));
jest.mock("@/services/VideoDownloadUnlockService", () => ({ videoDownloadUnlockService: { purchase: jest.fn() } }));
jest.mock("@/services/CreditService", () => ({ creditService: {} }));
jest.mock("@/services/UploadService", () => ({ uploadService: {} }));

beforeEach(() => jest.clearAllMocks());
it("allows a paid standalone request when free quota is exhausted, without consuming quota", async () => {
  const draft = { id: "r", userId: "u", status: RequestStatus.Draft };
  const submitted = { ...draft, status: RequestStatus.Submitted, pricingTier: RequestPricingTier.Paid, downloadUnlocked: true, videosExpireAt: null };
  (clipRequestRepository.findById as jest.Mock).mockResolvedValueOnce(draft).mockResolvedValueOnce(submitted);
  (videoQuotaService.consume as jest.Mock).mockRejectedValue(new Error("No quota left"));
  (videoDownloadUnlockService.purchase as jest.Mock).mockResolvedValue({ charged: true });
  expect(await new ClipRequestService().submitRequest("r", "u", true, true, true, true)).toEqual(submitted);
  expect(videoQuotaService.consume).not.toHaveBeenCalled();
  expect(videoDownloadUnlockService.purchase).toHaveBeenCalledWith({ userId: "u", requestId: "r", currentExpiry: null, alreadyUnlocked: false, submitNew: true });
});

it("requires legal confirmations before charging", async () => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({ id: "r", userId: "u", status: RequestStatus.Draft });
  await expect(new ClipRequestService().submitRequest("r", "u", true, true, false, true)).rejects.toThrow("permission");
  expect(videoDownloadUnlockService.purchase).not.toHaveBeenCalled();
});

it("does not count standalone paid submissions as free usage and starts 30 days at delivery", async () => {
  const repo = new MockClipRequestRepository(new Map());
  const draft = await repo.create({ userId: "u", title: "Standalone" } as never);
  await repo.updateStatus(draft.id, RequestStatus.Submitted, {
    pricingTier: RequestPricingTier.Paid, downloadUnlocked: true, submittedAt: new Date(), videosExpireAt: null,
  });
  expect(await repo.countFreeRequestsByUserId("u")).toBe(0);
  expect((await repo.findById(draft.id))?.videosExpireAt).toBeNull();
  jest.useFakeTimers().setSystemTime(new Date("2026-11-01T00:00:00Z"));
  try {
    const delivered = await repo.updateStatus(draft.id, RequestStatus.Delivered);
    expect(delivered.videosExpireAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  } finally { jest.useRealTimers(); }
});
