"use client";

import Link from "next/link";

import { ROUTES } from "@/config/routes";
import { VIDEO_LIFETIME_DAYS } from "@/config/retention";
import type { VideoAccessView } from "@/services/VideoAccessService";
import { useStudioLocale, useStudioT } from "./studioI18n";

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
export function VideoAccessNote({ access }: { access: VideoAccessView | null | undefined }) {
  const t = useStudioT();
  const locale = useStudioLocale();
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
        <Link
          href={ROUTES.PRICING}
          className="studio-button studio-button-primary"
          style={{ marginTop: 10, display: "inline-block" }}
        >
          {t("studio.access.seePackages")}
        </Link>
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
