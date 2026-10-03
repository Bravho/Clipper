import {
  buildDeviceRenderManifest,
  captionShiftSeconds,
  type BuildDeviceRenderManifestInput,
} from "@/lib/mobile/deviceRenderManifestBuilder";
import { DEVICE_MUSIC_LEAD_IN_SECONDS } from "@/lib/mobile/deviceRenderAudio";
import { DEVICE_MIN_CLIP_PLAYBACK_RATE } from "@/lib/mobile/deviceRenderCaptions";

/**
 * The builder is the translation from APPROVED job data to something a phone
 * renders. Every test here is about a way that translation could silently
 * produce a video nobody approved: a trim that was never pinned, a caption that
 * lands 0.6 s early, a clip that freezes instead of slowing, a source that
 * should not have been sent at all.
 */

const template: BuildDeviceRenderManifestInput["template"] = {
  id: "clean_frame",
  frame: "corner_bracket",
  canvas: "none",
  decor: ["corner_brackets", "ripple"],
  palette: {
    primary: "#FF6B35",
    secondary: "#FFB703",
    accent: "#06D6A0",
    neutral: "#FFFFFF",
  },
};

function base(overrides: Partial<BuildDeviceRenderManifestInput> = {}) {
  return {
    attemptId: "attempt-1",
    taskId: "task-1",
    jobId: "job-1",
    requestId: "request-1",
    step: "overlay_composition",
    stage: "montage" as const,
    ratio: "9:16" as const,
    sources: [
      {
        assetId: "photo-1",
        kind: "image" as const,
        url: "https://example.com/photo.jpg",
        mimeType: "image/jpeg",
        durationSeconds: null,
      },
      {
        assetId: "clip-1",
        kind: "clip" as const,
        url: "https://example.com/clip.mp4",
        mimeType: "video/mp4",
        durationSeconds: 8,
      },
    ],
    scenes: [
      {
        sceneNumber: 0,
        transitionIn: "fade" as const,
        assets: [
          {
            sourceAssetId: "photo-1",
            durationSeconds: 4,
            motion: "ken_burns_in" as const,
            focusX: 0.3,
            focusY: 0.7,
          },
          {
            sourceAssetId: "clip-1",
            durationSeconds: 5,
            motion: "static" as const,
            trimStartSeconds: 1,
          },
        ],
      },
    ],
    template,
    leaseExpiresAt: new Date("2026-06-01T00:00:00.000Z"),
    maxOutputBytes: 400 * 1024 * 1024,
    ...overrides,
  } satisfies BuildDeviceRenderManifestInput;
}

