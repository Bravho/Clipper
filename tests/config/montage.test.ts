import {
  assetPlaySeconds,
  evaluateMontageCoverage,
  estimateSuggestedVoiceSeconds,
  estimateAssetDurationRange,
  estimateSceneDurationRange,
  estimateStoryboardTotalRange,
  suggestVoiceDurationRange,
  minMontageTotalSeconds,
  sceneMontageSeconds,
  voiceOverShortageSeconds,
  MONTAGE_INTRO_SECONDS,
  MONTAGE_ENDING_SECONDS,
  SUGGESTED_SECONDS_PER_IMAGE,
  ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN,
  ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX,
} from "@/config/montage";
import { MAX_CLIP_DURATION_SECONDS } from "@/domain/enums/AssetType";

const IMG = { kind: "image" as const };
const clip = (durationSeconds: number | null) => ({ kind: "clip" as const, durationSeconds });

describe("estimateSuggestedVoiceSeconds", () => {
  it("sums real clip footage plus a fixed hold per image", () => {
    expect(
      estimateSuggestedVoiceSeconds({ imageCount: 5, clipSecondsTotal: 15 })
    ).toBe(15 + 5 * SUGGESTED_SECONDS_PER_IMAGE);
  });

  it("counts images only when there is no clip footage", () => {
    expect(estimateSuggestedVoiceSeconds({ imageCount: 3, clipSecondsTotal: 0 })).toBe(
      3 * SUGGESTED_SECONDS_PER_IMAGE
    );
  });

  it("returns 0 when there is no usable media", () => {
    expect(estimateSuggestedVoiceSeconds({ imageCount: 0, clipSecondsTotal: 0 })).toBe(0);
  });

  it("ignores negative / non-finite inputs", () => {
    expect(estimateSuggestedVoiceSeconds({ imageCount: -2, clipSecondsTotal: -4 })).toBe(0);
    expect(
      estimateSuggestedVoiceSeconds({ imageCount: NaN, clipSecondsTotal: 10 })
    ).toBe(10);
  });
});

describe("estimateAssetDurationRange", () => {
  it("gives an image the flat 3–5s hold", () => {
    expect(estimateAssetDurationRange(IMG)).toEqual({
      minSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN,
      maxSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX,
    });
  });

  it("gives a clip its real (max) length as a fixed point range, rounded", () => {
    expect(estimateAssetDurationRange(clip(12))).toEqual({ minSeconds: 12, maxSeconds: 12 });
    expect(estimateAssetDurationRange(clip(8.4))).toEqual({ minSeconds: 8, maxSeconds: 8 });
  });

  it("caps a clip's length at MAX_CLIP_DURATION_SECONDS", () => {
    expect(estimateAssetDurationRange(clip(999))).toEqual({
      minSeconds: MAX_CLIP_DURATION_SECONDS,
      maxSeconds: MAX_CLIP_DURATION_SECONDS,
    });
  });

  it("falls back to the flat estimate for a clip with unknown length", () => {
    expect(estimateAssetDurationRange(clip(null))).toEqual({
      minSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN,
      maxSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX,
    });
    expect(estimateAssetDurationRange(clip(0))).toEqual({
      minSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN,
      maxSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX,
    });
  });

  it("contributes nothing for a missing asset", () => {
    expect(estimateAssetDurationRange(undefined)).toEqual({ minSeconds: 0, maxSeconds: 0 });
    expect(estimateAssetDurationRange(null)).toEqual({ minSeconds: 0, maxSeconds: 0 });
  });
});

describe("estimateSceneDurationRange", () => {
  it("sums images (flat) and clips (real length) in a scene", () => {
    // one image (3–5s) + one 12s clip → 15–17s
    expect(estimateSceneDurationRange([IMG, clip(12)])).toEqual({
      minSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MIN + 12,
      maxSeconds: ESTIMATED_SCENE_SECONDS_PER_ASSET_MAX + 12,
    });
  });

  it("returns a zeroed range for an empty scene", () => {
    expect(estimateSceneDurationRange([])).toEqual({ minSeconds: 0, maxSeconds: 0 });
  });
});

describe("estimateStoryboardTotalRange", () => {
  it("sums the per-scene ranges across the storyboard", () => {
    // scene A: 1 image (3–5); scene B: 1 image + 1 clip(10) (13–15); scene C: 1 clip(6) (6)
    expect(
      estimateStoryboardTotalRange([[IMG], [IMG, clip(10)], [clip(6)]])
    ).toEqual({
      minSeconds: 3 + (3 + 10) + 6,
      maxSeconds: 5 + (5 + 10) + 6,
    });
  });

  it("is a zeroed range when there are no scenes", () => {
    expect(estimateStoryboardTotalRange([])).toEqual({ minSeconds: 0, maxSeconds: 0 });
  });
});

