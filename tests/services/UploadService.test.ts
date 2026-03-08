import { UploadService } from "@/services/UploadService";
import { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";
import { AssetUploadStatus } from "@/domain/enums/AssetType";
import { MAX_UPLOAD_COUNT, MAX_UPLOAD_SIZE_BYTES } from "@/domain/enums/AssetType";

// UploadService uses uploadedAssetRepository singleton from @/repositories.
// We test the validation logic directly since it doesn't depend on the repo.

const svc = new UploadService();

const VALID_VIDEO = {
  name: "test-video.mp4",
  size: 10 * 1024 * 1024, // 10 MB
  type: "video/mp4",
};

const VALID_IMAGE = {
  name: "test-image.jpg",
  size: 500 * 1024, // 500 KB
  type: "image/jpeg",
};

describe("UploadService.validateFile", () => {
  it("accepts a valid video file", () => {
    const result = svc.validateFile(VALID_VIDEO, 0);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid image file", () => {
    const result = svc.validateFile(VALID_IMAGE, 0);
    expect(result.valid).toBe(true);
  });

  it("rejects when current count is at MAX_UPLOAD_COUNT", () => {
    const result = svc.validateFile(VALID_VIDEO, MAX_UPLOAD_COUNT);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(String(MAX_UPLOAD_COUNT));
  });

  it("accepts when current count is one below MAX_UPLOAD_COUNT", () => {
    const result = svc.validateFile(VALID_VIDEO, MAX_UPLOAD_COUNT - 1);
    expect(result.valid).toBe(true);
  });

  it("rejects a file exceeding the size limit", () => {
    const oversized = {
      ...VALID_VIDEO,
      size: MAX_UPLOAD_SIZE_BYTES + 1,
    };
    const result = svc.validateFile(oversized, 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("MB");
  });

  it("rejects an unsupported file type", () => {
    const unsupported = {
      name: "document.pdf",
      size: 1024,
      type: "application/pdf",
    };
    const result = svc.validateFile(unsupported, 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("supported");
  });

  it("rejects a .exe file", () => {
    const exe = {
      name: "malware.exe",
      size: 1024,
      type: "application/x-msdownload",
    };
    const result = svc.validateFile(exe, 0);
    expect(result.valid).toBe(false);
  });

  it("enforces MAX_UPLOAD_COUNT = 5", () => {
    expect(MAX_UPLOAD_COUNT).toBe(5);
  });

  it("enforces MAX_UPLOAD_SIZE_BYTES = 500 MB", () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe("MockUploadedAssetRepository", () => {
  function makeAssetRepo() {
    return new MockUploadedAssetRepository(new Map());
  }

  it("creates an asset record", async () => {
    const repo = makeAssetRepo();
    const asset = await repo.create({
      requestId: "req-001",
      userId: "user-001",
      fileName: "test.mp4",
      assetType: "video" as any,
      fileSizeBytes: 10_000_000,
      mimeType: "video/mp4",
      storageKey: "mock/test.mp4",
      storageUrl: "/mock-assets/test.mp4",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date("2026-06-01"),
    });

    expect(asset.id).toBeTruthy();
    expect(asset.uploadStatus).toBe(AssetUploadStatus.Uploaded);
  });

  it("findByRequestId returns only assets for the request", async () => {
    const repo = makeAssetRepo();

    const makeInput = (requestId: string) => ({
      requestId,
      userId: "user-001",
      fileName: "test.mp4",
      assetType: "video" as any,
      fileSizeBytes: 1_000_000,
      mimeType: "video/mp4",
      storageKey: "mock/test.mp4",
      storageUrl: "/mock-assets/test.mp4",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date("2026-06-01"),
    });

    await repo.create(makeInput("req-A"));
    await repo.create(makeInput("req-A"));
    await repo.create(makeInput("req-B"));

    const forA = await repo.findByRequestId("req-A");
    expect(forA).toHaveLength(2);
  });

  it("countByRequestId returns the correct count", async () => {
    const repo = makeAssetRepo();

    for (let i = 0; i < 3; i++) {
      await repo.create({
        requestId: "req-001",
        userId: "user-001",
        fileName: `file-${i}.mp4`,
        assetType: "video" as any,
        fileSizeBytes: 1_000_000,
        mimeType: "video/mp4",
        storageKey: `mock/file-${i}.mp4`,
        storageUrl: `/mock-assets/file-${i}.mp4`,
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt: new Date("2026-06-01"),
      });
    }

    const count = await repo.countByRequestId("req-001");
    expect(count).toBe(3);
  });

  it("deleteByRequestId removes all assets for the request", async () => {
    const repo = makeAssetRepo();
    await repo.create({
      requestId: "req-del",
      userId: "user-001",
      fileName: "file.mp4",
      assetType: "video" as any,
      fileSizeBytes: 1_000_000,
      mimeType: "video/mp4",
      storageKey: "mock/file.mp4",
      storageUrl: "/mock-assets/file.mp4",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date("2026-06-01"),
    });

    await repo.deleteByRequestId("req-del");
    const count = await repo.countByRequestId("req-del");
    expect(count).toBe(0);
  });
});
