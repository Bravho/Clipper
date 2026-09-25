"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { ROUTES } from "@/config/routes";
import { REQUESTS_PER_PAID_MONTH, VIDEO_PACKAGES } from "@/config/videoPackages";
import { useStudioT } from "./studioI18n";
import type { StudioT } from "./studioText";

/**
 * The account's video allowance, as the studio needs it.
 *
 * The web request form shows the quota before anything is picked; the studio
 * did not, so an account with no videos left filled in a brief, picked its
 * media, pressed Submit and got "Failed to submit request." (the server's
 * QuotaExhaustedError, unmapped). Now the page hands the quota in, the studio
 * says so up front with the way out — buy a package, or top up credits to buy
 * one — and the same popup appears if Submit is refused for it anyway.
 */
export interface StudioQuota {
  tier: "free" | "paid";
  remaining: number;
  total: number;
  /** ISO date the allowance renews (free: the next slot opens). */
  renewsAt: string | null;
  canSubmit: boolean;
}

/** The cheapest package, quoted wherever the studio invites an upgrade. */
const ENTRY_PRICE = VIDEO_PACKAGES.reduce(
  (cheapest, entry) => Math.min(cheapest, entry.priceCredits),
  Number.POSITIVE_INFINITY
);

function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function exhaustedBody(t: StudioT, renewsAt: string | null): string {
  const date = formatDay(renewsAt);
  const values = { paidTotal: REQUESTS_PER_PAID_MONTH, price: ENTRY_PRICE };
  return date
    ? t("studio.quota.body", { ...values, date })
    : t("studio.quota.bodyNoDate", values);
}

/** The two ways out: buy a package, or top up credits to buy one. */
function QuotaActions({ onLeave }: { onLeave?: () => void }) {
  const t = useStudioT();
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <Link
        href={ROUTES.PRICING}
        className="studio-button studio-button-primary"
        onClick={onLeave}
      >
        {t("studio.quota.packages")}
      </Link>
      <Link href={ROUTES.CREDITS} className="studio-button studio-button-ghost" onClick={onLeave}>
        {t("studio.quota.topup")}
      </Link>
    </div>
  );
}

/**
 * One line under Submit while videos are left; the full notice, with the buy
 * and top-up buttons, once none are.
 */
export function QuotaStatus({ quota }: { quota: StudioQuota | null }) {
  const t = useStudioT();
  if (!quota) return null;
  if (quota.canSubmit) {
    return (
      <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
        {t(quota.tier === "paid" ? "studio.quota.leftPaid" : "studio.quota.leftFree", {
          remaining: quota.remaining,
          total: quota.total,
        })}
      </p>
    );
  }
  return (
    <div className="studio-note studio-note-warning" role="status">
      <strong>{t("studio.quota.title")}</strong>
      <p style={{ margin: "6px 0 0" }}>{exhaustedBody(t, quota.renewsAt)}</p>
      <QuotaActions />
    </div>
  );
}

/**
 * The popup: shown when Submit is pressed with nothing left, or when the
 * server refuses the submission for the quota after all.
 */
export function QuotaDialog({
  open,
  renewsAt,
  onClose,
}: {
  open: boolean;
  renewsAt: string | null;
  onClose: () => void;
}) {
  const t = useStudioT();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="studio-dialog-backdrop" onClick={onClose}>
      <div
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-quota-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="studio-quota-title" className="studio-panel-title" style={{ marginTop: 0 }}>
          {t("studio.quota.title")}
        </h2>
        <p className="studio-panel-hint" style={{ marginBottom: 0 }}>
          {exhaustedBody(t, renewsAt)}
        </p>
        <p className="studio-counter" style={{ textAlign: "left", margin: "10px 0 0" }}>
          {t("studio.quota.mediaNote")}
        </p>
        <QuotaActions onLeave={onClose} />
        <button
          ref={closeRef}
          type="button"
          className="studio-button studio-button-ghost"
          style={{ marginTop: 8, border: 0 }}
          onClick={onClose}
        >
          {t("studio.quota.later")}
        </button>
      </div>
    </div>
  );
}
