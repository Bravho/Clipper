/**
 * The limits users are TOLD (pricing, credits, /plans, the purchase dialog)
 * must be the limits the server ENFORCES. config/planLimits reads them from the
 * enforcing configs; this pins that link and the tier facts shown.
 */
import { FREE_FACTS, perVideoLimits, tierFacts } from "@/config/planLimits";
import { MAX_CHANNEL_SHAPES_PER_REQUEST, MAX_VOICE_MAKES_PER_REQUEST } from "@/config/requestLimits";
import { STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";
import { FREE_REQUESTS_PER_WINDOW, FREE_WINDOW_DAYS } from "@/config/videoPackages";
import { perVideoLimitsSummary } from "@/config/planLimits";
import { translate } from "@/i18n/messages";

describe("plan limits shown to users", () => {
  it("shows the per-video limits the server enforces", () => {
    const limits = perVideoLimits();
    expect(limits.voiceMakes).toBe(MAX_VOICE_MAKES_PER_REQUEST);
    expect(limits.shapes).toBe(MAX_CHANNEL_SHAPES_PER_REQUEST);
    expect(limits.maxSeconds).toBe(STUDIO_MAX_DURATION_SECONDS);
    expect(limits.maxItems).toBe(MAX_UPLOAD_COUNT);
  });

  it("describes the tiers and the free allowance from the catalogue", () => {
    expect(tierFacts("starter")).toEqual({ videosPerMonth: 5, monthlyPrice: 190, lowestPerMonth: 158 });
    expect(tierFacts("pro")).toEqual({ videosPerMonth: 10, monthlyPrice: 350, lowestPerMonth: 291 });
    expect(FREE_FACTS).toEqual({ videos: FREE_REQUESTS_PER_WINDOW, days: FREE_WINDOW_DAYS });
  });

  it("fills every number into the one-line summary in each language", () => {
    for (const locale of ["th", "en", "vi"] as const) {
      const line = perVideoLimitsSummary((key, vars) => translate(locale, key, vars));
      expect(line).toContain(String(STUDIO_MAX_DURATION_SECONDS));
      expect(line).toContain(String(MAX_VOICE_MAKES_PER_REQUEST));
      expect(line).toContain(String(MAX_CHANNEL_SHAPES_PER_REQUEST));
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });
});
