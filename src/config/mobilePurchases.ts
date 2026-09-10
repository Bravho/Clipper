/**
 * In-app purchase catalogue for the native shells.
 *
 * WHY PRICES DIFFER BY PLATFORM. A package always costs the SAME number of
 * credits everywhere (see src/config/videoPackages.ts and management.ts) — what
 * differs is the real money a credit costs, because Apple and Google take a
 * commission (commonly 15–30%). Absorbing that at the top-up keeps every
 * downstream price uniform: one catalogue of packages, no per-platform package
 * logic, and nothing for a store reviewer to compare against a cheaper in-app
 * price.
 *
 * THIS FILE DOES NOT KNOW WHAT ANYTHING COSTS, AND MUST NOT PRETEND TO.
 *
 * The two stores work differently, and neither lets us decide the price here:
 *
 *   Apple  — a FIXED ladder of up to 800 price points per currency. You pick a
 *            point; you cannot type an arbitrary baht value. The THB ladder is
 *            only visible inside App Store Connect ("All Prices and Currencies"
 *            on the Pricing tab), so a number invented in this file is a guess
 *            that may not exist as a selectable option.
 *   Google — no fixed ladder. You set a price per country within a minimum and
 *            maximum, and Play applies local pricing patterns. Flexible, but
 *            still decided in Play Console, not here.
 *
 * On top of that, both stores charge in the buyer's own currency and show their
 * OWN localized price string. A number stored here could be stale the moment an
 * exchange rate or a local tax rate moves.
 *
 * So the ONLY authoritative field in this table is `credits`: what a verified
 * receipt for `productId` is worth in the wallet. `plannedPriceBaht` is an
 * internal planning figure used to sanity-check the ladder — it must never be
 * rendered to a user and never used to charge. The native shells display the
 * price string StoreKit / Play Billing returns for the product.
 *
 * ⚠️ `verified: false` MEANS THIS ROW HAS NOT BEEN RECONCILED against a real
 * store product. `assertStoreCatalogueVerified()` fails while any row is
 * unverified, so a release build cannot silently ship a guess. Flip a row to
 * true only after its `productId` exists in the console and its price point has
 * been chosen there. As of 2026-09-10 every row on both stores is verified —
 * set a NEW row back to false rather than assuming the table stays clean.
 *
 * Web (Stripe PromptPay/Card) keeps 1 credit = ฿1 and lives in `TOPUP_BUNDLES`
 * in src/config/credits.ts. That one IS authoritative, because we charge it.
 */

export interface StoreProduct {
  /** Must match the product identifier registered in the store console. */
  productId: string;
  /** Credits granted on a verified purchase. THE server-side truth. */
  credits: number;
  /**
   * Internal planning figure in ฿ — roughly web price ÷ 0.7 to absorb store
   * commission. NOT a price, NOT for display, NOT for charging. Its only job is
   * to let a human and `tests/config/storeCatalogue.test.ts` see whether the
   * ladder is sensibly shaped before anyone opens a console.
   *
   * On Apple this must be snapped to the nearest EXISTING price point; on Play
   * it can be set directly, subject to the market minimum.
   */
  plannedPriceBaht: number;
  /** True once the product and its price point exist in the store console. */
  verified: boolean;
}

/**
 * Store commission assumptions, and what they demand of the uplift.
 *
 * A credit is worth ฿1 to us, because that is what web charges and what every
 * package is priced in. For a store top-up to be worth at least as much, the
 * uplift has to survive the commission:
 *
 *   net per credit = plannedPriceBaht / credits × (1 − commission)
 *
 * At the SMALL-BUSINESS rate (15%, which both stores apply below ~$1M/year —
 * automatic on Play, an annual OPT-IN on Apple) the live 1.30× uplift nets
 * ฿1.105 and clears. At the STANDARD rate (30%) the same 1.30× nets ฿0.91, i.e.
 * every store top-up would sell credits for less than they are worth. Breaking
 * even at 30% needs 1.43× — roughly ฿93 for 50 credits rather than ฿65.
 *
 * Both stores now charge the SAME ฿ per credit, so this is not a per-platform
 * risk: it is one rate assumption carrying the whole native business. Apple's
 * programme in particular is not automatic and must be re-accepted each year —
 * if it lapses, iOS top-ups start losing money silently, because nothing in the
 * purchase flow can tell what commission was taken.
 * `tests/config/storeCatalogue` asserts the 15% case and pins the 30% one.
 */
export const STORE_COMMISSION = {
  smallBusiness: 0.15,
  standard: 0.3,
} as const;

