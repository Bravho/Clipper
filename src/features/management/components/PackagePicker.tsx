"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CreditTopupModal } from "@/features/credits/components/CreditTopupModal";

export interface PackageOption {
  code: string;
  name: string;
  description: string;
  productType: "single_video" | "access_pass";
  durationMonths: number | null;
  uploadAllowance: number | null;
  accessWindowDays: number | null;
  priceCredits: number;
  fullPriceCredits: number;
}

interface PackagePickerProps {
  products: PackageOption[];
  balanceCredits: number;
  returnTo: string;
}

/**
 * The package picker.
 *
 * Every package is a ONE-TIME purchase paid in credits — no renewal, no
 * subscription. The entry bundle grants consumable upload tokens; a pass grants
 * unlimited publishing for a window. Checkout is idempotent, so a double-click
 * cannot debit twice.
 */
export function PackagePicker({
  products,
  balanceCredits,
  returnTo,
}: PackagePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function activateWithCredits(product: PackageOption) {
    const missingCredits = Math.max(0, product.priceCredits - balanceCredits);
    if (missingCredits > 0) {
      setError(null);
      setTopup({
        minimumCredits: missingCredits,
        packageName: product.name,
      });
      return;
    }

    setBusy(product.code);
    setError(null);
    try {
      const res = await fetch("/api/management/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: product.code,
          idempotencyToken: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (res.status === 402 && data.needTopup) {
        setTopup({
          minimumCredits: Math.max(
            1,
            data.requiredCredits - data.balanceCredits
          ),
          packageName: product.name,
        });
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Credits could not be applied. Please try again.");
        return;
      }
      router.replace(returnTo);
    } catch {
      setError("Credits could not be applied. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Available credit balance
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {balanceCredits.toLocaleString()} credits
          </p>
        </div>
        <p className="max-w-md text-sm text-blue-900">
          Activating a package consumes credits from this balance immediately.
          It does not start a separate payment.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((p) => {
          const discounted = p.fullPriceCredits > p.priceCredits;
          const missingCredits = Math.max(0, p.priceCredits - balanceCredits);
          const terms =
            p.productType === "single_video"
              ? `${p.uploadAllowance ?? 4} publishing uploads · use within ${p.accessWindowDays ?? 30} days`
              : `Unlimited publishing · ${p.durationMonths} months`;
          return (
            <Card key={p.code} className="flex flex-col" padding="md">
              <p className="text-sm font-semibold text-slate-900">{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">{p.description}</p>
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                {terms}
              </p>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Credit cost
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xl font-bold text-slate-900">
                  {p.priceCredits.toLocaleString()} credits
                </span>
                {discounted && (
                  <span className="text-sm text-slate-400 line-through">
                    {p.fullPriceCredits.toLocaleString()} credits
                  </span>
                )}
                {discounted && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Launch offer
                  </span>
                )}
              </div>
              {missingCredits > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Add {missingCredits.toLocaleString()} more credit
                  {missingCredits === 1 ? "" : "s"} to use this package.
                </p>
              )}
              <div className="mt-auto pt-4">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => activateWithCredits(p)}
                  loading={busy === p.code}
                  disabled={busy !== null}
                >
                  {missingCredits > 0
                    ? `Top up to use ${p.priceCredits.toLocaleString()} credits`
                    : `Use ${p.priceCredits.toLocaleString()} credits`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold text-slate-900">Need more credits?</p>
          <p className="mt-1 text-sm text-slate-500">
            Add credits without leaving this page, then return here to activate
            your package.
          </p>
        </div>
        <Button
          type="button"
          className="w-full flex-shrink-0 sm:w-auto"
          onClick={() => setTopup({})}
        >
          + Purchase more credits
        </Button>
      </Card>

      <CreditTopupModal
        open={topup !== null}
        currentBalance={balanceCredits}
        minimumTopupCredits={topup?.minimumCredits}
        packageName={topup?.packageName}
        onClose={closeTopup}
      />
    </div>
  );
}
