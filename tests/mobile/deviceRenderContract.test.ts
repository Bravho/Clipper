import {
  DEVICE_RENDER_CONTRACT_VERSION,
  DEVICE_RENDER_DIMENSIONS,
  isAcceptedManifestVersion,
  manifestPictureSeconds,
  validateDeviceRenderManifest,
} from "@/lib/mobile/deviceRenderContract";
import { deviceAudioMixSpec } from "@/lib/mobile/deviceRenderAudio";

/**
 * The render contract is the only thing standing between "the phone rendered
 * something" and "the phone rendered what was approved". These tests are
 * therefore about REFUSALS as much as acceptances: every rule here exists
 * because breaking it produces a video that looks plausible and is wrong.
 */

const mixWithoutMusic = deviceAudioMixSpec(false);
const mixWithMusic = deviceAudioMixSpec(true);

function audio(spec: ReturnType<typeof deviceAudioMixSpec>, musicSelected: boolean) {
  return {
    sourceClipAudio: false,
    musicSelected,
    sampleRate: spec.sampleRate,
    voiceLeadInSeconds: spec.leadInSeconds,
    musicBedVolume: spec.musicBedVolume,
    musicDuckRatio: spec.duckRatio,
    musicDuckThreshold: spec.duckThreshold,
    musicDuckAttackMs: spec.duckAttackMs,
    musicDuckReleaseMs: spec.duckReleaseMs,
    voiceTargetLufs: spec.voiceTargetLufs,
    voiceTruePeakDb: spec.voiceTruePeakDb,
    voiceMaxGainDb: spec.voiceMaxGainDb,
    mixLimit: spec.limit,
    voiceDurationSeconds: 12,
  };
}

const template = {
  id: "none",
  frame: "full_bleed",
  canvas: "none",
  decor: [],
  palette: {
    primary: "#FF6B35",
    secondary: "#FFB703",
    accent: "#06D6A0",
    neutral: "#FFFFFF",
  },
};

