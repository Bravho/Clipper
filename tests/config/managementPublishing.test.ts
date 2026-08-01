/**
 * Aspect-ratio rules for the publish composer.
 *
 * These are the guardrails behind "the app rechecks that the video's shape fits
 * the channel": a vertical-only surface must reject a landscape clip, an unknown
 * shape must not be forced into a bucket, and a legacy asset with no recorded
 * ratio must not be blocked on that ground alone.
 */

import {
  acceptedRatiosForPlatform,
  assetAspectRatio,
  classifyDimensions,
  connectionMatchesSuggestedPlatform,
  defaultVariantForPlatform,
  isAspectRatioCompatibleWithPlatform,
  isManagementAspectRatio,
} from "@/config/managementPublishing";

describe("platform ↔ aspect ratio compatibility", () => {
  it("accepts a platform's own shape and rejects a wrong one", () => {
    expect(isAspectRatioCompatibleWithPlatform("tiktok", "9:16")).toBe(true);
    expect(isAspectRatioCompatibleWithPlatform("tiktok", "16:9")).toBe(false);
    expect(isAspectRatioCompatibleWithPlatform("youtube", "16:9")).toBe(true);
    expect(isAspectRatioCompatibleWithPlatform("instagram", "4:5")).toBe(true);
  });

  it("treats a null ratio as unknown, not incompatible", () => {
    expect(isAspectRatioCompatibleWithPlatform("tiktok", null)).toBe(true);
  });

  it("does not gate an unrecognised platform", () => {
    expect(isAspectRatioCompatibleWithPlatform("myspace", "16:9")).toBe(true);
    expect(acceptedRatiosForPlatform("myspace")).toHaveLength(0);
  });

  it("offers each platform's preferred variant as the default", () => {
    expect(defaultVariantForPlatform("tiktok")).toBe("9:16");
    expect(defaultVariantForPlatform("youtube")).toBe("16:9");
    expect(defaultVariantForPlatform("instagram")).toBe("9:16");
    expect(defaultVariantForPlatform("myspace")).toBeNull();
  });
});

describe("classifyDimensions", () => {
  it("snaps real upload dimensions to the nearest supported shape", () => {
    expect(classifyDimensions(1080, 1920)).toBe("9:16");
    expect(classifyDimensions(1920, 1080)).toBe("16:9");
    expect(classifyDimensions(1080, 1080)).toBe("1:1");
    expect(classifyDimensions(1080, 1350)).toBe("4:5");
  });

  it("absorbs small rounding but rejects a genuinely odd shape", () => {
    expect(classifyDimensions(1082, 1918)).toBe("9:16"); // ~rounding
    expect(classifyDimensions(2560, 1080)).toBeNull(); // ~21:9 ultrawide
    expect(classifyDimensions(0, 0)).toBeNull();
    expect(classifyDimensions(100, null)).toBeNull();
  });
});

describe("assetAspectRatio", () => {
  it("prefers the stored ratio string", () => {
    expect(
      assetAspectRatio({ aspectRatio: "9:16", width: 1920, height: 1080 })
    ).toBe("9:16");
  });

  it("falls back to pixel dimensions for an upload with no stored ratio", () => {
    expect(
      assetAspectRatio({ aspectRatio: null, width: 1080, height: 1920 })
    ).toBe("9:16");
  });

  it("returns null when neither is usable", () => {
    expect(
      assetAspectRatio({ aspectRatio: "weird", width: null, height: null })
    ).toBeNull();
  });
});

describe("isManagementAspectRatio", () => {
  it("recognises the four supported shapes only", () => {
    expect(isManagementAspectRatio("9:16")).toBe(true);
    expect(isManagementAspectRatio("21:9")).toBe(false);
    expect(isManagementAspectRatio(null)).toBe(false);
  });
});

describe("channel suggestions", () => {
  it("matches TikTok Business to a generated TikTok suggestion", () => {
    expect(connectionMatchesSuggestedPlatform("tiktok_business", "tiktok")).toBe(true);
    expect(connectionMatchesSuggestedPlatform("tiktok", "tiktok")).toBe(true);
    expect(connectionMatchesSuggestedPlatform("youtube", "tiktok")).toBe(false);
  });
});
