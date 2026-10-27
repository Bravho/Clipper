import { NextRequest } from "next/server";
import { POST } from "@/app/api/requests/[id]/download-unlock/route";
import { clipRequestRepository } from "@/repositories/index";
import { VideoDownloadUnlockService } from "@/services/VideoDownloadUnlockService";

jest.mock("@/lib/auth/helpers", () => ({ requireRole: async () => ({ id: "u" }) }));
jest.mock("@/repositories/index", () => ({ clipRequestRepository: { findById: jest.fn() } }));

const call = () => POST(new NextRequest("http://localhost/api/requests/r/download-unlock", { method: "POST" }), { params: Promise.resolve({ id: "r" }) });
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it.each(["auto_cancelled", "rejected"])("refuses %s videos with no expiry timestamp", async (status) => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({ id: "r", userId: "u", status, downloadUnlocked: false });
  const purchase = jest.spyOn(VideoDownloadUnlockService.prototype, "purchase");
  const response = await call();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: "request_expired" });
  expect(purchase).not.toHaveBeenCalled();
});

it("refuses other users without opening the wallet", async () => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({ userId: "other" });
  const purchase = jest.spyOn(VideoDownloadUnlockService.prototype, "purchase");
  expect((await call()).status).toBe(404);
  expect(purchase).not.toHaveBeenCalled();
});

it("offers the purchase only for free requests", async () => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({ userId: "u", status: "delivered", pricingTier: "paid", downloadUnlocked: false });
  expect((await call()).status).toBe(409);
});

it("returns a package unlock idempotently with the actual wallet balance", async () => {
  (clipRequestRepository.findById as jest.Mock).mockResolvedValue({ userId: "u", status: "delivered", pricingTier: "paid", downloadUnlocked: true });
  jest.spyOn(VideoDownloadUnlockService.prototype, "purchase").mockResolvedValue({ charged: false, creditsSpent: 0, balanceCredits: 123, unlockedUntil: null });
  const response = await call();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ charged: false, balanceCredits: 123 });
});