const montage = {
  version: DEVICE_RENDER_CONTRACT_VERSION,
  attemptId: "attempt-1",
  taskId: "task-1",
  jobId: "job-1",
  requestId: "request-1",
  step: "overlay_composition",
  stage: "montage",
  travy: false,
  ratio: "9:16",
  ...DEVICE_RENDER_DIMENSIONS["9:16"],
  fps: 30,
  sceneTransitionSeconds: 0.2,
  sources: [
    {
      assetId: "source-1",
      kind: "clip",
      url: "https://example.com/source.mp4",
      mimeType: "video/mp4",
      durationSeconds: 10,
    },
  ],
  scenes: [
    {
      sceneNumber: 0,
      transitionIn: "fade",
      shotTransitionSeconds: 0.2,
      assets: [
        {
          sourceAssetId: "source-1",
          motion: "static",
          durationSeconds: 10,
          trimStartSeconds: 0,
          trimEndSeconds: 10,
        },
      ],
    },
  ],
  masterUrl: null,
  voiceUrl: null,
  musicUrl: null,
  audio: audio(mixWithoutMusic, false),
  captions: [],
  captionLanguages: [],
  template,
  output: {
    mimeType: "video/mp4",
    videoCodec: "h264",
    audioCodec: null,
    maxBytes: 300_000_000,
  },
  upload: null,
  leaseExpiresAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

const master = {
  ...montage,
  stage: "master",
  masterUrl: "https://example.com/approved-montage.mp4",
  voiceUrl: "https://example.com/approved-voice.mp3",
  musicUrl: "https://example.com/selected-music.mp3",
  scenes: [],
  sources: [],
  audio: audio(mixWithMusic, true),
  output: { ...montage.output, audioCodec: "aac" },
};

const finalExport = {
  ...montage,
  stage: "final",
  masterUrl: "https://example.com/merged-master.mp4",
  voiceUrl: null,
  musicUrl: null,
  scenes: [],
  sources: [],
  captions: [
    {
      startSeconds: 0.6,
      endSeconds: 3.2,
      textThai: "สวัสดี",
      textEnglish: "Hello",
      textChinese: "你好",
    },
  ],
  captionLanguages: ["th", "en", "zh"],
  output: { ...montage.output, audioCodec: "aac", coverRequired: true, coverAtSeconds: 1 },
};

describe("device render manifest", () => {
  it("fills in the defaults a renderer relies on", () => {
    const parsed = validateDeviceRenderManifest(montage);
    expect(parsed.scenes[0].assets[0].focusX).toBe(0.5);
    expect(parsed.scenes[0].assets[0].playbackRate).toBe(1);
    expect(parsed.travy).toBe(false);
  });

  it("accepts a device-private source and requires exactly one location for it", () => {
    const local = {
      ...montage,
      sources: [
        {
          assetId: "source-1",
          kind: "clip",
          localId: "request-1--source-1",
          mimeType: "video/mp4",
          durationSeconds: 10,
        },
      ],
    };
    expect(validateDeviceRenderManifest(local).sources[0].localId).toBe("request-1--source-1");
    expect(() =>
      validateDeviceRenderManifest({
        ...local,
        sources: [{ ...local.sources[0], url: "https://example.com/source.mp4" }],
      })
    ).toThrow("exactly one");
  });

  it("rejects a scene that references material outside the manifest", () => {
    expect(() =>
      validateDeviceRenderManifest({
        ...montage,
        scenes: [
          {
            ...montage.scenes[0],
            assets: [{ sourceAssetId: "other", motion: "static", durationSeconds: 10 }],
          },
        ],
      })
    ).toThrow("absent from the manifest");
  });

  it("keeps still motion and refuses it on a clip", () => {
    const image = {
      ...montage,
      sources: [
        {
          assetId: "photo",
          kind: "image",
          localId: "photo-local",
          mimeType: "image/jpeg",
          durationSeconds: null,
        },
      ],
      scenes: [
        {
          ...montage.scenes[0],
          assets: [{ sourceAssetId: "photo", motion: "pan_left", durationSeconds: 4 }],
        },
      ],
    };
    expect(validateDeviceRenderManifest(image).scenes[0].assets[0].motion).toBe("pan_left");

    expect(() =>
      validateDeviceRenderManifest({
        ...montage,
        scenes: [
          {
            ...montage.scenes[0],
            assets: [{ sourceAssetId: "source-1", motion: "ken_burns_in", durationSeconds: 4 }],
          },
        ],
      })
    ).toThrow("without still-image motion");
  });

  it("never lets material clip audio through", () => {
    expect(() =>
      validateDeviceRenderManifest({
        ...montage,
        audio: { ...montage.audio, sourceClipAudio: true },
      })
    ).toThrow();
  });

  it("rejects a trim that runs past the end of its clip", () => {
    expect(() =>
      validateDeviceRenderManifest({
        ...montage,
        scenes: [
          {
            ...montage.scenes[0],
            assets: [
              {
                sourceAssetId: "source-1",
                motion: "static",
                durationSeconds: 10,
                trimStartSeconds: 0,
                trimEndSeconds: 40,
              },
            ],
          },
        ],
      })
    ).toThrow("exceeds source duration");
  });

  describe("montage stage", () => {
    it("must stay silent and uncaptioned", () => {
      expect(validateDeviceRenderManifest(montage).output.audioCodec).toBeNull();
      expect(() =>
        validateDeviceRenderManifest({
          ...montage,
          output: { ...montage.output, audioCodec: "aac" },
        })
      ).toThrow("silent intermediate");
      expect(() =>
        validateDeviceRenderManifest({ ...montage, captionLanguages: ["en"] })
      ).toThrow("burned in at the final stage");
    });

    it("must carry the material it builds from", () => {
      expect(() => validateDeviceRenderManifest({ ...montage, scenes: [] })).toThrow(
        "must contain scenes"
      );
    });
  });

  describe("master stage", () => {
    it("requires the approved voice and the selected music", () => {
      expect(validateDeviceRenderManifest(master).stage).toBe("master");
      expect(() => validateDeviceRenderManifest({ ...master, voiceUrl: null })).toThrow(
        "approved voice"
      );
      expect(() => validateDeviceRenderManifest({ ...master, musicUrl: null })).toThrow(
        "Selected background music"
      );
    });

    it("ties the lead-in to whether music was actually selected", () => {
      // Without music the FFmpeg path drops the lead-in entirely; a manifest
      // that keeps it would shift every caption by 0.6 s against a master that
      // never had a music-only intro.
      expect(() =>
        validateDeviceRenderManifest({
          ...master,
          musicUrl: null,
          audio: { ...audio(mixWithoutMusic, false), voiceLeadInSeconds: 0.6 },
        })
      ).toThrow("no music-only lead-in");

      expect(() =>
        validateDeviceRenderManifest({
          ...master,
          audio: { ...audio(mixWithMusic, true), voiceLeadInSeconds: 0 },
        })
      ).toThrow("must match the server mix");
    });
  });

  describe("final stage", () => {
    it("renders from the merged master and must not re-mix its audio", () => {
      expect(validateDeviceRenderManifest(finalExport).captions).toHaveLength(1);
      expect(() => validateDeviceRenderManifest({ ...finalExport, masterUrl: null })).toThrow(
        "approved merged master"
      );
      expect(() =>
        validateDeviceRenderManifest({
          ...finalExport,
          voiceUrl: "https://example.com/voice.mp3",
        })
      ).toThrow("not a second mix");
    });

    it("must name its caption languages and produce a cover", () => {
      expect(() =>
        validateDeviceRenderManifest({ ...finalExport, captionLanguages: [] })
      ).toThrow("name the caption languages");
      expect(() =>
        validateDeviceRenderManifest({
          ...finalExport,
          output: { ...finalExport.output, coverRequired: false },
        })
      ).toThrow("its own cover");
    });

    it("forces English and Chinese on a Travy export", () => {
      expect(() =>
        validateDeviceRenderManifest({
          ...finalExport,
          travy: true,
          captionLanguages: ["th"],
        })
      ).toThrow("English and Chinese");

      expect(
        validateDeviceRenderManifest({
          ...finalExport,
          travy: true,
          captionLanguages: ["en", "zh"],
        }).travy
      ).toBe(true);
    });

    it("rejects overlapping cues, which would silently hide a line", () => {
      expect(() =>
        validateDeviceRenderManifest({
          ...finalExport,
          captions: [
            { ...finalExport.captions[0], startSeconds: 0, endSeconds: 3 },
            { ...finalExport.captions[0], startSeconds: 1, endSeconds: 4 },
          ],
        })
      ).toThrow("must not overlap");
    });
  });

  it("rejects dimensions that do not match the ratio", () => {
    expect(() => validateDeviceRenderManifest({ ...montage, width: 1920 })).toThrow(
      "Invalid dimensions"
    );
  });

  it("rejects an upload authorisation that expires before the lease", () => {
    expect(() =>
      validateDeviceRenderManifest({
        ...montage,
        upload: {
          storageKey: "final_exports/u/2026-01-01/r/9-16/a.mp4",
          uploadId: "upload-1",
          partSizeBytes: 5 * 1024 * 1024,
          parts: [{ partNumber: 1, url: "https://example.com/part-1" }],
          coverStorageKey: null,
          coverUrl: null,
          expiresAt: new Date("2025-12-31T00:00:00.000Z").toISOString(),
        },
      })
    ).toThrow("expires before the render lease");
  });

  it("measures the picture as the slots minus the scene overlaps", () => {
    const twoScenes = validateDeviceRenderManifest({
      ...montage,
      scenes: [
        {
          ...montage.scenes[0],
          assets: [{ sourceAssetId: "source-1", motion: "static", durationSeconds: 4 }],
        },
        {
          sceneNumber: 1,
          transitionIn: "fade",
          shotTransitionSeconds: 0.2,
          assets: [{ sourceAssetId: "source-1", motion: "static", durationSeconds: 6 }],
        },
      ],
    });
    // 4 + 6, minus one 0.2 s scene crossfade, which is what the server's xfade
    // removes from the concatenated base.
    expect(manifestPictureSeconds(twoScenes)).toBeCloseTo(9.8, 5);
  });

  it("still honours the previous contract version on a completion", () => {
    // An installed app is not upgraded by a server deploy, so a device can
    // finish an attempt it claimed with an older manifest.
    expect(isAcceptedManifestVersion(3)).toBe(true);
    expect(isAcceptedManifestVersion(DEVICE_RENDER_CONTRACT_VERSION)).toBe(true);
    expect(isAcceptedManifestVersion(99)).toBe(false);
    expect(isAcceptedManifestVersion("4")).toBe(false);
  });
});
