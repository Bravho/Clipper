/**
 * The download route is the lock on a video leaving the app (2026-10-12):
 * a free video needs a package (402), an expired one is gone (410), and a
 * video the package allows comes back with its link.
 */
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { clipRequestRepository, uploadedAssetRepository } from "@/repositories/index";
import { videoAccessService } from "@/services/VideoAccessService";
import { GET } from "@/app/api/requests/[id]/download/route";

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth/authOptions", () => ({ authOptions: {} }));
jest.mock("@/repositories/index", () => ({
  clipRequestRepository: { findById: jest.fn() },
  uploadedAssetRepository: { findById: jest.fn() },
}));
jest.mock("@/lib/spaces", () => ({
  SPACES_BUCKET: "bucket",
  spacesClient: { send: jest.fn() },
  spacesSendWithRetry: jest.fn(),
  spacesSignedUrl: jest.fn(async () => "https://signed.example/video.mp4"),
}));
jest.mock("@/services/VideoAccessService", () => ({
  videoAccessService: { accessFor: jest.fn() },
}));

const sessionMock = getServerSession as jest.Mock;
const findRequestMock = clipRequestRepository.findById as jest.Mock;
const findAssetMock = uploadedAssetRepository.findById as jest.Mock;
const accessForMock = videoAccessService.accessFor as jest.Mock;

const access = (overrides: Record<string, unknown>) => ({
  unlocked: true,
  hasPackage: true,
  expiresAt: new Date("2026-11-11T00:00:00Z"),
  expired: false,
  canDownload: true,
  canSendToManagement: true,
  downloadBlock: null,
  transferBlock: null,
  ...overrides,
});

const call = () =>
  GET(new NextRequest("http://localhost/api/requests/req-1/download?assetId=asset-1"), {
    params: Promise.resolve({ id: "req-1" }),
  });

describe("GET /api/requests/[id]/download", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { id: "user-1", role: "requester" } });
    findRequestMock.mockResolvedValue({ id: "req-1", userId: "user-1", placeName: "Cafe" });
    findAssetMock.mockResolvedValue({
      id: "asset-1",
      requestId: "req-1",
      storageKey: "final_exports/user-1/2026-10-12/req-1/9-16/x.mp4",
      fileName: "x.mp4",
    });
  });

  it("refuses a free video without a package — 402, package_required", async () => {
    accessForMock.mockResolvedValue(
      access({ unlocked: false, canDownload: false, downloadBlock: "package_required" })
    );
    const response = await call();
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      locked: true,
      reason: "package_required",
      expiresAt: "2026-11-11T00:00:00.000Z",
    });
  });

  it("refuses an expired video — 410, expired", async () => {
    accessForMock.mockResolvedValue(
      access({ expired: true, canDownload: false, downloadBlock: "expired" })
    );
    const response = await call();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ reason: "expired" });
  });

  it("hands out the link when the video may leave the app", async () => {
    accessForMock.mockResolvedValue(access({}));
    const response = await call();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://signed.example/video.mp4",
    });
  });

  it("lets an admin through for QA without asking", async () => {
    sessionMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const response = await call();
    expect(response.status).toBe(200);
    expect(accessForMock).not.toHaveBeenCalled();
  });
});
