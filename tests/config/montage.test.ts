import {
  assetPlaySeconds,
  minMontageTotalSeconds,
  sceneMontageSeconds,
  MONTAGE_INTRO_SECONDS,
  MONTAGE_ENDING_SECONDS,
} from "@/config/montage";

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
