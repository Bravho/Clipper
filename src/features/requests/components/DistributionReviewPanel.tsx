"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Platform, PLATFORM_LABELS, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { getPublishFieldConfig } from "@/config/publishFields";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";
import type { AppLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { isNativeMobile } from "@/lib/mobile/platform";
import { saveVideoToDevice } from "@/lib/mobile/nativeDownload";
import { areAllChannelVideosTransferred } from "@/lib/management/transferState";
import { ReportAiContent } from "@/features/requests/components/ReportAiContent";
import {
  CHANNEL_COPY_POLICIES,
  parseHashtagText,
  shapeChannelCopy,
  validateChannelCopy,
} from "@/lib/publishing/channelCopyPolicy";

interface Props {
  requestId: string;
  jobId: string;
  /** Per-channel auto-filled post copy + preview image, editable before posting. */
  initialDrafts: ChannelPublishingDraft[];
  /** The generated (subtitled) video per distribution channel, so each channel's
   *  own clip can be played + downloaded. */
  channelVideos?: {
    platform: string;
    label: string;
    ratio: string | null;
    url: string | null;
    assetId: string | null;
  }[];
  /** Header UI locale the drafts were rendered for on the server. */
  locale?: AppLocale;
  /** Background Travy render status: 'idle' | 'generating' | 'ready' | 'failed'. */
  travyVideoStatus?: string | null;
  /** Reason the Travy render failed (shown so it isn't an opaque error). */
  travyVideoError?: string | null;
  /** Travy (EN+ZH) clip URL once ready. */
  travyClipUrl?: string | null;
  /** Asset id of the Travy clip — for the gated download. */
  travyAssetId?: string | null;
  /** True when the download is still locked (unpaid) — gates every download button. */
  downloadLocked?: boolean;
  /** Price in credits (= ฿) to unlock all downloads for this request. */
  unlockPrice?: number;
  /**
   * True once the 7-day availability window has passed and the generated videos
   * have been purged from storage.
   */
  mediaExpired?: boolean;
  /** True when RClipper Management is available to this user (server-decided). */
  managementEnabled?: boolean;
  /**
   * Export asset id → Management content item id, for videos already transferred.
   * Drives each per-video button between "transfer" and "open in Management".
   */
  transferredByAssetId?: Record<string, string>;
}

/** Editable working copy of a channel draft (hashtags held as a raw string). */
interface DraftEdit {
  title: string;
  caption: string;
  hashtagsText: string;
}

function CopyIconButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
}) {
  const accessibleLabel = copied ? `${label}แล้ว` : label;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        copied
          ? "bg-emerald-50 text-emerald-600"
          : "text-blue-600 hover:bg-blue-50 hover:text-blue-700"
      }`}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
          <path
            d="m4.5 10.5 3.25 3.25L15.5 6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
          <rect
            x="6.5"
            y="6.5"
            width="9"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

function applyChannelPolicies(drafts: ChannelPublishingDraft[]): ChannelPublishingDraft[] {
  return drafts.map((draft) => {
    if (draft.status === "posted") return draft;
    const copy = shapeChannelCopy(draft.platform, {
      title: draft.title ?? "",
      caption: draft.caption ?? "",
      hashtags: draft.hashtags ?? [],
    });
    return {
      ...draft,
      title: copy.title ?? "",
      caption: copy.caption,
      hashtags: copy.hashtags,
    };
  });
}

export function DistributionReviewPanel({
  requestId,
  jobId,
  initialDrafts,
  channelVideos = [],
  locale,
  travyVideoStatus = null,
  travyVideoError = null,
  travyClipUrl = null,
  travyAssetId = null,
  downloadLocked = false,
  unlockPrice = 0,
  mediaExpired = false,
  managementEnabled = false,
  transferredByAssetId = {},
}: Props) {
  const router = useRouter();
  const { locale: headerLocale } = useI18n();
  const channelVideoByPlatform = useMemo(
    () => new Map(channelVideos.map((c) => [c.platform, c])),
    [channelVideos]
  );

  // ── Per-channel editable copy ──────────────────────────────────────────────
  const policyInitialDrafts = useMemo(
    () => applyChannelPolicies(initialDrafts),
    [initialDrafts]
  );
  const [drafts, setDrafts] = useState<ChannelPublishingDraft[]>(policyInitialDrafts);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>(() =>
    Object.fromEntries(
      policyInitialDrafts.map((d) => [
        d.platform,
        {
          title: d.title ?? "",
          caption: d.caption ?? "",
          hashtagsText: (d.hashtags ?? []).join(" "),
        },
      ])
    )
  );
  const draftsLocale = drafts[0]?.locale ?? locale ?? "th";
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Repair pending legacy drafts as soon as review opens. This keeps copy and
  // Management transfer safe without requiring another AI generation.
  useEffect(() => {
    const editableFields = (items: ChannelPublishingDraft[]) =>
      items.map(({ platform, title, caption, hashtags }) => ({
        platform,
        title,
        caption,
        hashtags,
      }));
    if (
      JSON.stringify(editableFields(initialDrafts)) ===
      JSON.stringify(editableFields(policyInitialDrafts))
    ) {
      return;
    }

    fetch(`/api/requests/${requestId}/publishing-drafts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        drafts: editableFields(policyInitialDrafts),
      }),
    }).catch(() => {
      /* display remains safely normalized even if the repair write fails */
    });
  }, [initialDrafts, jobId, policyInitialDrafts, requestId]);

  const syncEditsFromDrafts = useCallback((next: ChannelPublishingDraft[]) => {
    setDrafts(next);
    setEdits(
      Object.fromEntries(
        next.map((d) => [
          d.platform,
          {
            title: d.title ?? "",
            caption: d.caption ?? "",
            hashtagsText: (d.hashtags ?? []).join(" "),
          },
        ])
      )
    );
  }, []);

  // Persist edits (debounced) — no posting, just autosave of the copy.
  const scheduleSave = useCallback(
    (nextEdits: Record<string, DraftEdit>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const payload = drafts.map((d) => {
          const e = nextEdits[d.platform];
          return {
            platform: d.platform,
            title: e?.title ?? d.title ?? "",
            caption: e?.caption ?? d.caption ?? "",
            hashtags: e ? parseHashtagText(e.hashtagsText) : d.hashtags ?? [],
          };
        });
        if (
          payload.some(
            (draft) =>
              !validateChannelCopy(draft.platform, {
                title: draft.title,
                caption: draft.caption,
                hashtags: draft.hashtags,
              }).valid
          )
        ) {
          return;
        }
        fetch(`/api/requests/${requestId}/publishing-drafts`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, drafts: payload }),
        }).catch(() => {
          /* autosave is best-effort; edits remain in the UI regardless */
        });
      }, 800);
    },
    [drafts, jobId, requestId]
  );

  const updateEdit = (platform: string, patch: Partial<DraftEdit>) => {
    setEdits((prev) => {
      const next = { ...prev, [platform]: { ...prev[platform], ...patch } };
      scheduleSave(next);
      return next;
    });
  };

  // Regenerate copy when the header language differs from the drafts' language.
  const regenerate = useCallback(
    async (targetLocale: AppLocale) => {
      setRegenerating(true);
      try {
        const res = await fetch(
          `/api/requests/${requestId}/regenerate-publishing-drafts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, locale: targetLocale }),
          }
        );
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body.publishingDrafts)) {
          syncEditsFromDrafts(body.publishingDrafts as ChannelPublishingDraft[]);
        }
      } catch {
        /* leave the current copy in place on failure */
      } finally {
        setRegenerating(false);
      }
    },
    [jobId, requestId, syncEditsFromDrafts]
  );

  // Auto-regenerate on header-language switch (skip already-posted channels).
  useEffect(() => {
    if (mediaExpired) return;
    if (headerLocale === draftsLocale) return;
    if (regenerating) return;
    if (drafts.some((d) => d.status === "posted")) return;
    void regenerate(headerLocale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerLocale]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  // ── Gated download / paywall (unchanged behaviour) ─────────────────────────
  const [unlocking, setUnlocking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [retryingTravy, setRetryingTravy] = useState(false);
  const [travyRetryError, setTravyRetryError] = useState<string | null>(null);

  const handleUnlock = async () => {
    setUnlocking(true);
    setDownloadError(null);
    const returnTo = `/dashboard/requests/${requestId}`;
    router.push(
      `/dashboard/credits?unlockRequest=${encodeURIComponent(requestId)}&returnTo=${encodeURIComponent(returnTo)}`
    );
  };

  const handleDownload = async (assetId: string, channelName?: string) => {
    setDownloadingId(assetId);
    setDownloadError(null);
    try {
      const channelQuery = channelName ? `&channel=${encodeURIComponent(channelName)}` : "";
      const res = await fetch(
        `/api/requests/${requestId}/download?assetId=${assetId}${channelQuery}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ดาวน์โหลดไม่สำเร็จ");
      }
      const { url, downloadUrl, fileName } = (await res.json()) as {
        url: string;
        downloadUrl: string;
        fileName?: string;
      };
      if (isNativeMobile()) {
        await saveVideoToDevice(url, fileName ?? "rclipper-video.mp4");
      } else {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = fileName ?? "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setDownloadingId(null);
    }
  };

  const renderDownloadControl = ({
    assetId,
    ratio,
    labelSuffix,
    channelName,
  }: {
    assetId: string | null;
    ratio?: string | null;
    labelSuffix?: string;
    channelName?: string;
  }) => {
    if (!assetId) return null;
    const ratioTxt = ratio ? ` (${ratio})` : "";
    if (downloadLocked) {
      return (
        <button
          type="button"
          onClick={handleUnlock}
          disabled={unlocking}
          className="inline-flex items-center gap-1 rounded-md border border-blue-600 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {unlocking ? "กำลังปลดล็อก..." : `🔒 ปลดล็อกเพื่อดาวน์โหลด (฿${unlockPrice})`}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => handleDownload(assetId, channelName)}
        disabled={downloadingId === assetId}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
      >
        {downloadingId === assetId ? "กำลังเตรียมไฟล์..." : `ดาวน์โหลด${labelSuffix ?? "วิดีโอ"}${ratioTxt}`}
      </button>
    );
  };

  const handleRetryTravy = async () => {
    setRetryingTravy(true);
    setTravyRetryError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/retry-travy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "ไม่สามารถลองสร้างใหม่ได้");
      router.refresh();
    } catch (err) {
      setTravyRetryError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setRetryingTravy(false);
    }
  };

  // Channels this clip was produced for (excludes Travy/CDN).
  const channels =
    channelVideos.length > 0
      ? channelVideos.map((c) => ({ platform: c.platform, label: c.label }))
      : drafts.map((d) => ({
          platform: d.platform,
          label: PLATFORM_LABELS[d.platform as Platform] ?? d.platform,
        }));
  const draftByPlatform = new Map(drafts.map((d) => [d.platform, d]));

  // ── RClipper Management: per-video transfer (free, optional) ───────────────
  const [transferred, setTransferred] = useState<Record<string, string>>(
    transferredByAssetId
  );
  // Holds the asset id being transferred, or "all" during a transfer-all.
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const postTransfer = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/management/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "โอนวิดีโอไม่สำเร็จ");
    return data;
  };

  const transferVideo = async (assetId: string) => {
    setTransferringId(assetId);
    setTransferError(null);
    try {
      const data = await postTransfer({ sourceRequestId: requestId, videoAssetId: assetId });
      if (data.content?.id) {
        setTransferred((prev) => ({ ...prev, [assetId]: data.content.id }));
      }
      router.refresh();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setTransferringId(null);
    }
  };

  const transferAllVideos = async () => {
    setTransferringId("all");
    setTransferError(null);
    try {
      const data = await postTransfer({ sourceRequestId: requestId, all: true });
      if (Array.isArray(data.items)) {
        setTransferred((prev) => {
          const next = { ...prev };
          for (const it of data.items) {
            if (it.sourceAssetId && it.id) next[it.sourceAssetId] = it.id;
          }
          return next;
        });
      }
      router.refresh();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setTransferringId(null);
    }
  };

  const anyChannelVideo = channels.some(
    (ch) => channelVideoByPlatform.get(ch.platform)?.assetId
  );
  const allChannelVideosTransferred = areAllChannelVideosTransferred(
    channelVideos,
    transferred
  );
  // Transfer is hidden until the download is unlocked: a video that has not been
  // paid to download should not be movable into Management yet.
  const canTransfer = managementEnabled && !downloadLocked && !mediaExpired;

  return (
    <div className="mt-6 space-y-6">
      <Card className="border-blue-100 bg-blue-50/30">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-base font-semibold text-slate-900">
            {mediaExpired
              ? "วิดีโอหมดอายุการดาวน์โหลดแล้ว"
              : "วิดีโอของคุณพร้อมแล้ว — คัดลอกข้อความและดาวน์โหลดเพื่อโพสต์ได้เลย"}
          </h3>
          {!mediaExpired && (
            <span className="text-sm font-medium text-amber-700">
              (วิดีโอนี้จะถูกจัดเก็บเพียง 7 วัน)
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {mediaExpired
            ? "ไฟล์วิดีโอถูกจัดเก็บไว้ 7 วันหลังส่งมอบและถูกลบออกจากระบบแล้ว จึงไม่สามารถดาวน์โหลดได้อีก"
            : "เราเตรียมแคปชัน แฮชแท็ก และภาพตัวอย่างสำหรับแต่ละช่องทางไว้ให้แล้ว ปรับแก้ได้ตามต้องการ คัดลอกข้อความและดาวน์โหลดวิดีโอ (พร้อมภาพปก) ไปโพสต์บนช่องทางของคุณได้ทันที"}
        </p>

        {!mediaExpired && regenerating && (
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            กำลังปรับข้อความให้ตรงกับภาษาที่เลือก...
          </div>
        )}

        <div className="flex flex-col gap-4">
          {channels.map((ch) => {
            const cv = channelVideoByPlatform.get(ch.platform);
            const draft = draftByPlatform.get(ch.platform);
            const edit = edits[ch.platform];
            const cfg = getPublishFieldConfig(ch.platform);
            const limits = CHANNEL_COPY_POLICIES[ch.platform] ?? {};
            const previewUrl = draft?.previewImageUrl ?? null;
            const posted = draft?.status === "posted";

            const tags = parseHashtagText(edit?.hashtagsText ?? "");
            const validation = validateChannelCopy(ch.platform, {
              title: edit?.title ?? "",
              caption: edit?.caption ?? "",
              hashtags: tags,
            });
            const captionLen = validation.captionLength;
            const combinedLen = validation.combinedLength;

            return (
              <div
                key={ch.platform}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{ch.label}</span>
                  {cv?.ratio && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {cv.ratio}
                    </span>
                  )}
                </div>

                {mediaExpired ? (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    <span aria-hidden>🗑️</span>
                    <span>ไฟล์วิดีโอสำหรับช่องทางนี้ถูกลบแล้ว (จัดเก็บไว้ 7 วันหลังส่งมอบ)</span>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Left: preview image + video + downloads */}
                    <div className="space-y-2">
                      {previewUrl && (
                        <div>
                          <div className="flex justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={previewUrl}
                              alt={`ภาพตัวอย่างสำหรับ ${ch.label}`}
                              className="max-h-[180px] w-auto object-contain"
                            />
                          </div>
                          {!downloadLocked && (
                            <a
                              href={previewUrl}
                              download={`${ch.label}-cover.jpg`}
                              className="mt-1 inline-block text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              ดาวน์โหลดภาพปก
                            </a>
                          )}
                        </div>
                      )}
                      {cv?.url && (
                        <div>
                          <div className="flex max-h-[300px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                            <video
                              src={cv.url}
                              poster={previewUrl ?? undefined}
                              controls
                              preload="metadata"
                              className="max-h-[280px] w-auto rounded object-contain"
                            />
                          </div>
                          <div className="mt-2">
                            {renderDownloadControl({
                              assetId: cv.assetId,
                              ratio: cv.ratio,
                              channelName: ch.label,
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: editable, copy-ready post text */}
                    <div className="space-y-3">
                      {posted && draft?.url && (
                        <a
                          href={draft.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                        >
                          ✓ เผยแพร่แล้ว — ดูโพสต์
                        </a>
                      )}

                      {cfg.hasTitle && (
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-xs font-medium text-slate-600">ชื่อเรื่อง (Title)</label>
                            <button
                              type="button"
                              onClick={() => copy(`${ch.platform}-title`, edit?.title ?? "")}
                              className="text-[11px] font-medium text-blue-600 hover:underline"
                            >
                              {copiedKey === `${ch.platform}-title` ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                            </button>
                          </div>
                          <input
                            type="text"
                            value={edit?.title ?? ""}
                            disabled={posted}
                            onChange={(ev) => updateEdit(ch.platform, { title: ev.target.value })}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                          />
                          {limits.titleMaximum && (
                            <p className={`mt-0.5 text-right text-[11px] ${(edit?.title?.length ?? 0) > limits.titleMaximum ? "text-red-500" : "text-slate-400"}`}>
                              {edit?.title?.length ?? 0}/{limits.titleMaximum}
                            </p>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-600">{cfg.captionLabel}</label>
                          <CopyIconButton
                            copied={copiedKey === `${ch.platform}-caption`}
                            label="คัดลอกคำบรรยาย"
                            onClick={() => copy(`${ch.platform}-caption`, edit?.caption ?? "")}
                          />
                        </div>
                        <textarea
                          value={edit?.caption ?? ""}
                          disabled={posted}
                          rows={4}
                          onChange={(ev) => updateEdit(ch.platform, { caption: ev.target.value })}
                          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                        />
                        <p className="mt-0.5 flex justify-between text-[11px] text-slate-400">
                          {limits.combinedMaximum ? (
                            <span className={combinedLen > limits.combinedMaximum ? "text-red-500" : ""}>
                              แคปชัน + แฮชแท็ก {combinedLen}/{limits.combinedMaximum}
                            </span>
                          ) : (
                            <span className={limits.captionMaximum && captionLen > limits.captionMaximum ? "text-red-500" : ""}>
                              {captionLen}
                              {limits.captionMaximum ? `/${limits.captionMaximum}` : ""}
                            </span>
                          )}
                        </p>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-600">แฮชแท็ก (Hashtags)</label>
                          <CopyIconButton
                            copied={copiedKey === `${ch.platform}-tags`}
                            label="คัดลอกแฮชแท็ก"
                            onClick={() =>
                              copy(
                                `${ch.platform}-tags`,
                                tags.map((h) => `#${h}`).join(" ")
                              )
                            }
                          />
                        </div>
                        {tags.length > 0 && (
                          <div className="mb-1 flex flex-wrap gap-1">
                            {tags.map((h) => (
                              <span
                                key={h}
                                className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                              >
                                #{h}
                              </span>
                            ))}
                          </div>
                        )}
                        <input
                          type="text"
                          value={edit?.hashtagsText ?? ""}
                          disabled={posted}
                          placeholder="คั่นแฮชแท็กด้วยช่องว่าง"
                          onChange={(ev) => updateEdit(ch.platform, { hashtagsText: ev.target.value })}
                          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                        />
                      </div>

                      {/* Free, optional: keep THIS video in RClipper Management.
                          Hidden until the download is unlocked. */}
                      {canTransfer && cv && cv.assetId && (
                        transferred[cv.assetId] ? (
                          <a
                            href={`/dashboard/management/content/${transferred[cv.assetId]}`}
                            className="block rounded-md border border-emerald-500 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            อยู่ใน Channel Management แล้ว — เปิด →
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => transferVideo(cv.assetId as string)}
                            disabled={transferringId === cv.assetId}
                            className="w-full rounded-md border border-blue-600 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          >
                            {transferringId === cv.assetId
                              ? "กำลังโอน..."
                              : "นำวีดิโอเข้าสู่การบริหารช่องทางสื่อออนไลน์ (Channel Management)"}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* No auto-publishing from RClipper — the clip may be featured. */}
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  วิดีโอนี้อาจได้รับการคัดเลือกและนำไปเผยแพร่บนช่องทาง{" "}
                  <span className="font-medium text-slate-700">{ch.label}</span> ของ RClipper
                  โดยขึ้นอยู่กับดุลยพินิจของทีมงาน
                </p>
              </div>
            );
          })}
        </div>
        {downloadError && <p className="mt-3 text-xs text-red-600">{downloadError}</p>}

        {/* Move EVERY video into RClipper Management at once (free, optional).
            Hidden until the download is unlocked. */}
        {canTransfer && anyChannelVideo && (
          <div className="mt-5 border-t border-blue-100 pt-4">
            {!allChannelVideosTransferred && (
              <button
                type="button"
                onClick={transferAllVideos}
                disabled={transferringId === "all"}
                className="w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {transferringId === "all"
                  ? "กำลังโอนทั้งหมด..."
                  : "นำวีดิโอเข้าสู่การบริหารช่องทางสื่อออนไลน์ทั้งหมด (Channel Management)"}
              </button>
            )}
            {allChannelVideosTransferred && (
              <a
                href="/dashboard/management"
                className="block rounded-md border border-emerald-500 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                เปิด Channel Management เพื่อจัดการวิดีโอของคุณ →
              </a>
            )}
            {transferError && <p className="mt-2 text-xs text-red-600">{transferError}</p>}
          </div>
        )}

        <div className="mt-5 border-t border-blue-100 pt-4">
          <ReportAiContent requestId={requestId} />
        </div>
      </Card>

      {/* Background Travy (EN+ZH) render status */}
      {travyVideoStatus && travyVideoStatus !== "idle" && (
        <Card className="border-slate-100 bg-slate-50/60">
          <h3 className="mb-2 text-base font-semibold text-slate-900">
            วิดีโอสำหรับช่อง Travy (อังกฤษ + จีน)
          </h3>
          {mediaExpired && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
              <span aria-hidden>🗑️</span>
              <span>ไฟล์วิดีโอ Travy ถูกลบแล้ว (จัดเก็บไว้ 7 วันหลังส่งมอบ)</span>
            </div>
          )}
          {!mediaExpired && travyVideoStatus === "generating" && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
              ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้)
            </div>
          )}
          {!mediaExpired && travyVideoStatus === "ready" &&
            (travyClipUrl ? (
              <div className="space-y-3">
                <div className="flex max-h-[420px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                  <video src={travyClipUrl} controls className="max-h-[400px] w-auto rounded object-contain" />
                </div>
                {renderDownloadControl({
                  assetId: travyAssetId,
                  ratio: PLATFORM_ASPECT_RATIOS[Platform.TravyApp],
                  labelSuffix: "วิดีโอ Travy",
                  channelName: "Travy",
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">วิดีโอ Travy พร้อมแล้ว</p>
            ))}
          {!mediaExpired && travyVideoStatus === "failed" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-600">การสร้างวิดีโอ Travy ล้มเหลว</p>
              {travyVideoError && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
                  สาเหตุ: {travyVideoError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRetryTravy}
                  disabled={retryingTravy}
                  className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {retryingTravy ? "กำลังลองใหม่..." : "ลองสร้างวิดีโอ Travy อีกครั้ง"}
                </button>
                {travyRetryError && <span className="text-xs text-red-600">{travyRetryError}</span>}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
