"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CreditTopupModal } from "@/features/credits/components/CreditTopupModal";
import {
  ConfirmPurchaseDialog,
  PurchaseSuccessToast,
} from "@/features/pricing/components/PurchaseFeedback";
import { useI18n } from "@/i18n/client";

export interface PackageOption {
  code: string;
  /** Localised by the caller — see `managementPackageCopy`. */
  name: string;
  description: string;
  /** Localised one-line "what you get" strip. */
  terms: string;
  productType: "single_video" | "access_pass";
  durationMonths: number | null;
  uploadAllowance: number | null;
  accessWindowDays: number | null;
  /**
   * Bundles only: months of video-generation allowance this package grants
   * alongside publishing. null/undefined for a publishing-only package.
   */
  videoMonths?: number | null;
  /** Optional flag shown top-right of the card, e.g. a saving. */
  badge?: string | null;
  priceCredits: number;
  fullPriceCredits: number;
}

interface PackagePickerProps {
  products: PackageOption[];
  balanceCredits: number;
  returnTo: string;
  /**
   * Whether to render the balance banner and the "need more credits?" card.
   *
   * The pricing page already shows a balance card of its own and renders this
   * picker more than once (bundles and publishing-only), so repeating that
   * chrome per section would say the same thing three times. Defaults to true so
   * the standalone Management page is unchanged.
   */
  chrome?: boolean;
}

/**
 * The package picker.
 *
 * Every package is a ONE-TIME purchase paid in credits — no renewal, no
 * subscription. The entry bundle grants consumable upload tokens; a pass grants
 * unlimited publishing for a window; a bundle grants a pass plus a run of video
 * months. Checkout is idempotent, so a retry cannot debit twice.
 *
 * ALL COPY IS LOCALISED. Product names, descriptions and terms arrive already
 * translated from `managementPackageCopy`, and this component's own chrome comes
 * from the i18n catalogue. It used to be hardcoded English, which left the whole
 * pricing page in English however the header language was set.
 *
 * Spending is confirmed before it happens and acknowledged after: a debit here
 * is real money with no refund path, and the only signal it had worked was the
 * page quietly re-rendering.
 */
export function PackagePicker({
  products,
  balanceCredits,
  returnTo,
  chrome = true,
}: PackagePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    product: PackageOption;
    token: string;
  } | null>(null);
  const [topup, setTopup] = useState<{
    minimumCredits?: number;
    packageName?: string;
  } | null>(null);

  useEffect(() => {
    if (searchParams.has("topupIntent") || searchParams.has("card")) {
      setTopup({});
    }
  }, [searchParams]);

  const closeTopup = useCallback(() => {
    setTopup(null);

    if (searchParams.has("topupIntent") || searchParams.has("card")) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("topupIntent");
      nextParams.delete("card");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const dismissToast = useCallback(() => setToast(null), []);

  /** Step one: short balance goes to top-up, otherwise ask for confirmation. */
  function ask(product: PackageOption) {
    const missingCredits = Math.max(0, product.priceCredits - balanceCredits);
    if (missingCredits > 0) {
      setError(null);
      setTopup({ minimumCredits: missingCredits, packageName: product.name });
      return;
    }
    setError(null);
    // One token per confirmed attempt: a retry after a failed request replays
    // onto the same purchase, a deliberate repurchase gets a new one.
    setPending({ product, token: crypto.randomUUID() });
  }

  async function activateWithCredits() {
    if (!pending) return;
    const { product, token } = pending;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/management/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: product.code, idempotencyToken: token }),
      });
      const data = await res.json();
      if (res.status === 402 && data.needTopup) {
        setPending(null);
        setTopup({
          minimumCredits: Math.max(1, data.requiredCredits - data.balanceCredits),
          packageName: product.name,
        });
        return;
      }
      if (!res.ok) {
        setPending(null);
        setError(data.error ?? t("pricing.buyFailed"));
        return;
      }
      setPending(null);
      setToast(t("pricing.buySuccess", { name: product.name }));
      // Stay on the page so the toast is seen and the entitlement summary
      // refreshes in place; the old flow navigated away immediately.
      if (returnTo === pathname) router.refresh();
      else router.replace(returnTo);
    } catch {
      setPending(null);
      setError(t("pricing.buyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {chrome && (
        <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              {t("pricing.picker.balanceLabel")}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {t("pricing.picker.credits", { count: balanceCredits.toLocaleString() })}
            </p>
          </div>
          <p className="max-w-md text-sm text-blue-900">
            {t("pricing.picker.balanceHint")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((p) => {
          const discounted = p.fullPriceCredits > p.priceCredits;
          const missingCredits = Math.max(0, p.priceCredits - balanceCredits);
          return (
            <Card
              key={p.code}
              className={
                p.videoMonths
                  ? "flex flex-col border-blue-300 ring-1 ring-blue-200"
                  : "flex flex-col"
              }
              padding="md"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                {p.badge && (
                  <span className="flex-shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {p.badge}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">{p.description}</p>
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                {p.terms}
              </p>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("pricing.picker.cost")}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xl font-bold text-slate-900">
                  {t("pricing.picker.credits", {
                    count: p.priceCredits.toLocaleString(),
                  })}
                </span>
                {discounted && (
                  <span className="text-sm text-slate-400 line-through">
                    {t("pricing.picker.credits", {
                      count: p.fullPriceCredits.toLocaleString(),
                    })}
                  </span>
                )}
                {discounted && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {t("pricing.picker.launchOffer")}
                  </span>
                )}
              </div>
              {missingCredits > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  {t("pricing.picker.shortfall", {
                    missing: missingCredits.toLocaleString(),
                  })}
                </p>
              )}
              <div className="mt-auto pt-4">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => ask(p)}
                  disabled={busy}
                >
                  {missingCredits > 0
                    ? t("pricing.topUpFirst")
                    : t("pricing.picker.use", {
                        count: p.priceCredits.toLocaleString(),
                      })}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {chrome && (
        <Card className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-slate-900">
              {t("pricing.picker.needMore")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t("pricing.picker.needMoreHint")}
            </p>
          </div>
          <Button
            type="button"
            className="w-full flex-shrink-0 sm:w-auto"
            onClick={() => setTopup({})}
          >
            {t("pricing.picker.addCredits")}
          </Button>
        </Card>
      )}

      <ConfirmPurchaseDialog
        open={pending !== null}
        packageName={pending?.product.name ?? ""}
        priceCredits={pending?.product.priceCredits ?? 0}
        balanceCredits={balanceCredits}
        busy={busy}
        onConfirm={() => void activateWithCredits()}
        onCancel={() => setPending(null)}
      />
      <PurchaseSuccessToast message={toast} onDismiss={dismissToast} />

      <CreditTopupModal
        open={topup !== null}
        minimumTopupCredits={topup?.minimumCredits}
        packageName={topup?.packageName}
        onClose={closeTopup}
      />
    </div>
  );
}
