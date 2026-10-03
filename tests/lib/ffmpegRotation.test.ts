import { normaliseRotation } from "@/lib/ai/ffmpegService";

/** ffprobe reports rotation as a `rotate` tag ("90") or display-matrix side data (-90). */
describe("normaliseRotation", () => {
  it("reads both ffprobe forms as a quarter turn", () => {
    expect(normaliseRotation("90")).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(270)).toBe(270);
    expect(normaliseRotation("180")).toBe(180);
    expect(normaliseRotation(-180)).toBe(180);
  });

  it("treats missing or junk values as upright", () => {
    expect(normaliseRotation(undefined)).toBe(0);
    expect(normaliseRotation("")).toBe(0);
    expect(normaliseRotation("abc")).toBe(0);
    expect(normaliseRotation(360)).toBe(0);
  });
});