describe("device render manifest builder", () => {
  it("builds a silent montage from the approved scene plan", () => {
    const manifest = buildDeviceRenderManifest(base());

    expect(manifest.stage).toBe("montage");
    expect(manifest.output.audioCodec).toBeNull();
    expect(manifest.captions).toHaveLength(0);
    expect(manifest.scenes[0].assets).toHaveLength(2);
    expect(manifest.width).toBe(1080);
    expect(manifest.height).toBe(1920);
  });

  it("carries the approved subject focus onto the still", () => {
    // Focus is what steers the Ken Burns zoom onto the dish rather than the
    // photo's centre. Losing it is invisible in a thumbnail and obvious in the
    // video.
    const shot = buildDeviceRenderManifest(base()).scenes[0].assets[0];
    expect(shot.focusX).toBeCloseTo(0.3, 5);
    expect(shot.focusY).toBeCloseTo(0.7, 5);
    expect(shot.motion).toBe("ken_burns_in");
  });

  it("pins a clip's footage window when the plan left it open", () => {
    // The server does this with ffprobe before a render, so the renderer knows
    // when the footage runs out and can go black instead of freezing a frame.
    // A plan with only a start would otherwise reach the phone unbounded.
    const shot = buildDeviceRenderManifest(base()).scenes[0].assets[1];
    expect(shot.trimStartSeconds).toBe(1);
    expect(shot.trimEndSeconds).toBe(6); // start 1 + slot 5, within the 8s source
  });

  it("never opens a window wider than the source", () => {
    const manifest = buildDeviceRenderManifest(
      base({
        scenes: [
          {
            sceneNumber: 0,
            transitionIn: "fade",
            assets: [
              {
                sourceAssetId: "clip-1",
                durationSeconds: 20,
                motion: "static",
                trimStartSeconds: 2,
              },
            ],
          },
        ],
      })
    );
    expect(manifest.scenes[0].assets[0].trimEndSeconds).toBe(8);
  });

  it("slows a clip whose slot outruns its footage, within the floor", () => {
    const manifest = buildDeviceRenderManifest(
      base({
        scenes: [
          {
            sceneNumber: 0,
            transitionIn: "fade",
            assets: [
              {
                // The source is 8s; playing 7.2s of it across an 8s slot is a
                // 0.9 rate — slow enough to notice, well inside the 0.8 floor.
                sourceAssetId: "clip-1",
                durationSeconds: 8,
                motion: "static",
                trimStartSeconds: 0,
                trimEndSeconds: 7.2,
              },
            ],
          },
        ],
      })
    );
    const rate = manifest.scenes[0].assets[0].playbackRate;
    expect(rate).toBeCloseTo(0.9, 5);
    expect(rate).toBeGreaterThanOrEqual(DEVICE_MIN_CLIP_PLAYBACK_RATE);
  });

  it("normalises a stale plan that put a camera move on a clip", () => {
    // `toRenderAssetSpecs` forces clips to play as shot; a plan written before
    // that fix should be corrected, not rejected — the video is still valid.
    const manifest = buildDeviceRenderManifest(
      base({
        scenes: [
          {
            sceneNumber: 0,
            transitionIn: "fade",
            assets: [
              {
                sourceAssetId: "clip-1",
                durationSeconds: 3,
                motion: "pan_left",
                trimStartSeconds: 0,
                trimEndSeconds: 3,
              },
            ],
          },
        ],
      })
    );
    expect(manifest.scenes[0].assets[0].motion).toBe("static");
  });

  it("only ships the sources the approved scenes actually use", () => {
    // Every unused source is a signed URL handed out for nothing and a file a
    // phone would download for nothing.
    const manifest = buildDeviceRenderManifest(
      base({
        scenes: [
          {
            sceneNumber: 0,
            transitionIn: "fade",
            assets: [
              { sourceAssetId: "photo-1", durationSeconds: 4, motion: "ken_burns_in" },
            ],
          },
        ],
      })
    );
    expect(manifest.sources.map((source) => source.assetId)).toEqual(["photo-1"]);
  });

  it("refuses a scene that points at material the manifest does not have", () => {
    expect(() =>
      buildDeviceRenderManifest(
        base({
          scenes: [
            {
              sceneNumber: 0,
              transitionIn: "fade",
              assets: [{ sourceAssetId: "missing", durationSeconds: 4, motion: "static" }],
            },
          ],
        })
      )
    ).toThrow("unknown source");
  });

  it("refuses a shot with no duration rather than inventing one", () => {
    expect(() =>
      buildDeviceRenderManifest(
        base({
          scenes: [
            {
              sceneNumber: 0,
              transitionIn: "fade",
              assets: [{ sourceAssetId: "photo-1", durationSeconds: 0, motion: "static" }],
            },
          ],
        })
      )
    ).toThrow("no duration");
  });

  describe("master stage", () => {
    it("carries the voice, the music and the lead-in together", () => {
      const manifest = buildDeviceRenderManifest(
        base({
          stage: "master",
          inputVideoUrl: "https://example.com/montage.mp4",
          voiceUrl: "https://example.com/voice.mp3",
          musicUrl: "https://example.com/music.mp3",
          musicSelected: true,
          voiceDurationSeconds: 14,
        })
      );
      expect(manifest.masterUrl).toBe("https://example.com/montage.mp4");
      expect(manifest.voiceUrl).toBe("https://example.com/voice.mp3");
      expect(manifest.audio.musicSelected).toBe(true);
      expect(manifest.audio.voiceLeadInSeconds).toBe(DEVICE_MUSIC_LEAD_IN_SECONDS);
      expect(manifest.audio.voiceDurationSeconds).toBe(14);
      expect(manifest.output.audioCodec).toBe("aac");
      // A stage that builds from an existing render needs neither.
      expect(manifest.scenes).toHaveLength(0);
      expect(manifest.sources).toHaveLength(0);
    });

    it("drops the lead-in when no music was selected", () => {
      const manifest = buildDeviceRenderManifest(
        base({
          stage: "master",
          inputVideoUrl: "https://example.com/montage.mp4",
          voiceUrl: "https://example.com/voice.mp3",
          musicSelected: false,
        })
      );
      expect(manifest.audio.musicSelected).toBe(false);
      expect(manifest.audio.voiceLeadInSeconds).toBe(0);
    });
  });

  describe("final stage", () => {
    const finalInput = () =>
      base({
        stage: "final",
        inputVideoUrl: "https://example.com/master.mp4",
        musicSelected: true,
        captionLanguages: ["th", "en"],
        captions: [
          { startSecond: 0, endSecond: 2.5, textThai: "สวัสดี", textEnglish: "Hello" },
          { startSecond: 2.5, endSecond: 5, textThai: "ยินดีต้อนรับ", textEnglish: "Welcome" },
        ],
      });

    it("shifts cues by the lead-in so they stay with the speech", () => {
      // The master opens on music alone, so a cue timed against the raw voice
      // lands 0.6 s early. This is the single most common cause of
      // out-of-sync captions, which is why the shift is applied once, here.
      const manifest = buildDeviceRenderManifest(finalInput());
      expect(manifest.captions[0].startSeconds).toBeCloseTo(DEVICE_MUSIC_LEAD_IN_SECONDS, 5);
      expect(manifest.captions[1].startSeconds).toBeCloseTo(
        2.5 + DEVICE_MUSIC_LEAD_IN_SECONDS,
        5
      );
    });

    it("does not shift cues when there was no music-only intro", () => {
      const manifest = buildDeviceRenderManifest({
        ...finalInput(),
        musicSelected: false,
      });
      expect(manifest.captions[0].startSeconds).toBe(0);
      expect(captionShiftSeconds(false)).toBe(0);
    });

    it("carries the master's audio rather than a second mix", () => {
      const manifest = buildDeviceRenderManifest(finalInput());
      expect(manifest.voiceUrl).toBeNull();
      expect(manifest.musicUrl).toBeNull();
      expect(manifest.output.audioCodec).toBe("aac");
    });

    it("requires a cover from the finished video", () => {
      expect(buildDeviceRenderManifest(finalInput()).output.coverRequired).toBe(true);
    });

    it("drops a cue with no text in any language", () => {
      const manifest = buildDeviceRenderManifest({
        ...finalInput(),
        captions: [
          { startSecond: 0, endSecond: 2, textThai: "", textEnglish: "", textChinese: "" },
          { startSecond: 2, endSecond: 4, textEnglish: "Only this one" },
        ],
      });
      expect(manifest.captions).toHaveLength(1);
      expect(manifest.captions[0].textEnglish).toBe("Only this one");
    });

    it("orders cues by time even when the timeline arrives shuffled", () => {
      const manifest = buildDeviceRenderManifest({
        ...finalInput(),
        captions: [
          { startSecond: 4, endSecond: 6, textEnglish: "second" },
          { startSecond: 0, endSecond: 2, textEnglish: "first" },
        ],
      });
      expect(manifest.captions.map((cue) => cue.textEnglish)).toEqual(["first", "second"]);
    });

    it("forces English and Chinese on a Travy export", () => {
      const manifest = buildDeviceRenderManifest({
        ...finalInput(),
        travy: true,
        captionLanguages: ["th"],
        captions: [
          { startSecond: 0, endSecond: 2, textEnglish: "Hello", textChinese: "你好" },
        ],
      });
      expect(manifest.captionLanguages).toEqual(["en", "zh"]);
    });

    it("defaults to English and Chinese when the job named no languages", () => {
      const manifest = buildDeviceRenderManifest({
        ...finalInput(),
        captionLanguages: [],
      });
      expect(manifest.captionLanguages).toEqual(["en", "zh"]);
    });
  });

  describe("composed from the originals (plugin v6+)", () => {
    const voice = "https://example.com/voice.mp3";
    const music = "https://example.com/music.mp3";

    it("builds a master from the scene plan and the mix, with no montage download", () => {
      const manifest = buildDeviceRenderManifest(
        base({
          stage: "master",
          buildFromSources: true,
          voiceUrl: voice,
          musicUrl: music,
          musicSelected: true,
        })
      );
      expect(manifest.buildFromSources).toBe(true);
      expect(manifest.masterUrl).toBeNull();
      expect(manifest.scenes).toHaveLength(1);
      expect(manifest.sources.map((source) => source.assetId)).toEqual(["photo-1", "clip-1"]);
      expect(manifest.voiceUrl).toBe(voice);
      expect(manifest.audio.voiceLeadInSeconds).toBe(DEVICE_MUSIC_LEAD_IN_SECONDS);
      expect(manifest.output.audioCodec).toBe("aac");
    });

    it("builds a final that mixes, decorates and captions in one pass", () => {
      const manifest = buildDeviceRenderManifest(
        base({
          stage: "final",
          buildFromSources: true,
          voiceUrl: voice,
          musicUrl: music,
          musicSelected: true,
          captionLanguages: ["th", "en"],
          captions: [{ startSecond: 0, endSecond: 2, textThai: "สวัสดี", textEnglish: "Hello" }],
        })
      );
      expect(manifest.buildFromSources).toBe(true);
      expect(manifest.masterUrl).toBeNull();
      expect(manifest.voiceUrl).toBe(voice);
      expect(manifest.musicUrl).toBe(music);
      expect(manifest.audio.musicSelected).toBe(true);
      expect(manifest.scenes[0].assets).toHaveLength(2);
      // Same lead-in as the mix it makes, so captions stay on the speech.
      expect(manifest.captions[0].startSeconds).toBeCloseTo(DEVICE_MUSIC_LEAD_IN_SECONDS, 5);
      expect(manifest.output.coverRequired).toBe(true);
    });

    it("refuses a from-sources final without the voice to mix", () => {
      expect(() =>
        buildDeviceRenderManifest(
          base({ stage: "final", buildFromSources: true, captionLanguages: ["en"] })
        )
      ).toThrow(/voice/);
    });

    it("ignores the flag on a montage, which always builds from sources", () => {
      const manifest = buildDeviceRenderManifest(base({ buildFromSources: true }));
      expect(manifest.buildFromSources).toBe(false);
      expect(manifest.output.audioCodec).toBeNull();
    });
  });

  it("refuses a ratio it has no canvas for", () => {
    expect(() =>
      buildDeviceRenderManifest(
        base({ ratio: "21:9" as unknown as BuildDeviceRenderManifestInput["ratio"] })
      )
    ).toThrow("Unsupported render ratio");
  });

  it("refuses duplicate source ids, which would make a shot ambiguous", () => {
    expect(() =>
      buildDeviceRenderManifest(
        base({
          sources: [
            {
              assetId: "photo-1",
              kind: "image",
              url: "https://example.com/a.jpg",
              mimeType: "image/jpeg",
              durationSeconds: null,
            },
            {
              assetId: "photo-1",
              kind: "image",
              url: "https://example.com/b.jpg",
              mimeType: "image/jpeg",
              durationSeconds: null,
            },
          ],
        })
      )
    ).toThrow("Duplicate source asset");
  });
});

describe("shot framing in the manifest", () => {
  it("fills the frame unless the plan says otherwise", () => {
    const shots = buildDeviceRenderManifest(base()).scenes[0].assets;
    expect(shots.map((shot) => shot.frameZoom)).toEqual([1, 1]);
  });

  it("carries a chosen zoom, clamped to 0..1", () => {
    const input = base();
    input.scenes[0].assets[0] = { ...input.scenes[0].assets[0], frameZoom: 0.35 } as never;
    input.scenes[0].assets[1] = { ...input.scenes[0].assets[1], frameZoom: 4 } as never;
    const shots = buildDeviceRenderManifest(input).scenes[0].assets;
    expect(shots[0].frameZoom).toBe(0.35);
    expect(shots[1].frameZoom).toBe(1);
  });
});
