"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Platform, PLATFORM_LABELS } from "@/domain/enums/Platform";
import { getPublishFieldConfig } from "@/config/publishFields";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";
import { PublishChannelButton } from "./PublishChannelButton";

interface Props {
  requestId: string;
  jobId: string;
  /** Auto-filled per-channel drafts (Gemini), editable before publishing. */
  initialDrafts: ChannelPublishingDraft[];
  /** The video the requester reviewed/approved in the previous step (primary ratio, captioned). */
  reviewedClipUrl?: string | null;
  /** Aspect ratio of the reviewed clip (primary channel's ratio), e.g. "9:16". */
  reviewedRatio?: string | null;
  /** Distribution channel labels this reviewed clip is published to (excludes Travy). */
  reviewedChannelLabels?: string[];
  /** The generated (subtitled) video per distribution channel, so each channel's
   *  own clip can be played + downloaded next to its publishing form. */
  channelVideos?: { platform: string; label: string; ratio: string | null; url: string | null }[];
  /** Background Travy render status: 'idle' | 'generating' | 'ready' | 'failed'. */
  tventVideoStatus?: string | null;
  /** Reason the Travy render failed (shown so it isn't an opaque error). */
  tventVideoError?: string | null;
  /** Travy (EN+ZH) clip URL once ready. */
  tventClipUrl?: string | null;
}

const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

