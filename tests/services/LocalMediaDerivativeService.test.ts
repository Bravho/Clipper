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

  /**
   * A clip's poster used to be refused outright, because at the time nothing
   * could render a clip the server did not have. Now the phone can, so the
   * poster is kept — but ONLY as a poster, and the asset it belongs to is
   * marked as renderable on that device alone.
   *
   * The distinction is the whole point: a poster that could be mistaken for the
   * clip would be animated in place of the real footage, and the result looks
   * almost right, which is the failure nobody catches until a customer does.
   */
  const videoSubmission = {
    ...submission,
    materials: [{
      localId: "request--video",
      fileName: "original.mp4",
      mimeType: "video/mp4" as const,
      fileSizeBytes: 3_000_000,
      durationSeconds: 12,
    }],
    analysisFrames: [{ ...submission.analysisFrames[0], localId: "request--video" }],
  };

  it("keeps a clip's poster but marks the asset as device-held", async () => {
    await storeLocalMediaDerivatives("request", "user", videoSubmission);

    expect(uploadedAssetRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // The handle that says "the real frames are on the phone". Without it
        // the render queue would offer this work to the Mac Mini, which has no
        // copy of the footage.
        deviceLocalId: "request--video",
        assetType: "video",
        mimeType: "video/mp4",
        // Carried from the device's own probe, so the scene planner can size a
        // shot against the clip's true length.
        durationSeconds: 12,
      })
    );
  });

  it("gives a device-held clip a thumbnail, so every screen has something to show", async () => {
    await storeLocalMediaDerivatives("request", "user", videoSubmission);

    const created = (uploadedAssetRepository.create as jest.Mock).mock.calls[0][0];
    expect(created.thumbnailUrl).toBeTruthy();
    expect(created.thumbnailKey).toBe(created.storageKey);
  });

  it("never uploads the clip itself — only the frame it was asked for", async () => {
    await storeLocalMediaDerivatives("request", "user", videoSubmission);

    // One PutObject, and its body is the re-encoded JPEG the server made from
    // the analysis frame. The 3 MB original is not in this function's reach at
    // all: the submission carries metadata and a still, never the media.
    const puts = (spacesClient.send as jest.Mock).mock.calls.filter(
      ([command]) => command?.constructor?.name === "PutObjectCommand"
    );
    expect(puts).toHaveLength(1);

    const created = (uploadedAssetRepository.create as jest.Mock).mock.calls[0][0];
    expect(created.fileSizeBytes).toBeLessThan(100_000);
  });

  it("still stores a photo as an ordinary uploaded image", async () => {
    // The server holds a faithful derivative of a photo and can render from it,
    // so a photo-only request keeps working on the Mac Mini exactly as before.
    await storeLocalMediaDerivatives("request", "user", submission);

    expect(uploadedAssetRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "image",
        mimeType: "image/jpeg",
        deviceLocalId: null,
      })
    );
  });
});
