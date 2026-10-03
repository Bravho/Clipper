"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ROUTES } from "@/config/routes";
import { useI18n } from "@/i18n/client";

/** One finished video of the request, as the transfer page lists it. */
export interface TransferVideo {
  /** The export asset id — what `POST /api/management/transfers` takes. */
  assetId: string;
  ratio: string;
  /** The channels this shape serves, e.g. "TikTok, Instagram Reels". */
  channels: string;
  /** Its Channel Management item, when it is already there. */
  contentId: string | null;
}

type RowState = "waiting" | "sending" | "done" | "failed";

interface Row extends TransferVideo {
  state: RowState;
  error: string | null;
}

/** Seconds on the "all sent" screen before Channel Management opens by itself. */
const OPEN_AFTER_SECONDS = 2;

/** Where the library opens: the new videos highlighted, the first in view. */
export function managementArrivalPath(contentIds: string[]): string {
  if (contentIds.length === 0) return ROUTES.MANAGEMENT;
  const query = new URLSearchParams({ arrived: contentIds.join(",") });
  return `${ROUTES.MANAGEMENT}?${query.toString()}#management-video-${contentIds[0]}`;
}

/**
 * The studio → Channel Management hand-over, as it happens.
 *
 * Each video is sent on its own call, so each row can say where it is and a
 * failure costs only that video (with its own Try again). The call is free and
 * idempotent, so a reload or a second visit just marks the sent ones done.
 * When everything is across, the library opens with the new videos highlighted;
 * the person can also open it at once, or go back to the studio.
 */
export function StudioTransferScreen({
  requestId,
  title,
  videos,
}: {
  requestId: string;
  title: string;
  videos: TransferVideo[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    videos.map((video) => ({
      ...video,
      state: video.contentId ? "done" : "waiting",
      error: null,
    }))
  );
  const [countdown, setCountdown] = useState<number | null>(null);
  const started = useRef(false);
  // Set once the countdown has run or the person chose a way out themselves.
  const autoOpenSettled = useRef(false);

  const patch = useCallback(
    (assetId: string, change: Partial<Row>) =>
      setRows((current) =>
        current.map((row) => (row.assetId === assetId ? { ...row, ...change } : row))
      ),
    []
  );

  const sendOne = useCallback(
    async (assetId: string): Promise<boolean> => {
      patch(assetId, { state: "sending", error: null });
      try {
        const response = await fetch("/api/management/transfers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceRequestId: requestId, videoAssetId: assetId }),
        });
        const body = (await response.json().catch(() => null)) as {
          content?: { id: string };
          error?: string;
        } | null;
        if (!response.ok || !body?.content?.id) {
          throw new Error(body?.error ?? t("mgmt.transfer.failed"));
        }
        patch(assetId, { state: "done", contentId: body.content.id });
        return true;
      } catch (failure) {
        patch(assetId, {
          state: "failed",
          error: failure instanceof Error ? failure.message : t("mgmt.transfer.failed"),
        });
        return false;
      }
    },
    [patch, requestId, t]
  );

  const sendAll = useCallback(
    async (targets: string[]) => {
      for (const assetId of targets) {
        // One at a time, in the list's order, so the rows fill top to bottom.
        await sendOne(assetId);
      }
    },
    [sendOne]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const waiting = rows.filter((row) => row.state !== "done").map((row) => row.assetId);
    if (waiting.length > 0) void sendAll(waiting);
  }, [rows, sendAll]);

  const doneIds = rows
    .filter((row) => row.state === "done" && row.contentId)
    .map((row) => row.contentId as string);
  const arrivalPath = managementArrivalPath(doneIds);

  const allDone = rows.length > 0 && rows.every((row) => row.state === "done");

  // Everything is across: count down, then open Channel Management.
  useEffect(() => {
    if (!allDone || autoOpenSettled.current) return;
    autoOpenSettled.current = true;
    setCountdown(OPEN_AFTER_SECONDS);
  }, [allDone]);

  // Open Channel Management by itself once everything is across.
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      router.replace(arrivalPath);
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => (value ?? 1) - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [arrivalPath, countdown, router]);

  const total = rows.length;
  const done = rows.filter((row) => row.state === "done").length;
  const failed = rows.filter((row) => row.state === "failed");
  const working = rows.some((row) => row.state === "sending" || row.state === "waiting");
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const studioPath = `${ROUTES.STUDIO}?request=${encodeURIComponent(requestId)}`;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("mgmt.transfer.eyebrow")}
      </p>
      <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
        {working
          ? t("mgmt.transfer.sendingTitle")
          : failed.length > 0
            ? t("mgmt.transfer.partTitle")
            : t("mgmt.transfer.doneTitle")}
      </h1>
      {title && <p className="mt-1 truncate text-sm text-slate-500">{title}</p>}

      {total === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {t("mgmt.transfer.none")}
        </div>
      ) : (
        <>
          <div
            className="mt-6 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t("mgmt.transfer.progress", { done, total })}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-600" aria-live="polite">
            {t("mgmt.transfer.progress", { done, total })}
          </p>

          <ul className="mt-5 space-y-2">
            {rows.map((row) => (
              <li
                key={row.assetId}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <StateIcon state={row.state} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {row.ratio}
                    {row.channels && (
                      <span className="ml-2 font-normal text-slate-500">{row.channels}</span>
                    )}
                  </p>
                  <p
                    className={
                      row.state === "failed" ? "text-xs text-red-600" : "text-xs text-slate-500"
                    }
                  >
                    {row.state === "failed"
                      ? row.error ?? t("mgmt.transfer.failed")
                      : t(`mgmt.transfer.state.${row.state}`)}
                  </p>
                </div>
                {row.state === "failed" && (
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => void sendAll([row.assetId])}
                  >
                    {t("mgmt.transfer.retry")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!working && failed.length === 0 && countdown != null && countdown > 0 && (
        <p className="mt-5 text-sm text-slate-600" aria-live="polite">
          {t("mgmt.transfer.opening", { seconds: countdown })}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Link
          href={arrivalPath}
          className={
            "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold " +
            (working
              ? "pointer-events-none bg-slate-200 text-slate-500"
              : "bg-blue-600 text-white hover:bg-blue-700")
          }
          aria-disabled={working}
          tabIndex={working ? -1 : undefined}
          onClick={() => {
            autoOpenSettled.current = true;
            setCountdown(null);
          }}
        >
          {t("mgmt.transfer.open")}
        </Link>
        <Link
          href={studioPath}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => {
            autoOpenSettled.current = true;
            setCountdown(null);
          }}
        >
          {t("mgmt.transfer.back")}
        </Link>
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: RowState }) {
  if (state === "done") {
    return (
      <span
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700"
        aria-hidden
      >
        ✓
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-red-100 text-sm font-bold text-red-700"
        aria-hidden
      >
        !
      </span>
    );
  }
  return (
    <span
      className={
        "h-7 w-7 flex-shrink-0 rounded-full border-[3px] border-slate-200 " +
        (state === "sending" ? "animate-spin border-t-blue-600 motion-reduce:animate-none" : "")
      }
      aria-hidden
    />
  );
}
