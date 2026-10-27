/**
 * The description is optional (Tho, 2026-10-26): a brief with none must be
 * created, submitted and handed to the pipeline as an empty string — the
 * column is NOT NULL, and nothing is guessed in its place.
 */
import { getServerSession } from "next-auth";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { clipRequestService } from "@/services/ClipRequestService";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { uploadedAssetRepository } from "@/repositories/index";
import { POST as createRequest } from "@/app/api/requests/route";
import { POST as submitRequest } from "@/app/api/requests/[id]/submit/route";

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth/authOptions", () => ({ authOptions: {} }));
jest.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
}));
jest.mock("@/services/ClipRequestService", () => ({
  clipRequestService: {
    createDraft: jest.fn(),
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
const createDraftMock = clipRequestService.createDraft as jest.Mock;
const getOwnedRequestMock = clipRequestService.getOwnedRequest as jest.Mock;
const getCurrentJobMock = videoGenerationService.getCurrentJob as jest.Mock;
const initializePipelineMock = videoGenerationService.initializePipeline as jest.Mock;
const findAssetsMock = uploadedAssetRepository.findByRequestId as jest.Mock;

const brief = {
  title: "Summer promotion",
  placeName: "Pho 54",
  latitude: 13.756331,
  longitude: 100.501762,
  targetPlatforms: [Platform.TikTok],
  durationSeconds: 15,
};

function post(body: unknown) {
  return new Request("http://localhost/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("an empty description", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { id: "user-1", role: "requester" } });
    createDraftMock.mockResolvedValue({ id: "req-1" });
  });

  it.each([
    ["the studio, with an empty description", { ...brief, studio: true, description: "" }],
    ["the studio, with only spaces", { ...brief, studio: true, description: "   " }],
    ["the web form, with no description field", { ...brief }],
  ])("creates the request from %s, storing an empty string", async (_label, body) => {
    const response = await createRequest(post(body));
    expect(response.status).toBe(201);
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(createDraftMock.mock.calls[0][1].description).toBe("");
  });

  it("submits it and hands the pipeline an empty description, not a guess", async () => {
    getOwnedRequestMock.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      status: RequestStatus.Submitted,
      creditConfirmed: true,
      rightsConfirmed: true,
      aiProcessingConfirmed: true,
      title: "Summer promotion",
      description: "",
      targetAudience: "",
      targetPlatforms: [Platform.TikTok],
      preferredStyle: "",
    });
    getCurrentJobMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    findAssetsMock.mockResolvedValue([]);
    initializePipelineMock.mockResolvedValue({ id: "job-1" });

    const response = await submitRequest(
      new Request("http://localhost/api/requests/req-1/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true }),
      }),
      { params: Promise.resolve({ id: "req-1" }) }
    );

    expect(response.status).toBe(200);
    expect(initializePipelineMock).toHaveBeenCalledTimes(1);
    expect(initializePipelineMock.mock.calls[0][2].description).toBe("");
  });
});
