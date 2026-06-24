import { orderSourceAssets } from "@/lib/sourceAssets";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";

function mk(overrides: Partial<UploadedAsset>): UploadedAsset {
  return {
    id: "a",
    requestId: "req-1",
    userId: "user-1",
    fileName: "f.jpg",
    assetType: AssetType.Image,
    fileSizeBytes: 1000,
    mimeType: "image/jpeg",
    storageKey: "k",
    storageUrl: "https://cdn/f.jpg",
    thumbnailKey: "",
    thumbnailUrl: "",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: new Date("2030-01-01"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as UploadedAsset;
}

describe("orderSourceAssets", () => {
  it("orders by createdAt and assigns canonical indexes", () => {
    const ordered = orderSourceAssets([
      mk({ id: "c", createdAt: new Date("2026-01-03T00:00:00Z") }),
      mk({ id: "a", createdAt: new Date("2026-01-01T00:00:00Z") }),
      mk({ id: "b", createdAt: new Date("2026-01-02T00:00:00Z") }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(ordered.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it("breaks createdAt ties by id for stability", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const ordered = orderSourceAssets([
      mk({ id: "z", createdAt: same }),
      mk({ id: "a", createdAt: same }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(["a", "z"]);
  });

  it("filters out non-image/video and non-uploaded assets", () => {
    const ordered = orderSourceAssets([
      mk({ id: "img", assetType: AssetType.Image }),
      mk({ id: "final", assetType: AssetType.FinalClip }),
      mk({ id: "pending", uploadStatus: AssetUploadStatus.Pending }),
      mk({ id: "nourl", storageUrl: "" }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(["img"]);
  });

  it("maps video → clip and image → image, and falls back thumbnail to storageUrl", () => {
    const ordered = orderSourceAssets([
      mk({ id: "v", assetType: AssetType.Video, storageUrl: "https://cdn/v.mp4", thumbnailUrl: "" }),
      mk({ id: "i", assetType: AssetType.Image, storageUrl: "https://cdn/i.jpg", thumbnailUrl: "https://cdn/t.jpg" }),
    ]);
    const v = ordered.find((a) => a.id === "v")!;
    const i = ordered.find((a) => a.id === "i")!;
    expect(v.kind).toBe("clip");
    expect(v.thumbnailUrl).toBe("https://cdn/v.mp4");
    expect(i.kind).toBe("image");
    expect(i.thumbnailUrl).toBe("https://cdn/t.jpg");
  });
});
