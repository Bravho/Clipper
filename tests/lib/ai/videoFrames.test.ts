import { framesForDuration, frameTimestamps } from "@/lib/ai/videoFrames";

describe("framesForDuration", () => {
  it("uses 1 frame for clips up to 15s", () => {
    expect(framesForDuration(1)).toBe(1);
    expect(framesForDuration(15)).toBe(1);
  });

  it("uses 2 frames for clips over 15s and up to 30s", () => {
    expect(framesForDuration(15.1)).toBe(2);
    expect(framesForDuration(30)).toBe(2);
  });

  it("uses 3 frames for clips over 30s", () => {
    expect(framesForDuration(30.1)).toBe(3);
    expect(framesForDuration(45)).toBe(3);
  });

  it("defaults to 1 frame for unknown/invalid durations", () => {
    expect(framesForDuration(0)).toBe(1);
    expect(framesForDuration(-5)).toBe(1);
    expect(framesForDuration(NaN)).toBe(1);
    expect(framesForDuration(Infinity)).toBe(1);
  });
});

describe("frameTimestamps", () => {
  it("samples the midpoint for a short clip (1 frame)", () => {
    expect(frameTimestamps(10)).toEqual([5]);
  });

  it("samples thirds for a 2-frame clip", () => {
    const stamps = frameTimestamps(21); // 15 < 21 <= 30 → 2 frames
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBeCloseTo(7, 3);
    expect(stamps[1]).toBeCloseTo(14, 3);
  });

  it("samples quarters for a 3-frame clip", () => {
    expect(frameTimestamps(40)).toEqual([10, 20, 30]);
  });

  it("never samples 0 or the exact end, avoiding black/cut frames", () => {
    for (const stamps of [frameTimestamps(10), frameTimestamps(21), frameTimestamps(40)]) {
      for (const t of stamps) {
        expect(t).toBeGreaterThan(0);
      }
      const duration = stamps.length === 1 ? 10 : stamps.length === 2 ? 21 : 40;
      expect(Math.max(...stamps)).toBeLessThan(duration);
    }
  });

  it("falls back to a single 0s frame when the duration is unknown", () => {
    expect(frameTimestamps(0)).toEqual([0]);
    expect(frameTimestamps(NaN)).toEqual([0]);
  });
});
