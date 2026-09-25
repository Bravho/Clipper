import { getServerSession } from "next-auth";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestService } from "@/services/ClipRequestService";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { uploadedAssetRepository } from "@/repositories/index";
import { POST } from "@/app/api/requests/[id]/submit/route";
import { storeLocalMediaDerivatives } from "@/services/LocalMediaDerivativeService";

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth/authOptions", () => ({ authOptions: {} }));
jest.mock("@/services/ClipRequestService", () => ({
  clipRequestService: {
    getOwnedRequest: jest.fn(),
    submitRequest: jest.fn(),
  },
}));
jest.mock("@/services/VideoGenerationService", () => ({
  videoGenerationService: {
    getCurrentJob: jest.fn(),
    initializePipeline: jest.fn(),
  },
}));
jest.mock("@/repositories/index", () => ({
  uploadedAssetRepository: { findByRequestId: jest.fn() },
}));
jest.mock("@/config/localMedia", () => ({ LOCAL_FIRST_MEDIA_ENABLED: true }));
jest.mock("@/services/LocalMediaDerivativeService", () => ({
  storeLocalMediaDerivatives: jest.fn(),
}));

const sessionMock = getServerSession as jest.Mock;
const getOwnedRequestMock = clipRequestService.getOwnedRequest as jest.Mock;
const submitRequestMock = clipRequestService.submitRequest as jest.Mock;
const getCurrentJobMock = videoGenerationService.getCurrentJob as jest.Mock;
const initializePipelineMock = videoGenerationService.initializePipeline as jest.Mock;
const findAssetsMock = uploadedAssetRepository.findByRequestId as jest.Mock;
const storeDerivativesMock = storeLocalMediaDerivatives as jest.Mock;

const submittedRequest = {
  id: "req-1",
  userId: "user-1",
  status: RequestStatus.Submitted,
  creditConfirmed: true,
  rightsConfirmed: true,
  aiProcessingConfirmed: true,
  title: "Trip",
  description: "Description",
  targetAudience: "Travellers",
  targetPlatforms: [],
  preferredStyle: "",
};

