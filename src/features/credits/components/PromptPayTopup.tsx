"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TOPUP_BUNDLES } from "@/config/credits";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";

/** What a bundle covers, by its credit amount (the config labels are Thai-only). */
const BUNDLE_TAG: Record<number, MessageKey> = {
  190: "topup.tag.starterMonth",
  350: "topup.tag.proMonth",
  3500: "topup.tag.proYear",
};

type Bundle = (typeof TOPUP_BUNDLES)[number];
type PaymentMethod = "promptpay" | "card";

interface TopupResult {
  intentId: string;
  referenceNo: string;
  amountBaht: number;
  creditsToAdd: number;
  qrImageDataUrl?: string;
  checkoutUrl?: string;
  /** False when Stripe runs in test mode — the QR is a simulation, unscannable by bank apps. */
  livemode?: boolean;
  hostedInstructionsUrl?: string;
}

interface Props {
  returnTo?: string;
  minimumTopupCredits?: number;
}

export function PromptPayTopup({ returnTo, minimumTopupCredits }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [method, setMethod] = useState<PaymentMethod>("promptpay");
  const [selected, setSelected] = useState<Bundle>(
    minimumTopupCredits
      ? TOPUP_BUNDLES.find((b) => b.credits >= minimumTopupCredits) ??
          TOPUP_BUNDLES[TOPUP_BUNDLES.length - 1]
      : TOPUP_BUNDLES.find((b) => "popular" in b && b.popular) ?? TOPUP_BUNDLES[0]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TopupResult | null>(null);
  const [paid, setPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const safeReturnTo =
    returnTo?.startsWith("/dashboard/") ? returnTo : undefined;

  const startPolling = (intentId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const res = await fetch(`/api/credits/topup/${intentId}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { status } = await res.json();
        if (status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setPaid(true);
          router.refresh();
          if (safeReturnTo) router.push(safeReturnTo);
        } else if (status === "expired" || status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(t("topup.expired"));
          setIntent(null);
        }
      } catch {
        // A failed poll is transient; the next tick retries.
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 3000);
  };

  useEffect(() => {
    const returnedIntent = searchParams.get("topupIntent");
    if (returnedIntent) startPolling(returnedIntent);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // The return intent is intentionally read once on page entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTopup = async () => {
    setLoading(true);
    setError(null);
    setPaid(false);
    try {
      const query = searchParams.toString();
      const returnPath = `${pathname}${query ? `?${query}` : ""}`;
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountBaht: selected.baht,
          paymentMethod: method,
          returnPath,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("topup.startFailed"));
      const topup = data as TopupResult;
      if (method === "card") {
        if (!topup.checkoutUrl) throw new Error(t("topup.noCheckout"));
        window.location.assign(topup.checkoutUrl);
        return;
      }
      setIntent(topup);
      startPolling(topup.intentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.errorRetry"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">{t("topup.title")}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {t("topup.subtitle")}
      </p>

      {paid ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {t("topup.paid")}
        </div>
      ) : intent?.qrImageDataUrl ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          {/* Stripe test mode: the QR encodes a simulation URL, NOT a real
              PromptPay payload — bank apps cannot scan it. Explain, and offer
              the hosted page to authorise a simulated payment instead. */}
          {intent.livemode === false && (
            <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left">
              <p className="text-sm font-semibold text-amber-800">
                {t("topup.testMode")}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {t("topup.testModeBody")}
              </p>
              {intent.hostedInstructionsUrl && (
                <a
                  href={intent.hostedInstructionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  {t("topup.openSimulation")}
                </a>
              )}
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={intent.qrImageDataUrl}
            alt={t("topup.qrAlt")}
            className="h-56 w-56 rounded-lg border border-slate-200"
          />
          <p className="text-sm font-medium text-slate-800">
            {t("topup.payFor", { baht: intent.amountBaht, credits: intent.creditsToAdd })}
          </p>
          <p className="text-xs text-slate-500">
            {t("topup.scanNow", { ref: intent.referenceNo })}
          </p>
          <button
            className="text-xs text-slate-500 underline"
            onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setIntent(null);
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <>
          <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{t("topup.chooseMethod")}</legend>
            {([
              ["promptpay", "PromptPay QR", t("topup.promptpayHint")],
              ["card", t("topup.card"), t("topup.cardHint")],
            ] as const).map(([value, label, description]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
                  method === value ? "border-blue-600 bg-blue-50" : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TOPUP_BUNDLES.map((bundle) => (
              <button
                key={bundle.baht}
                onClick={() => setSelected(bundle)}
                className={`rounded-lg border p-3 text-left transition ${
                  bundle.baht === selected.baht
                    ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  ฿{bundle.baht}
                </span>
                <span className="block text-xs text-slate-500">
                  {t("dashboard.credits", { count: bundle.credits })}
                  {BUNDLE_TAG[bundle.credits] ? ` · ${t(BUNDLE_TAG[bundle.credits])}` : ""}
                </span>
                {"popular" in bundle && bundle.popular && (
                  <span className="mt-1 block text-[10px] font-medium text-blue-600">
                    {t("topup.popular")}
                  </span>
                )}
              </button>
            ))}
          </div>

          {searchParams.get("card") === "cancelled" && !error && (
            <p className="mb-3 text-sm text-amber-700">{t("topup.cardCancelled")}</p>
          )}
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <Button onClick={startTopup} loading={loading} className="w-full">
            {method === "promptpay"
              ? t("topup.makeQr", { baht: selected.baht })
              : t("topup.goCard", { baht: selected.baht })}
          </Button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {t("topup.oneOff")}
          </p>
        </>
      )}
    </Card>
  );
}