/**
 * Apple App Store products — CONFIRMED against App Store Connect on 2026-09-10.
 *
 * Apple's THB ladder turned out to contain every point Play was already using,
 * so the two tables are currently IDENTICAL. That is a fact about today's
 * prices, not a reason to merge them: Apple's ladder is fixed and Google's is
 * free-form, so the next repricing can easily force them apart. Keep the split.
 *
 * Flat 1.30 ฿/credit at every rung as of the 2026-09-10 update.
 */
export const IOS_STORE_PRODUCTS: readonly StoreProduct[] = [
  { productId: "com.rclipper.credits.50", credits: 50, plannedPriceBaht: 65, verified: true },
  { productId: "com.rclipper.credits.100", credits: 100, plannedPriceBaht: 130, verified: true },
  { productId: "com.rclipper.credits.200", credits: 200, plannedPriceBaht: 260, verified: true },
  { productId: "com.rclipper.credits.500", credits: 500, plannedPriceBaht: 650, verified: true },
  { productId: "com.rclipper.credits.1000", credits: 1000, plannedPriceBaht: 1300, verified: true },
  { productId: "com.rclipper.credits.2000", credits: 2000, plannedPriceBaht: 2600, verified: true },
] as const;

/**
 * Google Play products — CONFIRMED against Play Console on 2026-09-10.
 *
 * These are the real, live products and prices. Play has no tier ladder, so the
 * values are exactly as configured there. A flat 1.30 ฿/credit at every rung
 * since the 2026-09-10 update — the old 1.25 discount at 1,000 is gone, so the
 * margin no longer thins out exactly where the biggest purchases happen.
 *
 * The 2,000 rung was added so the 1,900-credit 6-month bundle is a single
 * transaction. The 3,500-credit annual bundle still takes two.
 */
export const ANDROID_STORE_PRODUCTS: readonly StoreProduct[] = [
  { productId: "com.rclipper.credits.50", credits: 50, plannedPriceBaht: 65, verified: true },
  { productId: "com.rclipper.credits.100", credits: 100, plannedPriceBaht: 130, verified: true },
  { productId: "com.rclipper.credits.200", credits: 200, plannedPriceBaht: 260, verified: true },
  { productId: "com.rclipper.credits.500", credits: 500, plannedPriceBaht: 650, verified: true },
  { productId: "com.rclipper.credits.1000", credits: 1000, plannedPriceBaht: 1300, verified: true },
  { productId: "com.rclipper.credits.2000", credits: 2000, plannedPriceBaht: 2600, verified: true },
] as const;

/** The two stores the native shells ship to. */
export type StorePlatform = "ios" | "android";

export function storeProductsFor(
  platform: StorePlatform
): readonly StoreProduct[] {
  return platform === "ios" ? IOS_STORE_PRODUCTS : ANDROID_STORE_PRODUCTS;
}

/**
 * Credits a verified purchase grants.
 *
 * The PLATFORM MUST come from the verified receipt, never from the client: it
 * selects which price table is authoritative, and trusting a client-supplied
 * platform would let a caller pick whichever table is more generous.
 */
export function creditsForStoreProduct(
  productId: string,
  platform: StorePlatform
): number | null {
  return (
    storeProductsFor(platform).find((p) => p.productId === productId)?.credits ??
    null
  );
}

/** Every row still carrying a guessed price point, by platform. */
export function unverifiedStoreProducts(): {
  platform: StorePlatform;
  productId: string;
}[] {
  const out: { platform: StorePlatform; productId: string }[] = [];
  for (const platform of ["ios", "android"] as const) {
    for (const p of storeProductsFor(platform)) {
      if (!p.verified) out.push({ platform, productId: p.productId });
    }
  }
  return out;
}

/**
 * Throw unless every store product has been reconciled with its console.
 *
 * Call this from a release check, not from a request path — the point is to
 * make an unverified catalogue impossible to ship, not to break the app for a
 * user mid-purchase. `MobileStorePurchaseService` still verifies the receipt
 * itself and grants from `credits`, which is correct whatever the price is.
 */
export function assertStoreCatalogueVerified(): void {
  const pending = unverifiedStoreProducts();
  if (pending.length === 0) return;
  throw new Error(
    "Store catalogue not reconciled with App Store Connect / Play Console: " +
      pending.map((p) => `${p.platform}:${p.productId}`).join(", ")
  );
}

/**
 * @deprecated Product ids are shared across stores today, so this still resolves
 * — but it cannot express a platform-specific credit yield. Pass the receipt's
 * platform to {@link creditsForStoreProduct} instead.
 */
export const MOBILE_STORE_PRODUCTS = IOS_STORE_PRODUCTS;
