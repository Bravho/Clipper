"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import { storeProductsFor, type StorePlatform } from "@/config/mobilePurchases";
import { useI18n } from "@/i18n/client";

/**
 * The credit top-ups of ONE store, priced by that store — for the public
 * pricing page inside the app (/plans with an app user agent).
 *
 * The rows (product id → credits) come from `config/mobilePurchases.ts`, the
 * same catalogue the in-app purchase screen and the receipt verifier use. The
 * PRICE comes only from the store SDK at runtime (`priceString`: StoreKit /
 * Play Billing, already localised to the buyer's currency). That file's
 * `plannedPriceBaht` is an internal planning figure and is never rendered.
 *
 * When the store has not answered (still loading, billing unavailable, or the
 * page is not running inside the native shell — e.g. a test with an app user
 * agent) a row shows a dash and the note says the store shows the price before
 * payment. A dash is honest; an invented number is not.
 *
 * Read-only: nothing here can buy. Buying needs an account, so the page's
 * buttons go to sign-in / the signed-in store top-up (/dashboard/credits),
 * which runs the in-app purchase and verifies the receipt.
 */
export function StoreCreditPrices({ platform }: { platform: StorePlatform }) {
  const { t } = useI18n();
  const store = platform === "ios" ? "App Store" : "Google Play";
  const rows = storeProductsFor(platform);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    // Only the native shell has a store to ask, and only the store this page
    // was rendered for — never fall back to the other platform's catalogue.
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== platform) {
      setState("unavailable");
      return;
    }
    void NativePurchases.isBillingSupported()
      .then(({ isBillingSupported }) => {
        if (!isBillingSupported) throw new Error("Store billing is unavailable.");
        return NativePurchases.getProducts({
          productIdentifiers: rows.map((row) => row.productId),
          productType: PURCHASE_TYPE.INAPP,
        });
      })
      .then(({ products }) => {
        if (!active) return;
        const next: Record<string, string> = {};
        for (const product of products) {
          if (product.priceString) next[product.identifier] = product.priceString;
        }
        setPrices(next);
        setState(Object.keys(next).length > 0 ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyMissing = rows.some((row) => !prices[row.productId]);

  return (
    <div data-store-prices={platform} data-store-state={state}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.productId}
            data-product-id={row.productId}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-sm font-semibold text-slate-900">
              {t("mkt.plans.priceCredits", { price: row.credits.toLocaleString() })}
            </p>
            <p className="mt-1 text-base font-bold text-blue-700">
              {prices[row.productId] ?? "—"}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {state === "loading"
          ? t("mkt.plans.storeLoading", { store })
          : anyMissing
            ? t("mkt.plans.storePriceAtPurchase", { store })
            : t("mkt.plans.storePriceLocal", { store })}
      </p>
    </div>
  );
}
