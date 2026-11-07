import { withDefaultFit, frameMismatch } from "@/config/heygenVideoOptions";

const landscape = { width: 1920, height: 1080, orientation: "landscape" as const };
const portrait = { width: 1080, height: 1920, orientation: "portrait" as const };

describe("default fit (cover when the look frame doesn't match the ratio)", () => {
  it.each(["9:16", "4:5", "1:1", "5:4"])("landscape twin + %s -> cover", (ratio) => {
    expect(withDefaultFit({}, ratio, landscape)).toEqual({ fit: "cover" });
  });
  it("landscape twin + 16:9 -> no fit sent (frame matches)", () => {
    expect(withDefaultFit({}, "16:9", landscape)).toEqual({});
  });
  it.each(["16:9", "1:1", "5:4", "4:5"])("portrait twin + %s -> cover", (ratio) => {
    expect(withDefaultFit({}, ratio, portrait)).toEqual({ fit: "cover" });
  });
  it("portrait twin + 9:16 -> no fit", () => {
    expect(withDefaultFit({}, "9:16", portrait)).toEqual({});
  });
  it("auto never forces a fit", () => {
    expect(withDefaultFit({}, "auto", landscape)).toEqual({});
  });
  it("explicit fit always wins", () => {
    expect(withDefaultFit({ fit: "contain" }, "9:16", landscape)).toEqual({ fit: "contain" });
  });
  it("uses preferred_orientation when size is unknown, and treats unknown frames as mismatch", () => {
    expect(frameMismatch("9:16", { orientation: "landscape" })).toBe(true);
    expect(frameMismatch("16:9", { orientation: "landscape" })).toBe(false);
    expect(frameMismatch("9:16", {})).toBe(true);
  });
  it("keeps other settings", () => {
    expect(withDefaultFit({ resolution: "720p" }, "9:16", landscape)).toEqual({ resolution: "720p", fit: "cover" });
  });
});
