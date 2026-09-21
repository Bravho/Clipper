import {
  decodedBase64Bytes,
  localMediaSubmissionSchema,
  totalAnalysisBytes,
} from "@/lib/mobile/localMediaContract";

describe("local media submission contract", () => {
  const material = {
    localId: "req--asset",
    fileName: "clip.mp4",
    mimeType: "video/mp4",
    fileSizeBytes: 42_000_000,
    durationSeconds: 14,
  };

  it("accepts metadata plus a derived frame without any source URL or bytes", () => {
    const parsed = localMediaSubmissionSchema.parse({
      mode: "local-first",
      materials: [material],
      analysisFrames: [{
        localId: material.localId,
        assetIndex: 0,
        mimeType: "image/jpeg",
        dataBase64: "YWJj",
      }],
    });

    expect(parsed.materials[0]).not.toHaveProperty("url");
    expect(parsed.materials[0]).not.toHaveProperty("dataBase64");
  });

  it("rejects frames whose local id is absent from the manifest", () => {
    const parsed = localMediaSubmissionSchema.safeParse({
      mode: "local-first",
      materials: [material],
      analysisFrames: [{
        localId: "missing",
        assetIndex: 0,
        mimeType: "image/jpeg",
        dataBase64: "YWJj",
      }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a frame index that points to a different material", () => {
    const parsed = localMediaSubmissionSchema.safeParse({
      mode: "local-first",
      materials: [material, { ...material, localId: "second" }],
      analysisFrames: [{
        localId: "second",
        assetIndex: 0,
        mimeType: "image/jpeg",
        dataBase64: "YWJj",
      }],
    });
    expect(parsed.success).toBe(false);
  });

  it("counts decoded bytes for request limits", () => {
    expect(decodedBase64Bytes("YWJj")).toBe(3);
    expect(totalAnalysisBytes([{ localId: "x", assetIndex: 0, mimeType: "image/jpeg", dataBase64: "YWJj" }])).toBe(3);
  });
});
