/**
 * The credit ladder has to be able to buy the things we sell, at a price that
 * is still worth something after the store takes its cut.
 *
 * Neither property is visible from inside a single file. The packages live in
 * videoPackages/management, the rungs live in credits/mobilePurchases, and the
 * commission lives in a contract with Apple and Google. This is the only place
 * the three meet, so it is the only place the arithmetic can be checked.
 */

import {
  IOS_STORE_PRODUCTS,
  ANDROID_STORE_PRODUCTS,
  STORE_COMMISSION,
  storeProductsFor,
  creditsForStoreProduct,
  unverifiedStoreProducts,
  assertStoreCatalogueVerified,
} from "@/config/mobilePurchases";
import { TOPUP_BUNDLES, CREDITS_CONFIG } from "@/config/credits";
import { MANAGEMENT_PACKAGES_ON_SALE, managementPriceCredits } from "@/config/management";

// What is SOLD today (the Starter and Pro packages, 2026-09-27). Retired
// products cannot be bought, so the ladder no longer has to reach them.
const packagePrices = MANAGEMENT_PACKAGES_ON_SALE.map(managementPriceCredits);
const dearest = Math.max(...packagePrices);
const cheapestPackage = Math.min(...packagePrices);

const WEB = TOPUP_BUNDLES.map((b) => b.credits);
const IOS = IOS_STORE_PRODUCTS.map((p) => p.credits);
const ANDROID = ANDROID_STORE_PRODUCTS.map((p) => p.credits);

/**
 * The FEWEST top-up transactions that get a buyer to at least `target` credits.
 *
 * "At least" is the point: a buyer needing 350 credits does not assemble
 * 200+100+50, they buy the 500 rung once and let the remainder sit in the
 * wallet. Counting exact change would model a customer nobody has ever been,
 * and would have scored the ladder as three times worse than it is.
 */
function topUpsFor(ladder: readonly number[], target: number): number {
  const largest = Math.max(...ladder);
  if (target <= largest) return 1;
  const full = Math.floor(target / largest);
  const remainder = target - full * largest;
  return remainder === 0 ? full : full + 1;
}

describe("credit ladder reachability", () => {
  it("lets a web buyer cover the dearest package in one top-up", () => {
    expect(topUpsFor(WEB, dearest)).toBe(1);
  });

  it("lets a store buyer cover the COMMON packages in one top-up", () => {
    // The entry video package and the entry bundle are what most buyers reach
    // for. Those must never be a multi-transaction ordeal.
    for (const ladder of [IOS, ANDROID]) {
      expect(topUpsFor(ladder, 99)).toBe(1);   // Starter, 1 month
      expect(topUpsFor(ladder, 179)).toBe(1);  // Pro, 1 month
    }
  });

  it("gets a store buyer to any on-sale plan in one transaction", () => {
    // Starter 12mo = 990, Pro 12mo = 1790; the 2,000 rung covers both.
    for (const ladder of [IOS, ANDROID]) {
      expect(topUpsFor(ladder, 990)).toBe(1);   // Starter 12 months
      expect(topUpsFor(ladder, 1790)).toBe(1);  // Pro 12 months
    }
  });

  it("covers the dearest on-sale plan (Pro 12mo = 1790) in one store transaction", () => {
    // Pro 12 months = 1790 credits; the 2,000 store rung covers it in one purchase.
    expect(topUpsFor(ANDROID, dearest)).toBe(1);
    expect(topUpsFor(IOS, dearest)).toBe(1);
  });

  it("covers the cheapest package with the smallest rung", () => {
    // A ladder whose bottom rung overshoots the cheapest package strands credit
    // on every first purchase.
    for (const ladder of [WEB, IOS, ANDROID]) {
      expect(Math.min(...ladder)).toBeLessThanOrEqual(cheapestPackage);
    }
  });

  it("offers the same credit amounts on both stores", () => {
    // A rung present on one store and missing on the other silently removes an
    // option for half the users.
    expect(IOS).toEqual(ANDROID);
  });

  it("keeps every ladder ascending and free of duplicates", () => {
    for (const ladder of [WEB, IOS, ANDROID]) {
      expect([...ladder].sort((a, b) => a - b)).toEqual([...ladder]);
      expect(new Set(ladder).size).toBe(ladder.length);
    }
  });
});

describe("store pricing solvency", () => {
  it("nets at least the web value per credit at the small-business rate", () => {
    // A credit is worth ฿1 because that is what web charges and what every
    // package is denominated in. If a store top-up nets less than that, we are
    // selling credits below their own value — and the more the stores sell, the
    // worse it gets.
    const keep = 1 - STORE_COMMISSION.smallBusiness;
    for (const platform of ["ios", "android"] as const) {
      for (const p of storeProductsFor(platform)) {
        const net = (p.plannedPriceBaht / p.credits) * keep;
        expect({
          platform,
          productId: p.productId,
          solvent: net >= CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE,
        }).toEqual({ platform, productId: p.productId, solvent: true });
      }
    }
  });

  it("does NOT survive the standard 30% rate — which is why enrolment matters", () => {
    // Documenting the cliff rather than hiding it. At 30% the flat 1.30× uplift
    // nets ฿0.91 per credit. Both stores now charge the same
    // rate, so ONE assumption — small-business enrolment — carries the whole
    // native business. Apple's is an annual opt-in, not automatic. If either
    // lapses, prices must rise to ~1.43× before the next release.
    const keep = 1 - STORE_COMMISSION.standard;
    const underwater = (["ios", "android"] as const).flatMap((platform) =>
      storeProductsFor(platform).filter(
        (p) =>
          (p.plannedPriceBaht / p.credits) * keep <
          CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE
      )
    );
    expect(underwater.length).toBeGreaterThan(0);
  });

  it("charges a store buyer more per credit than web, never less", () => {
    for (const platform of ["ios", "android"] as const) {
      for (const p of storeProductsFor(platform)) {
        expect(p.plannedPriceBaht / p.credits).toBeGreaterThan(
          CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE
        );
      }
    }
  });
});

describe("store catalogue integrity", () => {
  it("resolves credits only for the platform that owns the receipt", () => {
    expect(creditsForStoreProduct("com.rclipper.credits.100", "ios")).toBe(100);
    expect(creditsForStoreProduct("com.rclipper.credits.100", "android")).toBe(100);
    expect(creditsForStoreProduct("com.rclipper.credits.nope", "ios")).toBeNull();
  });

  it("flags all rows as unreconciled after the 2026-10-27 repricing", () => {
    // All prices changed to 1.20× on 2026-10-27 and verified: false was set
    // for every row on both stores. assertStoreCatalogueVerified() is expected
    // to throw until Tho reconciles in App Store Connect and Play Console.
    expect(unverifiedStoreProducts().length).toBeGreaterThan(0);
  });

  it("throws at the release gate while rows are unreconciled", () => {
    // Intentional: verified: false is set for every row after the 2026-10-27
    // repricing. Tho must reconcile in the store consoles before shipping.
    expect(() => assertStoreCatalogueVerified()).toThrow();
  });

  it("prices a credit identically on both stores today", () => {
    // Not an invariant we are committing to — Apple's ladder is fixed and
    // Google's is not, so they can drift. Pinned so that a drift is a decision
    // someone makes on purpose rather than a typo nobody notices.
    for (let i = 0; i < IOS_STORE_PRODUCTS.length; i++) {
      expect(IOS_STORE_PRODUCTS[i].plannedPriceBaht).toBe(
        ANDROID_STORE_PRODUCTS[i].plannedPriceBaht
      );
    }
  });
});
