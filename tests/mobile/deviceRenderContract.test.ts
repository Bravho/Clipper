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
  stage: "montage",
  ratio: "9:16",
  ...DEVICE_RENDER_DIMENSIONS["9:16"],
  fps: 30,
  sources: [{ assetId: "source-1", kind: "clip", url: "https://example.com/source.mp4", mimeType: "video/mp4", durationSeconds: 10 }],
  scenes: [{ assets: [{ sourceAssetId: "source-1", motion: "static", durationSeconds: 10, trimStartSeconds: 0, trimEndSeconds: 10 }] }],
  masterUrl: null,
  voiceUrl: null,
  musicUrl: null,
  audio: { sourceClipAudio: false, musicSelected: false, voiceLeadInSeconds: 0.6, musicBedVolume: 0.3, musicDuckRatio: 2.5 },
  captions: [{ startSeconds: 0, endSeconds: 1, text: "สวัสดี", language: "th" }],
  templateId: "none",
  output: { mimeType: "video/mp4", videoCodec: "h264", audioCodec: null, maxBytes: 300_000_000 },
};

describe("device render manifest", () => {
  it("accepts a scene plan with matching sources and dimensions", () => {
    expect(validateDeviceRenderManifest(valid).scenes[0].assets[0].focusX).toBe(0.5);
  });

  it("accepts a device-local source and requires exactly one source location", () => {
    const local = {
      ...valid,
      sources: [{
        assetId: "source-1",
        kind: "clip",
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
    expect(() => validateDeviceRenderManifest({ ...valid, scenes: [{ assets: [{ sourceAssetId: "other", motion: "static", durationSeconds: 10 }] }] }))
      .toThrow("absent from the manifest");
  });

  it("preserves still motion and rejects original clip sound", () => {
    const image = {
      ...valid,
      sources: [{ assetId: "photo", kind: "image", localId: "photo-local", mimeType: "image/jpeg", durationSeconds: null }],
      scenes: [{ assets: [{ sourceAssetId: "photo", motion: "pan_left", durationSeconds: 4 }] }],
    };
    expect(validateDeviceRenderManifest(image).scenes[0].assets[0].motion).toBe("pan_left");
    expect(() => validateDeviceRenderManifest({ ...valid, audio: { ...valid.audio, sourceClipAudio: true } })).toThrow();
    expect(() => validateDeviceRenderManifest({ ...valid, scenes: [{ assets: [{ sourceAssetId: "source-1", motion: "ken_burns_in", durationSeconds: 4 }] }] }))
      .toThrow("without still-image motion");
  });

  it("requires approved voice and selected music on a final AAC export", () => {
    const final = {
      ...valid,
      stage: "final",
      masterUrl: "https://example.com/approved-montage.mp4",
      voiceUrl: "https://example.com/approved-voice.mp3",
      musicUrl: "https://example.com/selected-music.mp3",
      audio: { ...valid.audio, musicSelected: true },
      output: { ...valid.output, audioCodec: "aac" },
    };
    expect(validateDeviceRenderManifest(final).stage).toBe("final");
    expect(() => validateDeviceRenderManifest({ ...final, voiceUrl: null }))
      .toThrow("approved voice");
    expect(() => validateDeviceRenderManifest({ ...final, musicUrl: null }))
      .toThrow("Selected background music");
    expect(() => validateDeviceRenderManifest({ ...final, output: { ...final.output, audioCodec: null } }))
      .toThrow();
  });

  it("rejects inconsistent dimensions and caption times", () => {
    expect(() => validateDeviceRenderManifest({ ...valid, width: 1920 })).toThrow("Invalid dimensions");
    expect(() => validateDeviceRenderManifest({ ...valid, captions: [{ ...valid.captions[0], endSeconds: 0 }] })).toThrow();
  });
});
