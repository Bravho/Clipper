"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  VIDEO_PACKAGES,
  REQUESTS_PER_PAID_MONTH,
  creditsPerMonth,
} from "@/config/videoPackages";
import type { VideoProductCode } from "@/domain/enums/VideoProductCode";
import { useI18n } from "@/i18n/client";
import { ROUTES } from "@/config/routes";
import {
  ConfirmPurchaseDialog,
  PurchaseSuccessToast,
} from "@/features/pricing/components/PurchaseFeedback";

interface Props {
  /** Credits available to spend, for the "not enough" state. */
  balanceCredits: number;
  /** When the user's paid allowance currently ends, if any. */
  activeUntil?: string | null;
}

/** A real UUID, with a fallback for browsers without `crypto.randomUUID`. */
function newToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The video package picker.
 *
 * Buying is a wallet debit against the server-side catalogue: the client sends a
 * product CODE and nothing else, so no price shown here can influence what is
 * charged. If the balance is short we send the user to top up rather than
 * failing — the 402 the API returns says the same thing.
 *
 * THE IDEMPOTENCY TOKEN MUST BE A UUID. It becomes the purchase id, and the
 * purchase id is written to `credit_transactions.reference_id`, a UUID column.
 * This used to send `${mountToken}-${code}`, which Postgres rejected outright and
 * turned every checkout into a 500. One fresh UUID is minted when the confirm
 * dialog opens and held until that attempt succeeds, so a retry after a network
 * error replays onto the same purchase while a deliberate second purchase (to
 * stack another month) correctly gets a new one.
 */
/**
 * Only same-site paths the app actually sends here are honoured, so the
 * parameter cannot bounce a buyer to another site.
 */
function safeReturnPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (
    !value.startsWith("/studio") &&
    !value.startsWith("/device-render-lab") &&
    !value.startsWith("/dashboard/")
  ) {
    return null;
  }
  return value;
}

export function VideoPackagePicker({ balanceCredits, activeUntil }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams?.get("returnTo") ?? null);
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    code: VideoProductCode;
    name: string;
    price: number;
    token: string;
  } | null>(null);

  const cheapestPerMonth = Math.min(...VIDEO_PACKAGES.map(creditsPerMonth));
  const dismissToast = useCallback(() => setToast(null), []);

  const ask = (code: VideoProductCode, name: string, price: number) => {
    setError(null);
    if (balanceCredits < price) {
      router.push(`${ROUTES.CREDITS}?returnTo=${encodeURIComponent(ROUTES.PRICING)}`);
      return;
    }
    setPending({ code, name, price, token: newToken() });
  };

  const buy = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/video-packages/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: pending.code,
          idempotencyToken: pending.token,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setPending(null);
        router.push(`${ROUTES.CREDITS}?returnTo=${encodeURIComponent(ROUTES.PRICING)}`);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? t("pricing.buyFailed"));

      setPending(null);
      setToast(t("pricing.buySuccess", { name: pending.name }));
      // Refresh so the balance, the entitlement summary and the purchase
      // history below all reflect the purchase that just completed.
      router.refresh();
      // Came here from somewhere that needs the package (the phone studio's
      // "none left" notice): go back once the toast has been seen. That page
      // re-reads the quota when it mounts, so its warning is gone on arrival.
      if (returnTo) {
        window.setTimeout(() => router.push(returnTo), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pricing.buyFailed"));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-slate-900">
        {t("pricing.videoHeading")}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("pricing.videoSubheading", { paidTotal: REQUESTS_PER_PAID_MONTH })}
      </p>

      {activeUntil && (
        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {t("pricing.activeUntil", { date: activeUntil })}
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {VIDEO_PACKAGES.map((pkg) => {
          const perMonth = creditsPerMonth(pkg);
          const isBest = perMonth === cheapestPerMonth && pkg.months > 1;
          const name = t(pkg.nameKey as never);
          return (
            <Card
              key={pkg.code}
              className={isBest ? "border-blue-300 ring-1 ring-blue-200" : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">{name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t(pkg.descriptionKey as never, {
                      paidTotal: REQUESTS_PER_PAID_MONTH,
                      months: pkg.months,
                    })}
                  </p>
                </div>
                {isBest && (
                  <span className="flex-shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {t("pricing.bestValue")}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">
                    {pkg.priceCredits.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("pricing.creditsPerMonth", {
                      perMonth: Math.round(perMonth),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => ask(pkg.code, name, pkg.priceCredits)}
                >
                  {balanceCredits < pkg.priceCredits
                    ? t("pricing.topUpFirst")
                    : t("pricing.buy")}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">{t("pricing.videoFootnote")}</p>

      <ConfirmPurchaseDialog
        open={pending !== null}
        packageName={pending?.name ?? ""}
        priceCredits={pending?.price ?? 0}
        balanceCredits={balanceCredits}
        busy={busy}
        onConfirm={() => void buy()}
        onCancel={() => setPending(null)}
      />
      <PurchaseSuccessToast message={toast} onDismiss={dismissToast} />
    </section>
  );
}
