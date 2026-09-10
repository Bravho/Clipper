"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";

/**
 * Confirm-then-confirm feedback for buying a package.
 *
 * Two small pieces, kept together because they are two halves of one moment:
 * the dialog that asks "really spend this?" and the toast that says "done".
 *
 * WHY A CONFIRM STEP. A package purchase is an irreversible debit of real money
 * against a balance the user topped up with real money, and the previous flow
 * spent it on a single click of a button labelled only with a number. There is
 * no refund path in the product, so the cost of an accidental click is the whole
 * package price. One modal is cheap by comparison.
 *
 * The dialog is deliberately NOT a native `confirm()`: those are unstyled,
 * unlocalised, and blocked by some in-app browsers, and this flow has to read
 * correctly in Thai.
 */

interface ConfirmProps {
  open: boolean;
  /** Package name, already localised. */
  packageName: string;
  priceCredits: number;
  balanceCredits: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPurchaseDialog({
  open,
  packageName,
  priceCredits,
  balanceCredits,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const { t } = useI18n();

  // Escape closes, and the page behind must not scroll while the dialog is up —
  // on phones a scrolling background under a modal reads as a broken page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const after = balanceCredits - priceCredits;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-purchase-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-purchase-title"
          className="text-base font-semibold text-slate-900"
        >
          {t("pricing.confirm.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("pricing.confirm.body", { name: packageName })}
        </p>

        <dl className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-500">{t("pricing.confirm.price")}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {priceCredits.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-500">{t("pricing.confirm.after")}</dt>
            <dd className="font-medium tabular-nums text-slate-700">
              {after.toLocaleString()}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-slate-400">{t("pricing.confirm.note")}</p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("pricing.confirm.cancel")}
          </Button>
          <Button onClick={onConfirm} loading={busy} disabled={busy}>
            {t("pricing.confirm.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ToastProps {
  /** The localised success line, or null when nothing is showing. */
  message: string | null;
  onDismiss: () => void;
  /** Milliseconds on screen. Three seconds, per the product decision. */
  durationMs?: number;
}

/**
 * The green "bought it" toast.
 *
 * It auto-dismisses after three seconds. The timer is keyed on the message, so
 * two purchases in quick succession restart the clock rather than the second
 * toast inheriting the remainder of the first one's.
 */
export function PurchaseSuccessToast({
  message,
  onDismiss,
  durationMs = 3000,
}: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6"
      // Announced politely: it confirms something the user just did, so it
      // should not interrupt whatever a screen reader is already saying.
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-md items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
        <span aria-hidden="true">✓</span>
        <span className="min-w-0">{message}</span>
      </div>
    </div>
  );
}
