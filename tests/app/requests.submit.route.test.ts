import { getServerSession } from "next-auth";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestService } from "@/services/ClipRequestService";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { uploadedAssetRepository } from "@/repositories/index";
import { POST } from "@/app/api/requests/[id]/submit/route";

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

const sessionMock = getServerSession as jest.Mock;
const getOwnedRequestMock = clipRequestService.getOwnedRequest as jest.Mock;
const submitRequestMock = clipRequestService.submitRequest as jest.Mock;
const getCurrentJobMock = videoGenerationService.getCurrentJob as jest.Mock;
const initializePipelineMock = videoGenerationService.initializePipeline as jest.Mock;
const findAssetsMock = uploadedAssetRepository.findByRequestId as jest.Mock;

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

  const request = () =>
    new Request("http://localhost/api/requests/req-1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creditConfirmed: true,
        rightsConfirmed: true,
        aiProcessingConfirmed: true,
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
  });
});
