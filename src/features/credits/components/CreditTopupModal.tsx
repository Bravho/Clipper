"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { CreditPurchaseOptions } from "@/features/credits/components/CreditPurchaseOptions";

interface CreditTopupModalProps {
  open: boolean;
  currentBalance: number;
  minimumTopupCredits?: number;
  packageName?: string;
  onClose: () => void;
}

export function CreditTopupModal({
  open,
  currentBalance,
  minimumTopupCredits,
  packageName,
  onClose,
}: CreditTopupModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 px-4 py-6 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-topup-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2
              id="credit-topup-title"
              className="text-lg font-semibold text-slate-900"
            >
              Purchase more credits
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Add credits here, then return to Publishing Packages to use them.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close credit purchase window"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            ×
          </button>
        </div>

        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-4 sm:p-6">
          {minimumTopupCredits && minimumTopupCredits > 0 && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Add at least{" "}
              <span className="font-semibold">
                {minimumTopupCredits.toLocaleString()} credit
                {minimumTopupCredits === 1 ? "" : "s"}
              </span>
              {packageName ? ` to use the ${packageName} package.` : "."}
            </div>
          )}

          <CreditPurchaseOptions
            currentBalance={currentBalance}
            unlockPrice={0}
            minimumTopupCredits={minimumTopupCredits}
          />
        </div>

        <div className="border-t border-slate-200 bg-white px-5 py-4 text-right sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            ← Back to Publishing Packages
          </Button>
        </div>
      </div>
    </div>
  );
}