describe("suggestVoiceDurationRange", () => {
  it("suggests a range strictly shorter than the total video's lower bound", () => {
    const total = estimateStoryboardTotalRange([[IMG], [IMG, clip(10)], [clip(6)]]); // { min: 22, max: 26 }
    const voice = suggestVoiceDurationRange(total);
    expect(voice.maxSeconds).toBeLessThan(total.minSeconds);
    expect(voice.minSeconds).toBeLessThanOrEqual(voice.maxSeconds);
    expect(voice.minSeconds).toBeGreaterThanOrEqual(1);
  });

  it("leaves headroom for the music intro and ending tail below the total's lower bound", () => {
    const total = { minSeconds: 12, maxSeconds: 20 };
    const voice = suggestVoiceDurationRange(total);
    expect(voice.maxSeconds).toBe(
      Math.round(12 - (MONTAGE_INTRO_SECONDS + MONTAGE_ENDING_SECONDS))
    );
  });

  it("returns a zeroed range when the total estimate is empty", () => {
    expect(suggestVoiceDurationRange({ minSeconds: 0, maxSeconds: 0 })).toEqual({
      minSeconds: 0,
      maxSeconds: 0,
    });
  });
});

describe("voiceOverShortageSeconds", () => {
  it("is 0 when the picture already covers the voice", () => {
    expect(voiceOverShortageSeconds(30, 25)).toBe(0);
    expect(voiceOverShortageSeconds(30, 30)).toBe(0);
  });

  it("returns how much longer the voice runs than the picture", () => {
    expect(voiceOverShortageSeconds(20, 31)).toBe(11);
  });

  it("treats missing voice/picture as 0", () => {
    expect(voiceOverShortageSeconds(20, null)).toBe(0);
    expect(voiceOverShortageSeconds(0, 12)).toBe(12);
  });
});

describe("assetPlaySeconds", () => {
  it("returns a trimmed clip's selected window (out - in)", () => {
    expect(
      assetPlaySeconds({ kind: "clip", durationSeconds: 3, trimStartSeconds: 2, trimEndSeconds: 8 })
    ).toBe(6);
  });

  it("falls back to durationSeconds for a clip without a valid trim window", () => {
    expect(assetPlaySeconds({ kind: "clip", durationSeconds: 4 })).toBe(4);
    // end <= start is not a valid window
    expect(
      assetPlaySeconds({ kind: "clip", durationSeconds: 4, trimStartSeconds: 5, trimEndSeconds: 5 })
    ).toBe(4);
    expect(
      assetPlaySeconds({ kind: "clip", durationSeconds: 4, trimStartSeconds: 6, trimEndSeconds: 3 })
    ).toBe(4);
  });

  it("uses durationSeconds for stills (trim is ignored)", () => {
    expect(
      assetPlaySeconds({ kind: "image", durationSeconds: 5, trimStartSeconds: 1, trimEndSeconds: 9 })
    ).toBe(5);
  });

  it("returns 0 for a non-positive/absent duration", () => {
    expect(assetPlaySeconds({ kind: "image" })).toBe(0);
    expect(assetPlaySeconds({ kind: "image", durationSeconds: 0 })).toBe(0);
  });
});

describe("sceneMontageSeconds", () => {
  it("sums per-asset play seconds, counting trimmed clips by their window", () => {
    const total = sceneMontageSeconds({
      durationSeconds: 999, // ignored when assets are present
      assets: [
        { kind: "image", durationSeconds: 3 },
        { kind: "clip", durationSeconds: 2, trimStartSeconds: 1, trimEndSeconds: 6 }, // 5s window
      ],
    });
    expect(total).toBe(8);
  });

  it("falls back to scene.durationSeconds when there are no assets", () => {
    expect(sceneMontageSeconds({ durationSeconds: 7, assets: [] })).toBe(7);
    expect(sceneMontageSeconds({ durationSeconds: 7 })).toBe(7);
  });
});

describe("minMontageTotalSeconds", () => {
  it("requires the voice length plus the intro and ending", () => {
    expect(minMontageTotalSeconds(20)).toBeCloseTo(20 + MONTAGE_INTRO_SECONDS + MONTAGE_ENDING_SECONDS);
  });

  it("treats missing/non-positive voice length as zero voice", () => {
    const floor = MONTAGE_INTRO_SECONDS + MONTAGE_ENDING_SECONDS;
    expect(minMontageTotalSeconds(null)).toBeCloseTo(floor);
    expect(minMontageTotalSeconds(undefined)).toBeCloseTo(floor);
    expect(minMontageTotalSeconds(0)).toBeCloseTo(floor);
    expect(minMontageTotalSeconds(-5)).toBeCloseTo(floor);
  });
});

describe("evaluateMontageCoverage", () => {
  it("uses the same strict voice + intro + ending rule at every gate", () => {
    expect(
      evaluateMontageCoverage({ voiceDurationSeconds: 20, totalSceneSeconds: 21.6 })
        .isCovered
    ).toBe(true);
    const short = evaluateMontageCoverage({
      voiceDurationSeconds: 20,
      totalSceneSeconds: 20,
    });
    expect(short.isCovered).toBe(false);
    expect(short.deficitSeconds).toBeCloseTo(1.6);
  });
});
