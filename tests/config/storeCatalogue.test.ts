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
      expect(topUpsFor(ladder, 190)).toBe(1); // Starter, 1 month
      expect(topUpsFor(ladder, 350)).toBe(1); // Pro, 1 month
    }
  });

  it("gets a store buyer to Pro 6 months and Starter 1 year in one transaction", () => {
    // The 2,000 rung was added for exactly this: 1,900 credits used to take two
    // purchases. Now an invariant worth protecting, not a pin.
    for (const ladder of [IOS, ANDROID]) {
      expect(topUpsFor(ladder, 1890)).toBe(1);
    }
  });

  it("documents that the annual bundle still costs a store buyer two transactions", () => {
    // Pro 1 year is 3,490 credits against a 2,000 ceiling. Adding a 3,500 rung
    // (~฿4,550 at the flat 1.30 rate, created in both consoles first) would
    // finish the job; until then this is pinned so the suite stays honest.
    expect(topUpsFor(ANDROID, dearest)).toBe(2);
    expect(topUpsFor(IOS, dearest)).toBe(2);
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

  it("has no unreconciled rows left", () => {
    // Both consoles were read on 2026-09-10. Anything appearing here again is a
    // product someone added to the table without opening a console.
    expect(unverifiedStoreProducts()).toEqual([]);
  });

  it("passes the release gate", () => {
    expect(() => assertStoreCatalogueVerified()).not.toThrow();
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
