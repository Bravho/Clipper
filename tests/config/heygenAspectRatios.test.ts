import {
  HEYGEN_ASPECT_RATIOS,
  DEFAULT_HEYGEN_ASPECT_RATIO,
  isHeyGenAspectRatio,
  aspectFramingNote,
} from "@/config/heygenAspectRatios";
import { avatarVideoEntryAspectForTest } from "./heygenAspectRatios.helpers";

describe("heygenAspectRatios", () => {
  it("allowlist matches the documented /v3/videos values and defaults to 9:16", () => {
    expect([...HEYGEN_ASPECT_RATIOS].sort()).toEqual(["1:1", "16:9", "4:5", "5:4", "9:16", "auto"].sort());
    expect(DEFAULT_HEYGEN_ASPECT_RATIO).toBe("9:16");
    expect(isHeyGenAspectRatio("9:16")).toBe(true);
    expect(isHeyGenAspectRatio("21:9")).toBe(false);
    expect(isHeyGenAspectRatio(undefined)).toBe(false);
  });

  it("framing note: landscape 1280x720 twin in 9:16 warns, in 16:9 does not", () => {
    expect(aspectFramingNote("9:16", 1280, 720)).toContain("1280");
    expect(aspectFramingNote("16:9", 1280, 720)).toBe("");
    expect(aspectFramingNote("auto", 1280, 720)).toBe("");
    expect(aspectFramingNote("1:1", undefined, undefined)).toBe("");
    expect(aspectFramingNote("16:9", 720, 1280)).not.toBe("");
  });

  it("old entries without aspectRatio display as 9:16", () => {
    expect(avatarVideoEntryAspectForTest({})).toBe("9:16");
    expect(avatarVideoEntryAspectForTest({ aspectRatio: "4:5" })).toBe("4:5");
  });
});
