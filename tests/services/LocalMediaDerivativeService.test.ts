import sharp from "sharp";
import { uploadedAssetRepository } from "@/repositories/index";
import { spacesClient } from "@/lib/spaces";
import { storeLocalMediaDerivatives } from "@/services/LocalMediaDerivativeService";

jest.mock("sharp", () => jest.fn());
jest.mock("@/repositories/index", () => ({
  uploadedAssetRepository: { findByRequestId: jest.fn(), create: jest.fn() },
}));
jest.mock("@/lib/spaces", () => ({
  spacesClient: { send: jest.fn() },
  SPACES_BUCKET: "test-bucket",
  spacesPublicUrl: (key: string) => `https://example.com/${key}`,
}));
jest.mock("@/lib/spacesKeys", () => ({
  buildRequestMatKey: () => "request_mat/user/request/preview.jpg",
}));

const submission = {
  mode: "local-first" as const,
  materials: [{
    localId: "request--photo",
    fileName: "original.jpg",
    mimeType: "image/jpeg" as const,
    fileSizeBytes: 3_000_000,
    durationSeconds: null,
  }],
  analysisFrames: [{
    localId: "request--photo",
    assetIndex: 0,
    mimeType: "image/jpeg" as const,
    dataBase64: "YWJj",
  }],
};

describe("local media derivative storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const pipeline = {
      rotate: jest.fn(), resize: jest.fn(), jpeg: jest.fn(), toBuffer: jest.fn(),
    };
    pipeline.rotate.mockReturnValue(pipeline);
    pipeline.resize.mockReturnValue(pipeline);
    pipeline.jpeg.mockReturnValue(pipeline);
    pipeline.toBuffer.mockResolvedValue(Buffer.from("small-jpeg"));
    (sharp as unknown as jest.Mock).mockReturnValue(pipeline);
    (uploadedAssetRepository.findByRequestId as jest.Mock).mockResolvedValue([]);
    (uploadedAssetRepository.create as jest.Mock).mockImplementation(async (input) => input);
    (spacesClient.send as jest.Mock).mockResolvedValue({});
  });

  it("stores only the resized derivative and records its size", async () => {
    const urls = await storeLocalMediaDerivatives("request", "user", submission);

    expect(urls).toEqual(["https://example.com/request_mat/user/request/preview.jpg"]);
    expect(sharp).toHaveBeenCalledWith(Buffer.from("abc"), { limitInputPixels: 20_000_000 });
    expect(uploadedAssetRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      fileSizeBytes: Buffer.byteLength("small-jpeg"),
      fileName: "local-preview-0-request--photo.jpg",
      mimeType: "image/jpeg",
    }));
  });

  it("reuses an existing proxy after a lost submit response", async () => {
    (uploadedAssetRepository.findByRequestId as jest.Mock).mockResolvedValue([{
      fileName: "local-preview-0-request--photo.jpg",
      assetType: "image",
      uploadStatus: "uploaded",
      storageUrl: "https://example.com/existing.jpg",
    }]);

    const urls = await storeLocalMediaDerivatives("request", "user", submission);

    expect(urls).toEqual(["https://example.com/existing.jpg"]);
    expect(sharp).not.toHaveBeenCalled();
    expect(spacesClient.send).not.toHaveBeenCalled();
  });
});