/** Split a raw hashtag input into clean tags (no leading '#', no blanks). */
function parseHashtags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((h) => h.replace(/^#+/, "").trim())
    .filter(Boolean);
}

/** Per-channel UI state for publishing / moderation feedback. */
interface ChannelUiState {
  publishing?: boolean;
  /** Set when Gemini blocked the content — the channel can no longer be corrected/retried. */
  rejection?: { reason: string; violations: string[] } | null;
  /** Set when a technical publishing error occurred (not a moderation block). */
  error?: string | null;
}

export function DistributionReviewPanel({
  requestId,
  jobId,
  initialDrafts,
  reviewedClipUrl = null,
  reviewedRatio = null,
  reviewedChannelLabels = [],
  channelVideos = [],
  tventVideoStatus = null,
  tventVideoError = null,
  tventClipUrl = null,
}: Props) {
  const router = useRouter();
  const channelVideoByPlatform = new Map(channelVideos.map((c) => [c.platform, c]));
  const [retryingTvent, setRetryingTvent] = useState(false);
  const [tventRetryError, setTventRetryError] = useState<string | null>(null);

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
  const [drafts, setDrafts] = useState<ChannelPublishingDraft[]>(initialDrafts);
  const [ui, setUi] = useState<Record<string, ChannelUiState>>({});

  const updateDraft = (platform: string, patch: Partial<ChannelPublishingDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.platform === platform ? { ...d, ...patch } : d)));

  const setChannelUi = (platform: string, patch: ChannelUiState) =>
    setUi((prev) => ({ ...prev, [platform]: { ...prev[platform], ...patch } }));

  const handlePublishChannel = async (d: ChannelPublishingDraft) => {
    setChannelUi(d.platform, { publishing: true, rejection: null, error: null });
    try {
      const res = await fetch(`/api/requests/${requestId}/publish-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          platform: d.platform,
          draft: { title: d.title, caption: d.caption, hashtags: d.hashtags },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "ไม่สามารถเผยแพร่ได้");

      // Gemini blocked the content — show the reason; do NOT allow correction.
      if (body.approved === false) {
        setChannelUi(d.platform, {
          publishing: false,
          rejection: {
            reason:
              body.reason ?? "เนื้อหานี้ไม่ผ่านการตรวจสอบความเหมาะสม จึงไม่สามารถเผยแพร่ได้",
            violations: Array.isArray(body.violations) ? body.violations : [],
          },
          error: null,
        });
        return;
      }

      if (Array.isArray(body.publishingDrafts)) {
        setDrafts(body.publishingDrafts as ChannelPublishingDraft[]);
      }
      setChannelUi(d.platform, { publishing: false, rejection: null, error: null });
      if (body.currentStep === "complete") {
        router.refresh();
      }
    } catch (err) {
      setChannelUi(d.platform, {
        publishing: false,
        rejection: null,
        error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด",
      });
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {/* The video the requester approved in the previous step — shown here for
          reference before filling in each channel's publishing details. */}
      {reviewedClipUrl && (
        <Card className="border-slate-100">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-slate-900">วิดีโอที่คุณอนุมัติแล้ว</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              ช่องทางเผยแพร่:{" "}
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
            <a
              href={reviewedClipUrl}
              download={`approved_video${reviewedRatio ? `_${reviewedRatio.replace(":", "_")}` : ""}.mp4`}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
            >
              ดาวน์โหลดวิดีโอ{reviewedRatio ? ` (${reviewedRatio})` : ""}
            </a>
          </div>
        </Card>
      )}

      <Card className="border-blue-100 bg-blue-50/30">
        <h3 className="mb-2 text-base font-semibold text-slate-900">
          เนื้อหาอัตโนมัติสำหรับโพสตามช่องทางการเผยแพร่ที่เลือก
        </h3>
        <p className="mb-4 text-sm text-slate-500">
          ระบบสร้างหัวข้อ คำบรรยาย และแฮชแท็กสำหรับแต่ละช่องทางให้อัตโนมัติ ตรวจสอบและแก้ไขได้ตามต้องการ
          จากนั้นกดปุ่มเผยแพร่ของแต่ละช่องทาง ระบบจะให้ Gemini AI
          ตรวจสอบความเหมาะสมของเนื้อหาและภาพจากวิดีโอก่อนโพสต์ทุกครั้ง
        </p>

        <div className="flex flex-col gap-4">
          {drafts.map((d) => {
            const cfg = getPublishFieldConfig(d.platform);
            const label = PLATFORM_LABELS[d.platform as Platform] ?? d.platform;
            const state = ui[d.platform] ?? {};
            const isPosted = d.status === "posted";
            const isRejected = !!state.rejection;
            // Once blocked by moderation the channel is locked — no correction/retry.
            const locked = isPosted || isRejected;
            return (
              <div
                key={d.platform}
                className={`rounded-xl border p-4 ${
                  isPosted
                    ? "border-green-200 bg-green-50/50"
                    : isRejected
                      ? "border-red-200 bg-red-50/40"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  {isPosted && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✓ เผยแพร่แล้ว
                    </span>
                  )}
                  {isRejected && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      ไม่ผ่านการตรวจสอบ
                    </span>
                  )}
                </div>

                {/* This channel's generated (subtitled) video — play + download. */}
                {(() => {
                  const cv = channelVideoByPlatform.get(d.platform);
                  if (!cv?.url) return null;
                  return (
                    <div className="mb-3">
                      <div className="flex max-h-[360px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                        <video
                          src={cv.url}
                          controls
                          preload="metadata"
                          className="max-h-[340px] w-auto rounded object-contain"
                        />
                      </div>
                      <a
                        href={cv.url}
                        download={`${d.platform}_video${cv.ratio ? `_${cv.ratio.replace(":", "_")}` : ""}.mp4`}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        ดาวน์โหลดวิดีโอ{cv.ratio ? ` (${cv.ratio})` : ""}
                      </a>
                    </div>
                  );
                })()}

                {isPosted && d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    {d.url}
                  </a>
                ) : (
                  <div className="flex flex-col gap-3">
                    {cfg.hasTitle && (
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          หัวข้อ (Title)
                        </label>
                        <input
                          type="text"
                          value={d.title ?? ""}
                          onChange={(e) => updateDraft(d.platform, { title: e.target.value })}
                          disabled={state.publishing || locked}
                          className={inputCls}
                        />
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        {cfg.captionLabel}
                      </label>
                      <textarea
                        value={d.caption ?? ""}
                        onChange={(e) => updateDraft(d.platform, { caption: e.target.value })}
                        disabled={state.publishing || locked}
                        rows={3}
                        className={`${inputCls} resize-none`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        แฮชแท็ก (คั่นด้วยช่องว่าง ไม่ต้องใส่ #)
                      </label>
                      <input
                        type="text"
                        value={(d.hashtags ?? []).join(" ")}
                        onChange={(e) => updateDraft(d.platform, { hashtags: parseHashtags(e.target.value) })}
                        disabled={state.publishing || locked}
                        className={inputCls}
                      />
                    </div>

                    {/* Per-channel publish action */}
                    {!isRejected && (
                      <div className="pt-1">
                        <PublishChannelButton
                          channelLabel={label}
                          onClick={() => handlePublishChannel(d)}
                          loading={state.publishing}
                          disabled={state.publishing}
                        />
                      </div>
                    )}

                    {/* Moderation rejection — shown below the button; not correctable. */}
                    {isRejected && state.rejection && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-5a1 1 0 100 2 1 1 0 000-2z"
                              clipRule="evenodd"
                            />
                          </svg>
                          เนื้อหาไม่ผ่านการตรวจสอบโดย Gemini AI — ไม่สามารถเผยแพร่ช่องทางนี้ได้
                        </p>
                        <p className="mt-1 text-sm text-red-700">{state.rejection.reason}</p>
                        {state.rejection.violations.length > 0 && (
                          <p className="mt-1 text-xs text-red-600">
                            ประเภทที่ตรวจพบ: {state.rejection.violations.join(", ")}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Technical publishing error (retryable) */}
                    {state.error && (
                      <p className="text-xs text-red-600 break-words">สาเหตุ: {state.error}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
              ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้) คุณเผยแพร่ช่องทางอื่นได้เลยโดยไม่ต้องรอ
            </div>
          )}
          {tventVideoStatus === "ready" &&
            (tventClipUrl ? (
              <div className="space-y-3">
                <div className="flex max-h-[420px] justify-center overflow-hidden rounded-lg bg-slate-900 p-2">
                  <video src={tventClipUrl} controls className="max-h-[400px] w-auto rounded object-contain" />
                </div>
                <a
                  href={tventClipUrl}
                  download="final_tvent.mp4"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  ดาวน์โหลดวิดีโอ Travy
                </a>
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
