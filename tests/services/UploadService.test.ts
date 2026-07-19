import { UploadService } from "@/services/UploadService";
import { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";
import { AssetUploadStatus, AssetType } from "@/domain/enums/AssetType";
import {
  MAX_UPLOAD_COUNT,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_CLIP_DURATION_SECONDS,
} from "@/domain/enums/AssetType";
import {
  validateTotalUploadSize,
  validateClipDuration,
} from "@/features/requests/validation/clipRequestSchema";
import { uploadedAssetRepository } from "@/repositories";

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

  it("enforces the configured upload count", () => {
    expect(MAX_UPLOAD_COUNT).toBe(10);
  });

  it("enforces MAX_UPLOAD_SIZE_BYTES = 500 MB", () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(500 * 1024 * 1024);
  });

  it("rejects a file that pushes the request over the total upload cap", () => {
    // existing bytes already at the cap → any further file is rejected
    const result = svc.validateFile(VALID_IMAGE, 1, MAX_UPLOAD_SIZE_BYTES);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Total upload size");
  });

  it("accepts a file that stays within the total upload cap", () => {
    const result = svc.validateFile(VALID_IMAGE, 1, 1 * 1024 * 1024);
    expect(result.valid).toBe(true);
  });

  it("defaults existingBytes to 0 (back-compat two-arg call)", () => {
    const result = svc.validateFile(VALID_IMAGE, 0);
    expect(result.valid).toBe(true);
  });
});

describe("upload validation helpers", () => {
  it("validateTotalUploadSize flags sums over the cap", () => {
    expect(validateTotalUploadSize(MAX_UPLOAD_SIZE_BYTES, 1)).toContain("Total upload size");
    expect(validateTotalUploadSize(0, MAX_UPLOAD_SIZE_BYTES)).toBeNull();
  });

  it("validateClipDuration flags clips over the limit", () => {
    expect(validateClipDuration(MAX_CLIP_DURATION_SECONDS + 1)).toContain(
      String(MAX_CLIP_DURATION_SECONDS)
    );
    expect(validateClipDuration(MAX_CLIP_DURATION_SECONDS)).toBeNull();
  });

  it("validateClipDuration treats unknown (NaN/0) durations as non-blocking", () => {
    expect(validateClipDuration(NaN)).toBeNull();
    expect(validateClipDuration(0)).toBeNull();
  });
});

describe("UploadService.sumUploadedBytes", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sums only non-deleted asset bytes", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      { fileSizeBytes: 1000, uploadStatus: AssetUploadStatus.Uploaded },
      { fileSizeBytes: 2000, uploadStatus: AssetUploadStatus.Pending },
      { fileSizeBytes: 9999, uploadStatus: AssetUploadStatus.Deleted },
    ] as never);

    const total = await svc.sumUploadedBytes("req-x");
    expect(total).toBe(3000);
  });

  it("returns 0 when there are no assets", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([]);
    expect(await svc.sumUploadedBytes("req-empty")).toBe(0);
  });

  it("sums numerically when fileSizeBytes arrives as a string (Postgres BIGINT)", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      { fileSizeBytes: "3040870", uploadStatus: AssetUploadStatus.Uploaded },
      { fileSizeBytes: "5033165", uploadStatus: AssetUploadStatus.Uploaded },
    ] as never);
    // Must be 8,074,035 — not the concatenated "30408705033165".
    expect(await svc.sumUploadedBytes("req-strings")).toBe(8074035);
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
      thumbnailKey: "",
      thumbnailUrl: "",
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
      thumbnailKey: "",
      thumbnailUrl: "",
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
        thumbnailKey: "",
        thumbnailUrl: "",
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
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date("2026-06-01"),
    });

    await repo.deleteByRequestId("req-del");
    const count = await repo.countByRequestId("req-del");
    expect(count).toBe(0);
  });
});
