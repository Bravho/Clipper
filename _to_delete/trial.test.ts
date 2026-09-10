import {
  TRIAL_CONFIG,
  resolveEntitlement,
  EXHAUSTED_ENTITLEMENT,
} from "@/config/trial";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";

/**
 * The trial ladder is the only thing standing between "free clip" and "฿50
 * charged before generation", so its boundaries are pinned here rather than
 * inferred from whatever the services happen to do.
 */
describe("resolveEntitlement — trial ladder boundaries", () => {
  it("matches the advertised shape: 1 clean + 3 previews", () => {
    expect(TRIAL_CONFIG.FREE_CLEAN_REQUESTS).toBe(1);
    expect(TRIAL_CONFIG.FREE_PREVIEW_REQUESTS).toBe(3);
    expect(TRIAL_CONFIG.FREE_REQUESTS_TOTAL).toBe(4);
  });

  it("request #1 is free and ships watermark-free", () => {
    const e = resolveEntitlement(0);
    expect(e.tier).toBe(RequestPricingTier.FreeClean);
    expect(e.chargeAtSubmit).toBe(false);
    expect(e.downloadUnlockedOnSubmit).toBe(true);
    expect(e.hasFreeAllowanceLeft).toBe(true);
    expect(e.cleanRemaining).toBe(1);
    // The three previews are still ahead of them.
    expect(e.previewRemaining).toBe(3);
  });

  it("requests #2–#4 are free but watermarked, counting down", () => {
    for (const [used, remaining] of [
      [1, 3],
      [2, 2],
      [3, 1],
    ] as const) {
      const e = resolveEntitlement(used);
      expect(e.tier).toBe(RequestPricingTier.FreePreview);
      expect(e.chargeAtSubmit).toBe(false);
      // The clean master is withheld until the unlock is paid.
      expect(e.downloadUnlockedOnSubmit).toBe(false);
      expect(e.hasFreeAllowanceLeft).toBe(true);
      expect(e.cleanRemaining).toBe(0);
      expect(e.previewRemaining).toBe(remaining);
    }
  });

  it("request #5 onward is charged before generation and unwatermarked", () => {
    for (const used of [4, 5, 12]) {
      const e = resolveEntitlement(used);
      expect(e.tier).toBe(RequestPricingTier.PaidUpfront);
      expect(e.chargeAtSubmit).toBe(true);
      expect(e.downloadUnlockedOnSubmit).toBe(true);
      expect(e.hasFreeAllowanceLeft).toBe(false);
      expect(e.previewRemaining).toBe(0);
    }
  });

  it("a carried-over count resumes the ladder where the old account left it", () => {
    // Deleted after 2 submissions, re-registered: they get previews 3 and 4 only.
    const e = resolveEntitlement(2);
    expect(e.tier).toBe(RequestPricingTier.FreePreview);
    expect(e.previewRemaining).toBe(2);
  });

  it("clamps junk input rather than trusting it", () => {
    expect(resolveEntitlement(-5).tier).toBe(RequestPricingTier.FreeClean);
    expect(resolveEntitlement(1.9).tier).toBe(RequestPricingTier.FreePreview);
    expect(resolveEntitlement(NaN).tier).toBe(RequestPricingTier.FreeClean);
  });

  it("EXHAUSTED_ENTITLEMENT is the strictest state, safe as a UI default", () => {
    expect(EXHAUSTED_ENTITLEMENT.tier).toBe(RequestPricingTier.PaidUpfront);
    expect(EXHAUSTED_ENTITLEMENT.chargeAtSubmit).toBe(true);
    expect(EXHAUSTED_ENTITLEMENT.hasFreeAllowanceLeft).toBe(false);
  });
});
