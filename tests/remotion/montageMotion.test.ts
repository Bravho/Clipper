import {
  allocateAssetFrames,
  buildKenBurnsTransform,
  clamp,
  getKenBurnsKeyframes,
  lerp,
} from "../../remotion/montageMotion";

describe("montageMotion — clamp/lerp", () => {
  it("clamps into range", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("montageMotion — getKenBurnsKeyframes", () => {
  it("zooms in", () => {
    const k = getKenBurnsKeyframes("ken_burns_in");
    expect(k.scaleFrom).toBe(1.0);
    expect(k.scaleTo).toBeGreaterThan(1.0);
  });

  it("zooms out", () => {
    const k = getKenBurnsKeyframes("ken_burns_out");
    expect(k.scaleFrom).toBeGreaterThan(k.scaleTo);
  });

  it("pans keep a zoom > 1 so edges never show", () => {
    const left = getKenBurnsKeyframes("pan_left");
    expect(left.scaleFrom).toBeGreaterThan(1.0);
    expect(left.translateXFrom).toBeGreaterThan(left.translateXTo); // moves left
    const right = getKenBurnsKeyframes("pan_right");
    expect(right.translateXFrom).toBeLessThan(right.translateXTo); // moves right
  });

  it("static does not move", () => {
    const k = getKenBurnsKeyframes("static");
    expect(k).toEqual({
      scaleFrom: 1.0,
      scaleTo: 1.0,
      translateXFrom: 0,
      translateXTo: 0,
      translateYFrom: 0,
      translateYTo: 0,
    });
  });
});

describe("montageMotion — buildKenBurnsTransform", () => {
  it("returns the start keyframe at progress 0 and end at progress 1", () => {
    expect(buildKenBurnsTransform("ken_burns_in", 0)).toBe("scale(1) translate(0%, 0%)");
    expect(buildKenBurnsTransform("ken_burns_in", 1)).toBe("scale(1.12) translate(0%, 0%)");
  });

  it("clamps out-of-range progress", () => {
    expect(buildKenBurnsTransform("ken_burns_in", -5)).toBe(buildKenBurnsTransform("ken_burns_in", 0));
    expect(buildKenBurnsTransform("ken_burns_in", 5)).toBe(buildKenBurnsTransform("ken_burns_in", 1));
  });

  it("pans translate horizontally", () => {
    expect(buildKenBurnsTransform("pan_left", 0)).toContain("translate(4%");
    expect(buildKenBurnsTransform("pan_left", 1)).toContain("translate(-4%");
  });

  it("static is a no-op transform", () => {
    expect(buildKenBurnsTransform("static", 0.5)).toBe("scale(1) translate(0%, 0%)");
  });
});

describe("montageMotion — allocateAssetFrames", () => {
  it("returns [] for no assets", () => {
    expect(allocateAssetFrames([], 100)).toEqual([]);
  });

  it("splits proportionally and sums exactly to total", () => {
    const ranges = allocateAssetFrames([1, 3], 8);
    expect(ranges.map((r) => r.durationInFrames).reduce((a, b) => a + b, 0)).toBe(8);
    expect(ranges[0].durationInFrames).toBe(2);
    expect(ranges[1].durationInFrames).toBe(6);
  });

  it("produces contiguous ranges starting at 0", () => {
    const ranges = allocateAssetFrames([2, 2, 2], 30);
    expect(ranges[0].from).toBe(0);
    expect(ranges[1].from).toBe(ranges[0].durationInFrames);
    expect(ranges[2].from).toBe(ranges[0].durationInFrames + ranges[1].durationInFrames);
  });

  it("falls back to an even split when all durations are zero", () => {
    const ranges = allocateAssetFrames([0, 0], 10);
    expect(ranges.map((r) => r.durationInFrames).reduce((a, b) => a + b, 0)).toBe(10);
    expect(ranges[0].durationInFrames).toBe(5);
  });

  it("guarantees at least 1 frame per asset even when total is too small", () => {
    const ranges = allocateAssetFrames([1, 1, 1], 2);
    expect(ranges).toHaveLength(3);
    for (const r of ranges) expect(r.durationInFrames).toBeGreaterThanOrEqual(1);
  });
});
