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
import { ReportAiContent } from "@/features/requests/components/ReportAiContent";

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
  tventVideoStatus?: string | null;
  /** Reason the Travy render failed (shown so it isn't an opaque error). */
  tventVideoError?: string | null;
  /** Travy (EN+ZH) clip URL once ready. */
  tventClipUrl?: string | null;
  /** Asset id of the Travy clip — for the gated download. */
  tventAssetId?: string | null;
  /** True when the download is still locked (unpaid) — gates every download button. */
  downloadLocked?: boolean;
  /** Price in credits (= ฿) to unlock all downloads for this request. */
  unlockPrice?: number;
  /**
   * True once the 7-day availability window has passed and the generated videos
   * have been purged from storage.
   */
  mediaExpired?: boolean;
}

/** Soft character guidance per channel (over-limit is warned, not blocked). */
const CHANNEL_LIMITS: Record<string, { title?: number; combined?: number; caption?: number }> = {
  [Platform.TikTok]: { combined: 150 },
  [Platform.YouTube]: { title: 100, caption: 5000 },
  [Platform.Instagram]: { caption: 2200 },
  [Platform.Facebook]: { caption: 5000 },
};

/** Editable working copy of a channel draft (hashtags held as a raw string). */
interface DraftEdit {
  title: string;
  caption: string;
  hashtagsText: string;
}

function parseHashtags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#+/, "").trim())
        .filter(Boolean)
    )
  );
}

export function DistributionReviewPanel({
  requestId,
  jobId,
  initialDrafts,
  channelVideos = [],
  locale,
  tventVideoStatus = null,
  tventVideoError = null,
  tventClipUrl = null,
  tventAssetId = null,
  downloadLocked = false,
  unlockPrice = 0,
  mediaExpired = false,
}: Props) {
  const router = useRouter();
  const { locale: headerLocale } = useI18n();
  const channelVideoByPlatform = useMemo(
    () => new Map(channelVideos.map((c) => [c.platform, c])),
    [channelVideos]
  );

  // ── Per-channel editable copy ──────────────────────────────────────────────
  const [drafts, setDrafts] = useState<ChannelPublishingDraft[]>(initialDrafts);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>(() =>
    Object.fromEntries(
      initialDrafts.map((d) => [
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
            hashtags: e ? parseHashtags(e.hashtagsText) : d.hashtags ?? [],
          };
        });
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
  const [retryingTvent, setRetryingTvent] = useState(false);
  const [tventRetryError, setTventRetryError] = useState<string | null>(null);

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
      const { url, fileName } = (await res.json()) as { url: string; fileName?: string };
      if (isNativeMobile()) {
        await saveVideoToDevice(url, fileName ?? "rclipper-video.mp4");
      } else {
        const a = document.createElement("a");
        a.href = url;
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

  const handleRetryTvent = async () => {
    setRetryingTvent(true);
    setTventRetryError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/retry-tvent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "ไม่สามารถลองสร้างใหม่ได้");
      router.refresh();
    } catch (err) {
      setTventRetryError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setRetryingTvent(false);
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

  const composedFor = (platform: string): string => {
    const e = edits[platform];
    const tags = parseHashtags(e?.hashtagsText ?? "")
      .map((h) => `#${h}`)
      .join(" ");
    return [e?.caption ?? "", tags].filter(Boolean).join("\n\n");
  };

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
            const limits = CHANNEL_LIMITS[ch.platform] ?? {};
            const previewUrl = draft?.previewImageUrl ?? null;
            const posted = draft?.status === "posted";

            const captionLen = edit?.caption?.length ?? 0;
            const tags = parseHashtags(edit?.hashtagsText ?? "");
            const combinedLen =
              captionLen + (tags.length ? tags.map((h) => `#${h}`).join(" ").length + 2 : 0);

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
                          {limits.title && (
                            <p className={`mt-0.5 text-right text-[11px] ${(edit?.title?.length ?? 0) > limits.title ? "text-red-500" : "text-slate-400"}`}>
                              {edit?.title?.length ?? 0}/{limits.title}
                            </p>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-600">{cfg.captionLabel}</label>
                          <button
                            type="button"
                            onClick={() => copy(`${ch.platform}-caption`, edit?.caption ?? "")}
                            className="text-[11px] font-medium text-blue-600 hover:underline"
                          >
                            {copiedKey === `${ch.platform}-caption` ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                          </button>
                        </div>
                        <textarea
                          value={edit?.caption ?? ""}
                          disabled={posted}
                          rows={4}
                          onChange={(ev) => updateEdit(ch.platform, { caption: ev.target.value })}
                          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                        />
                        <p className="mt-0.5 flex justify-between text-[11px] text-slate-400">
                          {limits.combined ? (
                            <span className={combinedLen > limits.combined ? "text-red-500" : ""}>
                              แคปชัน + แฮชแท็ก {combinedLen}/{limits.combined}
                            </span>
                          ) : (
                            <span className={limits.caption && captionLen > limits.caption ? "text-red-500" : ""}>
                              {captionLen}
                              {limits.caption ? `/${limits.caption}` : ""}
                            </span>
                          )}
                        </p>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-600">แฮชแท็ก (Hashtags)</label>
                          <button
                            type="button"
                            onClick={() =>
                              copy(
                                `${ch.platform}-tags`,
                                tags.map((h) => `#${h}`).join(" ")
                              )
                            }
                            className="text-[11px] font-medium text-blue-600 hover:underline"
                          >
                            {copiedKey === `${ch.platform}-tags` ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                          </button>
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

                      {!posted && (
                        <button
                          type="button"
                          onClick={() => copy(`${ch.platform}-all`, composedFor(ch.platform))}
                          className="w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          {copiedKey === `${ch.platform}-all`
                            ? "คัดลอกแคปชัน + แฮชแท็กแล้ว ✓"
                            : "คัดลอกแคปชัน + แฮชแท็ก"}
                        </button>
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

        <div className="mt-5 border-t border-blue-100 pt-4">
          <ReportAiContent requestId={requestId} />
        </div>
      </Card>

      {/* Background Travy (EN+ZH) render status */}
      {tventVideoStatus && tventVideoStatus !== "idle" && (
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
          {!mediaExpired && tventVideoStatus === "generating" && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
              ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้)
            </div>
          )}
          {!mediaExpired && tventVideoStatus === "ready" &&
            (tventClipUrl ? (
              <div className="space-y-3">
                <div className="flex max-h-[420px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                  <video src={tventClipUrl} controls className="max-h-[400px] w-auto rounded object-contain" />
                </div>
                {renderDownloadControl({
                  assetId: tventAssetId,
                  ratio: PLATFORM_ASPECT_RATIOS[Platform.TventApp],
                  labelSuffix: "วิดีโอ Travy",
                  channelName: "Travy",
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">วิดีโอ Travy พร้อมแล้ว</p>
            ))}
          {!mediaExpired && tventVideoStatus === "failed" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-600">การสร้างวิดีโอ Travy ล้มเหลว</p>
              {tventVideoError && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
                  สาเหตุ: {tventVideoError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRetryTvent}
                  disabled={retryingTvent}
                  className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {retryingTvent ? "กำลังลองใหม่..." : "ลองสร้างวิดีโอ Travy อีกครั้ง"}
                </button>
                {tventRetryError && <span className="text-xs text-red-600">{tventRetryError}</span>}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
