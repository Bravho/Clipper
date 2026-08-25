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

  // Only CONFIRMED uploads count. A Pending row is an upload *attempt* — every
  // failed multipart retry leaves one behind — so counting them made a handful
  // of retries on large clips falsely trip the 500 MB cap. This test still
  // asserted the old count-everything-not-deleted behaviour and had been failing
  // ever since the implementation was corrected to match its own doc comment.
  it("sums only CONFIRMED (Uploaded) bytes, ignoring Pending and Deleted", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      { fileSizeBytes: 1000, uploadStatus: AssetUploadStatus.Uploaded, assetType: AssetType.Video },
      { fileSizeBytes: 2000, uploadStatus: AssetUploadStatus.Pending, assetType: AssetType.Video },
      { fileSizeBytes: 9999, uploadStatus: AssetUploadStatus.Deleted, assetType: AssetType.Video },
    ] as never);

    const total = await svc.sumUploadedBytes("req-x");
    expect(total).toBe(1000);
  });

  it("returns 0 when there are no assets", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([]);
    expect(await svc.sumUploadedBytes("req-empty")).toBe(0);
  });

  it("sums numerically when fileSizeBytes arrives as a string (Postgres BIGINT)", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      {
        fileSizeBytes: "3040870",
        uploadStatus: AssetUploadStatus.Uploaded,
        assetType: AssetType.Video,
      },
      {
        fileSizeBytes: "5033165",
        uploadStatus: AssetUploadStatus.Uploaded,
        assetType: AssetType.Image,
      },
    ] as never);
    // Must be 8,074,035 — not the concatenated "30408705033165".
    expect(await svc.sumUploadedBytes("req-strings")).toBe(8074035);
  });

  // Both per-request caps are about REQUESTER-SUPPLIED material. Machine output
  // (AI base video, final exports, watermarked previews, voice tracks) lives on
  // the same request and is often hundreds of MB — counting it would blow the
  // 500 MB budget and fill the 10-file slot count on its own, so a request that
  // has been through the pipeline could never accept another source file.
  it("ignores pipeline-generated assets, counting only requester source files", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      { fileSizeBytes: 1000, uploadStatus: AssetUploadStatus.Uploaded, assetType: AssetType.Video },
      { fileSizeBytes: 2000, uploadStatus: AssetUploadStatus.Uploaded, assetType: AssetType.Image },
      {
        fileSizeBytes: 500_000_000,
        uploadStatus: AssetUploadStatus.Uploaded,
        assetType: AssetType.FinalClip,
      },
      {
        fileSizeBytes: 400_000_000,
        uploadStatus: AssetUploadStatus.Uploaded,
        assetType: AssetType.AIGeneratedBaseVideo,
      },
      {
        fileSizeBytes: 300_000_000,
        uploadStatus: AssetUploadStatus.Uploaded,
        assetType: AssetType.WatermarkedPreview,
      },
    ] as never);

    expect(await svc.sumUploadedBytes("req-pipeline")).toBe(3000);
    expect(await svc.countAssets("req-pipeline")).toBe(2);
  });
});

/**
 * The per-request FILE COUNT cap, which produced "Maximum 10 files per request."
 * on a resumed draft.
 */
describe("UploadService.countAssets", () => {
  afterEach(() => jest.restoreAllMocks());

  it("counts only stored source files, not upload attempts", async () => {
    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      { fileSizeBytes: 1, uploadStatus: AssetUploadStatus.Uploaded, assetType: AssetType.Video },
      { fileSizeBytes: 1, uploadStatus: AssetUploadStatus.Uploaded, assetType: AssetType.Image },
      // Attempts and tombstones — never occupy a slot.
      { fileSizeBytes: 1, uploadStatus: AssetUploadStatus.Pending, assetType: AssetType.Video },
      { fileSizeBytes: 1, uploadStatus: AssetUploadStatus.Failed, assetType: AssetType.Video },
      { fileSizeBytes: 1, uploadStatus: AssetUploadStatus.Deleted, assetType: AssetType.Video },
    ] as never);

    expect(await svc.countAssets("req-count")).toBe(2);
  });
});

/**
 * Retrying a file must SUPERSEDE its previous attempt, not stack on top of it.
 *
 * Both upload entry points create a Pending asset row up front, and nothing used
 * to remove it when that attempt died (dropped connection, expired multipart
 * session, app killed mid-upload). The rows accumulated forever and surfaced in
 * the UI as files that look half-uploaded and can never finish.
 */
describe("UploadService — superseded Pending records", () => {
  afterEach(() => jest.restoreAllMocks());

  const pendingAttempt = (id: string) => ({
    id,
    requestId: "req-1",
    fileName: "clip.mp4",
    fileSizeBytes: 12_000_000,
    uploadStatus: AssetUploadStatus.Pending,
    storageKey: `tmp/u/2026-08-24/req-1/${id}-clip.mp4`,
  });

  it("deletes earlier Pending rows for the same file when a retry initiates", async () => {
    const deleteById = jest
      .spyOn(uploadedAssetRepository, "deleteById")
      .mockResolvedValue(undefined);

    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      pendingAttempt("attempt-1"),
      pendingAttempt("attempt-2"),
    ] as never);

    // discardSupersededPending is private; exercise it the way the upload
    // routes do, via the public entry point, and assert the rows it retires.
    await (
      svc as unknown as {
        discardSupersededPending(input: {
          requestId: string;
          fileName: string;
          fileSizeBytes: number;
        }): Promise<void>;
      }
    ).discardSupersededPending({
      requestId: "req-1",
      fileName: "clip.mp4",
      fileSizeBytes: 12_000_000,
    });

    expect(deleteById).toHaveBeenCalledTimes(2);
    expect(deleteById).toHaveBeenCalledWith("attempt-1");
    expect(deleteById).toHaveBeenCalledWith("attempt-2");
  });

  it("never touches a CONFIRMED upload, or a different file", async () => {
    const deleteById = jest
      .spyOn(uploadedAssetRepository, "deleteById")
      .mockResolvedValue(undefined);

    jest.spyOn(uploadedAssetRepository, "findByRequestId").mockResolvedValue([
      // Same file, but already stored — this is a real source file.
      { ...pendingAttempt("stored"), uploadStatus: AssetUploadStatus.Uploaded },
      // Pending, but a different file entirely.
      { ...pendingAttempt("other-name"), fileName: "other.mp4" },
      // Pending, same name but a different size — not the same file.
      { ...pendingAttempt("other-size"), fileSizeBytes: 999 },
    ] as never);

    await (
      svc as unknown as {
        discardSupersededPending(input: {
          requestId: string;
          fileName: string;
          fileSizeBytes: number;
        }): Promise<void>;
      }
    ).discardSupersededPending({
      requestId: "req-1",
      fileName: "clip.mp4",
      fileSizeBytes: 12_000_000,
    });

    expect(deleteById).not.toHaveBeenCalled();
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
