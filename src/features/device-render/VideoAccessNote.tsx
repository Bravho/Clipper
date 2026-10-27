"use client";

import Link from "next/link";
import React, { useState } from "react";

import { VIDEO_LIFETIME_DAYS } from "@/config/retention";
import { VIDEO_DOWNLOAD_UNLOCK } from "@/config/requestLimits";
import { ROUTES } from "@/config/routes";
import type { VideoAccessView } from "@/services/VideoAccessService";
import { useStudioLocale, useStudioT } from "./studioI18n";
import { usePricingHref } from "./usePricingHref";

const DAY_MS = 86_400_000;

/** Days from now until `iso`, rounded up: 1 during the last 24 hours. */
export function daysLeft(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS));
}

/**
 * Under every finished video in the studio: until when it is available, or
 * why it cannot leave the app yet (Tho, 2026-10-12).
 *
 *   * unlocked     — "Available until 11 Nov · 30 days left" (amber on the
 *                    last 3 days, red on the last day)
 *   * free/locked  — "Free video — watch it here. Buy a package by 11 Nov…"
 *                    with a link to the packages
 *   * expired      — "This video expired on 11 Nov and has been deleted."
 *
 * Renders nothing when the server sent no access (an older server).
 */
export function VideoAccessNote({
  access,
  requestId,
  onUnlocked,
}: {
  access: VideoAccessView | null | undefined;
  requestId?: string;
  onUnlocked?: () => void | Promise<void>;
}) {
  const t = useStudioT();
  const locale = useStudioLocale();
  const pricingHref = usePricingHref();
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErrorKind, setUnlockErrorKind] = useState<"insufficient" | "expired" | "generic" | null>(null);
  const [unlockRequiredCredits, setUnlockRequiredCredits] = useState<number>(VIDEO_DOWNLOAD_UNLOCK.priceCredits);
  const [unlockDone, setUnlockDone] = useState(false);

  const handleUnlock = async () => {
    if (!requestId || unlocking || unlockDone) return;
    setUnlocking(true);
    setUnlockErrorKind(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/download-unlock`, { method: "POST" });
      if (res.ok) {
        await onUnlocked?.();
        setUnlockDone(true);
      } else {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (body.code === "insufficient_credits") {
          setUnlockRequiredCredits(Number(body.requiredCredits ?? VIDEO_DOWNLOAD_UNLOCK.priceCredits));
          setUnlockErrorKind("insufficient");
        } else if (body.code === "request_expired") {
          setUnlockErrorKind("expired");
        } else {
          setUnlockErrorKind("generic");
        }
      }
    } catch {
      setUnlockErrorKind("generic");
    } finally {
      setUnlocking(false);
    }
  };
  if (!access) return null;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "th" ? "th-TH" : locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  if (access.downloadBlock === "expired" && access.expiresAt) {
    return (
      <p className="studio-note studio-note-danger" role="status" style={{ marginTop: 8 }}>
        {t("studio.access.expired", { date: formatDate(access.expiresAt) })}
      </p>
    );
  }

  if (access.downloadBlock === "package_required") {
    return (
      <div className="studio-note studio-note-warning" role="status" style={{ marginTop: 8 }}>
        <p style={{ margin: 0 }}>
          <strong>{t("studio.access.lockedTitle")}</strong>{" "}
          {access.expiresAt
            ? t("studio.access.lockedBody", {
                date: formatDate(access.expiresAt),
                days: VIDEO_LIFETIME_DAYS,
              })
            : t("studio.access.lockedBodyNoDate", { days: VIDEO_LIFETIME_DAYS })}
        </p>
        {unlockDone ? (
          <p style={{ marginTop: 10, margin: 0 }}>
            {t("studio.access.unlockDone", { days: VIDEO_DOWNLOAD_UNLOCK.days })}
          </p>
        ) : (
          <>
            <Link
              href={pricingHref}
              className="studio-button studio-button-primary"
              style={{ marginTop: 10 }}
            >
              {t("studio.access.seePackages")}
            </Link>
            {requestId && access.canPurchaseUnlock === true && (
              <button
                onClick={handleUnlock}
                disabled={unlocking}
                className="studio-button"
                style={{ marginTop: 8 }}
              >
                {t("studio.access.unlockButton", { price: VIDEO_DOWNLOAD_UNLOCK.priceCredits })}
              </button>
            )}
            {unlockErrorKind === "insufficient" && (
              <div style={{ marginTop: 6, fontSize: "0.85em", color: "var(--studio-danger, #b91c1c)" }}>
                <p style={{ margin: 0 }}>
                  {t("studio.access.unlockInsufficient", { required: String(unlockRequiredCredits) })}
                </p>
                <Link href={ROUTES.CREDITS} className="studio-button" style={{ marginTop: 6, display: "inline-block" }}>
                  {t("studio.quota.topup")}
                </Link>
              </div>
            )}
            {unlockErrorKind === "expired" && (
              <p style={{ marginTop: 6, color: "var(--studio-danger, #b91c1c)", fontSize: "0.85em" }}>
                {t("studio.access.unlockExpired")}
              </p>
            )}
            {unlockErrorKind === "generic" && (
              <div style={{ marginTop: 6, color: "var(--studio-danger, #b91c1c)", fontSize: "0.85em" }}>
                {t("studio.access.unlockError")}
                <button type="button" className="studio-button" disabled={unlocking} onClick={() => void handleUnlock()}>
                  {t("studio.graphics.tryAgain")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (!access.expiresAt) return null;
  const left = daysLeft(access.expiresAt);
  if (left <= 1) {
    return (
      <p className="studio-note studio-note-danger" role="status" style={{ marginTop: 8 }}>
        {t("studio.access.lastDay", { date: formatDate(access.expiresAt) })}
      </p>
    );
  }
  return (
    <p
      className={left <= 3 ? "studio-note studio-note-warning" : "studio-shot-meta"}
      style={{ marginTop: 8 }}
    >
      {t("studio.access.availableUntil", { date: formatDate(access.expiresAt), count: left })}
    </p>
  );
}
