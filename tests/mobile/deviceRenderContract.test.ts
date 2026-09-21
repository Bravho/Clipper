import {
  DEVICE_RENDER_CONTRACT_VERSION,
  DEVICE_RENDER_DIMENSIONS,
  validateDeviceRenderManifest,
} from "@/lib/mobile/deviceRenderContract";

const valid = {
  version: DEVICE_RENDER_CONTRACT_VERSION,
  attemptId: "attempt-1",
  jobId: "job-1",
  requestId: "request-1",
  ratio: "9:16",
  ...DEVICE_RENDER_DIMENSIONS["9:16"],
  fps: 30,
  sources: [{ assetId: "source-1", url: "https://example.com/source.mp4", mimeType: "video/mp4", durationSeconds: 10 }],
  scenes: [{ sourceAssetId: "source-1", startSeconds: 0, durationSeconds: 10 }],
  masterUrl: null,
  voiceUrl: null,
  musicUrl: null,
  captions: [{ startSeconds: 0, endSeconds: 1, text: "สวัสดี", language: "th" }],
  templateId: "none",
  output: { mimeType: "video/mp4", videoCodec: "h264", audioCodec: "aac", maxBytes: 300_000_000 },
};

describe("device render manifest", () => {
  it("accepts a scene plan with matching sources and dimensions", () => {
    expect(validateDeviceRenderManifest(valid).scenes[0].cropX).toBe(0.5);
  });

  it("accepts a device-local source and requires exactly one source location", () => {
    const local = {
      ...valid,
      sources: [{
        assetId: "source-1",
        localId: "request-1--source-1",
        mimeType: "video/mp4",
        durationSeconds: 10,
      }],
    };
    expect(validateDeviceRenderManifest(local).sources[0].localId).toBe("request-1--source-1");
    expect(() => validateDeviceRenderManifest({
      ...local,
      sources: [{ ...local.sources[0], url: "https://example.com/source.mp4" }],
    })).toThrow("exactly one");
  });

  it("rejects a scene that references an unapproved source", () => {
    expect(() => validateDeviceRenderManifest({ ...valid, scenes: [{ sourceAssetId: "other", startSeconds: 0, durationSeconds: 10 }] }))
      .toThrow("absent from the manifest");
  });

  it("rejects inconsistent dimensions and caption times", () => {
    expect(() => validateDeviceRenderManifest({ ...valid, width: 1920 })).toThrow("Invalid dimensions");
    expect(() => validateDeviceRenderManifest({ ...valid, captions: [{ ...valid.captions[0], endSeconds: 0 }] })).toThrow();
  });
});