describe("POST /api/requests/[id]/submit — idempotent recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionMock.mockResolvedValue({
      user: { id: "user-1", role: "requester" },
    });
  });

  const request = (extra: Record<string, unknown> = {}) =>
    new Request("http://localhost/api/requests/req-1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creditConfirmed: true,
        rightsConfirmed: true,
        aiProcessingConfirmed: true,
        ...extra,
      }),
    });

  it("returns the existing job when the first response was lost after submission", async () => {
    getOwnedRequestMock.mockResolvedValue(submittedRequest);
    getCurrentJobMock.mockResolvedValue({ id: "job-1" });

    const response = await POST(request(), { params: Promise.resolve({ id: "req-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ jobId: "job-1", resumed: true });
    expect(submitRequestMock).not.toHaveBeenCalled();
    expect(initializePipelineMock).not.toHaveBeenCalled();
  });

  it("creates only the missing pipeline job for a committed Submitted request", async () => {
    getOwnedRequestMock.mockResolvedValue(submittedRequest);
    getCurrentJobMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    findAssetsMock.mockResolvedValue([]);
    initializePipelineMock.mockResolvedValue({ id: "job-new" });

    const response = await POST(request(), { params: Promise.resolve({ id: "req-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ jobId: "job-new" });
    expect(submitRequestMock).not.toHaveBeenCalled();
    expect(initializePipelineMock).toHaveBeenCalledTimes(1);
    expect(storeDerivativesMock).not.toHaveBeenCalled();
  });

  it("passes only descriptors and transient frames for a local-first photo request", async () => {
    getOwnedRequestMock.mockResolvedValue(submittedRequest);
    getCurrentJobMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    findAssetsMock.mockResolvedValue([]);
    storeDerivativesMock.mockResolvedValue(["https://example.com/local-preview.jpg"]);
    initializePipelineMock.mockResolvedValue({ id: "job-local" });

    const localMedia = {
      mode: "local-first",
      materials: [{
        localId: "req-1--media-1",
        fileName: "source.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 25_000,
        durationSeconds: null,
      }],
      analysisFrames: [{
        localId: "req-1--media-1",
        assetIndex: 0,
        mimeType: "image/jpeg",
        dataBase64: "YWJj",
      }],
    };

    const response = await POST(request({ localMedia }), {
      params: Promise.resolve({ id: "req-1" }),
    });

    expect(response.status).toBe(200);
    expect(initializePipelineMock).toHaveBeenCalledWith(
      "req-1",
      "user-1",
      expect.objectContaining({
        imageUrls: ["https://example.com/local-preview.jpg"],
        localMedia: localMedia.materials,
        inlineFrames: localMedia.analysisFrames,
      })
    );
    expect(storeDerivativesMock).toHaveBeenCalledWith("req-1", "user-1", localMedia);
  });

  it("does not charge or submit a phone-local video through the still proxy", async () => {
    const response = await POST(request({
      localMedia: {
        mode: "local-first",
        materials: [{
          localId: "req-1--clip",
          fileName: "source.mp4",
          mimeType: "video/mp4",
          fileSizeBytes: 25_000_000,
          durationSeconds: 12,
        }],
        analysisFrames: [{
          localId: "req-1--clip",
          assetIndex: 0,
          mimeType: "image/jpeg",
          dataBase64: "YWJj",
        }],
      },
    }), { params: Promise.resolve({ id: "req-1" }) });

    expect(response.status).toBe(409);
    expect(submitRequestMock).not.toHaveBeenCalled();
    expect(storeDerivativesMock).not.toHaveBeenCalled();
    expect(initializePipelineMock).not.toHaveBeenCalled();
  });

  it("rejects an analysis frame that is not tied to a local material", async () => {
    const response = await POST(request({
      localMedia: {
        mode: "local-first",
        materials: [{
          localId: "material-1",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 100,
          durationSeconds: null,
        }],
        analysisFrames: [{
          localId: "some-other-material",
          assetIndex: 0,
          mimeType: "image/jpeg",
          dataBase64: "YWJj",
        }],
      },
    }), { params: Promise.resolve({ id: "req-1" }) });

    expect(response.status).toBe(422);
    expect(getOwnedRequestMock).not.toHaveBeenCalled();
  });

  it("does not submit a draft when derivative storage fails", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    getOwnedRequestMock.mockResolvedValue({ ...submittedRequest, status: RequestStatus.Draft });
    storeDerivativesMock.mockRejectedValue(new Error("Spaces unavailable"));
    const response = await POST(request({
      localMedia: {
        mode: "local-first",
        materials: [{
          localId: "req-1--photo",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 100,
          durationSeconds: null,
        }],
        analysisFrames: [{
          localId: "req-1--photo",
          assetIndex: 0,
          mimeType: "image/jpeg",
          dataBase64: "YWJj",
        }],
      },
    }), { params: Promise.resolve({ id: "req-1" }) });

    expect(response.status).toBe(500);
    expect(submitRequestMock).not.toHaveBeenCalled();
    expect(initializePipelineMock).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
  describe("an exhausted free allowance", () => {
    const quotaError = () =>
      Object.assign(new Error("Monthly limit reached: 3 free videos per 30 days."), {
        name: "QuotaExhaustedError",
        nextFreeSlotAt: new Date("2026-10-14T00:00:00.000Z"),
      });
    const studioBody = (renderOnDevice?: boolean) => ({
      localMedia: {
        mode: "local-first",
        materials: [{
          localId: "req-1--photo",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 100,
          durationSeconds: null,
        }],
        analysisFrames: [{
          localId: "req-1--photo",
          assetIndex: 0,
          mimeType: "image/jpeg",
          dataBase64: "YWJj",
        }],
        ...(renderOnDevice === undefined ? {} : { renderOnDevice }),
      },
    });

    beforeEach(() => {
      getOwnedRequestMock.mockResolvedValue({ ...submittedRequest, status: RequestStatus.Draft });
      findAssetsMock.mockResolvedValue([]);
      storeDerivativesMock.mockResolvedValue(["https://cdn/p.jpg"]);
      submitRequestMock.mockRejectedValue(quotaError());
    });

    it("tells the phone studio it is the quota, with the next free date", async () => {
      const response = await POST(request(studioBody(true)), {
        params: Promise.resolve({ id: "req-1" }),
      });
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        code: "quota_exhausted",
        nextFreeSlotAt: "2026-10-14T00:00:00.000Z",
      });
      expect(initializePipelineMock).not.toHaveBeenCalled();
    });

    it("leaves every other submission's answer as it was", async () => {
      const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const response = await POST(request(studioBody()), {
        params: Promise.resolve({ id: "req-1" }),
      });
      expect(response.status).toBe(500);
      errorLog.mockRestore();
    });
  });
});
