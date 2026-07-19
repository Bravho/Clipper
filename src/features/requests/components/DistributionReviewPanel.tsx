"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Platform, PLATFORM_LABELS, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";

interface Props {
  requestId: string;
  jobId: string;
  /** Per-channel drafts — used only to know which channels this clip was made for. */
  initialDrafts: ChannelPublishingDraft[];
  /** The video the requester reviewed/approved in the previous step (primary ratio, captioned). */
  reviewedClipUrl?: string | null;
  /** Aspect ratio of the reviewed clip (primary channel's ratio), e.g. "9:16". */
  reviewedRatio?: string | null;
  /** Distribution channel labels this reviewed clip is formatted for (excludes Travy). */
  reviewedChannelLabels?: string[];
  /** Asset id of the reviewed (primary, captioned) clip — for the gated download. */
  reviewedClipAssetId?: string | null;
  /** The generated (subtitled) video per distribution channel, so each channel's
   *  own clip can be played + downloaded. */
  channelVideos?: {
    platform: string;
    label: string;
    ratio: string | null;
    url: string | null;
    assetId: string | null;
  }[];
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
}

export function DistributionReviewPanel({
  requestId,
  jobId,
  initialDrafts,
  reviewedClipUrl = null,
  reviewedRatio = null,
  reviewedChannelLabels = [],
  reviewedClipAssetId = null,
  channelVideos = [],
  tventVideoStatus = null,
  tventVideoError = null,
  tventClipUrl = null,
  tventAssetId = null,
  downloadLocked = false,
  unlockPrice = 0,
}: Props) {
  const router = useRouter();
  const channelVideoByPlatform = new Map(channelVideos.map((c) => [c.platform, c]));
  const [retryingTvent, setRetryingTvent] = useState(false);
  const [tventRetryError, setTventRetryError] = useState<string | null>(null);

  // Gated download / paywall: every channel's download button unlocks (pays) when
  // locked, or fetches a short-lived presigned URL from /download when unlocked.
  const [unlocking, setUnlocking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Finish action — closes out the request (marks Delivered/Complete). RClipper
  // does not post the clip to the requester's channels; the requester downloads
  // and posts it themselves.
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const handleUnlock = async () => {
    setUnlocking(true);
    setDownloadError(null);
    const returnTo = `/dashboard/requests/${requestId}`;
    router.push(
      `/dashboard/credits?unlockRequest=${encodeURIComponent(requestId)}&returnTo=${encodeURIComponent(returnTo)}`
    );
  };

  const handleDownload = async (assetId: string) => {
    setDownloadingId(assetId);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/download?assetId=${assetId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ดาวน์โหลดไม่สำเร็จ");
      }
      const { url } = await res.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/confirm-publishing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "ไม่สามารถปิดงานได้");
      router.refresh();
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setFinishing(false);
    }
  };

  /** Lock-aware download control for one clip (unlock CTA when locked). */
  const renderDownloadControl = ({
    assetId,
    ratio,
    labelSuffix,
  }: {
    assetId: string | null;
    ratio?: string | null;
    labelSuffix?: string;
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
        onClick={() => handleDownload(assetId)}
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

  // Channels this clip was produced for (excludes Travy/CDN — those are handled
  // separately). Prefer channelVideos; fall back to the draft platforms.
  const channels =
    channelVideos.length > 0
      ? channelVideos.map((c) => ({ platform: c.platform, label: c.label }))
      : initialDrafts.map((d) => ({
          platform: d.platform,
          label: PLATFORM_LABELS[d.platform as Platform] ?? d.platform,
        }));

  return (
    <div className="mt-6 space-y-6">
      {/* The video the requester approved in the previous step. */}
      {reviewedClipUrl && (
        <Card className="border-slate-100">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-slate-900">วิดีโอที่คุณอนุมัติแล้ว</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              จัดรูปแบบสำหรับ:{" "}
              <span className="font-medium text-slate-700">
                {reviewedChannelLabels.length > 0 ? reviewedChannelLabels.join(", ") : "—"}
              </span>
              {reviewedRatio ? (
                <>
                  {" "}
                  · อัตราส่วน{" "}
                  <span className="font-medium text-slate-700">{reviewedRatio}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex max-h-[420px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
            <video
              src={reviewedClipUrl}
              controls
              className="max-h-[400px] w-auto rounded object-contain"
            />
          </div>
          <div className="mt-2">
            {renderDownloadControl({ assetId: reviewedClipAssetId, ratio: reviewedRatio })}
          </div>
          {downloadError && (
            <p className="mt-1 text-xs text-red-600">{downloadError}</p>
          )}
        </Card>
      )}

      <Card className="border-blue-100 bg-blue-50/30">
        <h3 className="mb-2 text-base font-semibold text-slate-900">
          วิดีโอของคุณพร้อมแล้ว — ดาวน์โหลดเพื่อโพสต์ได้เลย
        </h3>
        <p className="mb-4 text-sm text-slate-500">
          เราจัดรูปแบบวิดีโอในอัตราส่วนที่เหมาะกับแต่ละช่องทางให้เรียบร้อยแล้ว
          ดาวน์โหลดไฟล์แล้วนำไปโพสต์บนช่องทางของคุณเองได้ทันที
        </p>

        <div className="flex flex-col gap-4">
          {channels.map((ch) => {
            const cv = channelVideoByPlatform.get(ch.platform);
            return (
              <div
                key={ch.platform}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{ch.label}</span>
                </div>

                {/* This channel's generated (subtitled) video — play + download. */}
                {cv?.url && (
                  <div className="mb-3">
                    <div className="flex max-h-[360px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                      <video
                        src={cv.url}
                        controls
                        preload="metadata"
                        className="max-h-[340px] w-auto rounded object-contain"
                      />
                    </div>
                    <div className="mt-2">
                      {renderDownloadControl({ assetId: cv.assetId, ratio: cv.ratio })}
                    </div>
                  </div>
                )}

                {/* Note: no auto-publishing from RClipper — the clip may be featured. */}
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  วิดีโอนี้อาจได้รับการคัดเลือกและนำไปเผยแพร่บนช่องทาง{" "}
                  <span className="font-medium text-slate-700">{ch.label}</span> ของ RClipper
                  โดยขึ้นอยู่กับดุลยพินิจของทีมงาน
                </p>
              </div>
            );
          })}
        </div>

        {/* Finish — closes out the request. */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-blue-100 pt-4">
          <button
            type="button"
            onClick={handleFinish}
            disabled={finishing}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {finishing ? "กำลังปิดงาน..." : "เสร็จสิ้นและปิดงาน"}
          </button>
          {finishError && <span className="text-xs text-red-600">{finishError}</span>}
        </div>
      </Card>

      {/* Background Travy (EN+ZH) render status */}
      {tventVideoStatus && tventVideoStatus !== "idle" && (
        <Card className="border-slate-100 bg-slate-50/60">
          <h3 className="mb-2 text-base font-semibold text-slate-900">
            วิดีโอสำหรับช่อง Travy (อังกฤษ + จีน)
          </h3>
          {tventVideoStatus === "generating" && (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
              ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้)
            </div>
          )}
          {tventVideoStatus === "ready" &&
            (tventClipUrl ? (
              <div className="space-y-3">
                <div className="flex max-h-[420px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                  <video src={tventClipUrl} controls className="max-h-[400px] w-auto rounded object-contain" />
                </div>
                {renderDownloadControl({
                  assetId: tventAssetId,
                  // Travy is always rendered at its own fixed ratio (16:9),
                  // not the reviewed/primary ratio.
                  ratio: PLATFORM_ASPECT_RATIOS[Platform.TventApp],
                  labelSuffix: "วิดีโอ Travy",
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">วิดีโอ Travy พร้อมแล้ว</p>
            ))}
          {tventVideoStatus === "failed" && (
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
