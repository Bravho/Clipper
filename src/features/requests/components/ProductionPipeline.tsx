"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREDITS_CONFIG } from "@/config/credits";
import {
  buildPipelinePhaseDisplay,
  getPipelineStepPresentation,
} from "@/config/pipelinePresentation";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { RenderProgressDetail } from "@/domain/models/VideoGenerationJob";

/** Fallbacks for display only — duration/channels no longer affect the price. */
const DEFAULT_DURATION_SECONDS = 15;
const DEFAULT_CHANNELS = 2;

interface Props {
  currentStep?: VideoGenerationStep;
  failedAtStep?: VideoGenerationStep | null;
  durationSeconds?: number;
  totalChannels?: number;
  videoGenStatus?: "submitted" | "processing" | null;
  videoGenLastPolledAt?: Date | null;
  /**
   * Per-step render progress (0–100). Null = not measurable (AI-API steps never
   * report %) — the spinner alone is shown. Only rendered on the ACTIVE phase.
   */
  renderProgress?: number | null;
  renderProgressDetail?: RenderProgressDetail | null;
  /** Request id — needed to POST the stalled-step retry. */
  requestId?: string;
  /** True when the job has been stuck on this processing step past its threshold. */
  stalled?: boolean;
  /**
   * The requester took the step-5 express lane. The remaining approval gates are
   * then shown as work in progress rather than as "waiting for you", and a note
   * explains that nothing more is needed until the download step.
   */
  autoApproveRemaining?: boolean;
}

export function ProductionPipeline({
  currentStep,
  failedAtStep,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  totalChannels = DEFAULT_CHANNELS,
  videoGenStatus,
  videoGenLastPolledAt,
  renderProgress = null,
  renderProgressDetail = null,
  requestId,
  stalled = false,
  autoApproveRemaining = false,
}: Props) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleStalledRetry() {
    if (!requestId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/retry-stalled`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRetryError(data?.error ?? "ลองใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง");
        setRetrying(false);
        return;
      }
      router.refresh();
    } catch {
      setRetryError("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองอีกครั้ง");
      setRetrying(false);
    }
  }

  // Thai-friendly label for the multi-unit progress detail, e.g.
  // "scene 2" → "ฉากที่ 2", a ratio stays "16:9", plus "(1/3)" when known.
  function progressDetailLabel(detail: RenderProgressDetail | null): string | null {
    if (!detail?.unit) return null;
    const sceneMatch = /^scene (\d+)$/.exec(detail.unit);
    const unitLabel = sceneMatch
      ? `ฉากที่ ${sceneMatch[1]}`
      : detail.unit === "travy"
      ? "Travy"
      : detail.unit;
    const counts =
      detail.unitsTotal != null && detail.unitsDone != null
        ? ` (${Math.min(detail.unitsDone + 1, detail.unitsTotal)}/${detail.unitsTotal})`
        : "";
    return `${unitLabel}${counts}`;
  }

  const isFailed = currentStep === VideoGenerationStep.Failed;
  const displayOptions = { autoApproveRemaining };
  const phaseDisplay = buildPipelinePhaseDisplay(currentStep, failedAtStep, displayOptions);
  const currentPresentation =
    currentStep === VideoGenerationStep.Failed
      ? getPipelineStepPresentation(failedAtStep)
      : getPipelineStepPresentation(currentStep, displayOptions);
  const hasUnknownStep =
    currentStep != null && phaseDisplay.every(({ status }) => status === "unknown");

  return (
    <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          ขั้นตอนการผลิต
        </h2>
        <span className="text-xs text-slate-400">
          {durationSeconds} วินาที · {totalChannels} ช่องทาง
        </span>
      </div>

      {/* Express lane: the requester opted out of the remaining approval screens,
          so say so — otherwise a pipeline that keeps advancing on its own looks
          like something they forgot to click. */}
      {autoApproveRemaining && !isFailed && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <span className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-blue-500" />
          <div>
            <p className="text-xs font-semibold text-blue-800">
              ระบบกำลังดำเนินการขั้นตอนที่เหลือให้อัตโนมัติ
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              คุณเลือกอนุมัติทุกขั้นตอนถัดไปไว้แล้ว ไม่ต้องกดอนุมัติอีก
              ติดตามความคืบหน้าได้จากรายการด้านล่าง และจะแจ้งเตือนเมื่อวิดีโอพร้อมดาวน์โหลด
            </p>
          </div>
        </div>
      )}

      <ol className="relative">
        {phaseDisplay.map(({ phase, status }, idx) => {
          const isLast = idx === phaseDisplay.length - 1;
          const isCompleted = status === "completed";
          const isProcessing = status === "processing";
          const isActionRequired = status === "action_required";
          const isReady = status === "ready";
          const isFailedPhase = status === "failed";
          const isPending = status === "pending" || status === "unknown";
          const isPreview = status === "preview";
          const activeStatusLabel =
            (isProcessing || isActionRequired || isReady) &&
            currentPresentation?.phaseId === phase.id
              ? currentPresentation.statusLabel
              : null;

          return (
            <li key={phase.id} className="flex gap-4">
              {/* Left column: circle + connector */}
              <div className="flex flex-col items-center">
                {isCompleted ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">
                    ✓
                  </div>
                ) : isReady ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">
                    ✓
                  </div>
                ) : isFailedPhase ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    ✕
                  </div>
                ) : isProcessing ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-white" />
                  </div>
                ) : isActionRequired ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white">
                    ⏸
                  </div>
                ) : (
                  <div
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isPending
                        ? "bg-slate-200 text-slate-400"
                        : isPreview
                          ? "bg-blue-600 text-white"
                          : "bg-slate-200 text-slate-400"
                    }`}
                  >
                    {phase.id}
                  </div>
                )}
                {!isLast && (
                  <div
                    className={`mt-1 w-px flex-1 ${
                      isCompleted || isReady
                        ? "bg-green-300"
                        : isFailedPhase
                        ? "bg-red-200"
                        : isActionRequired
                        ? "bg-amber-200"
                        : "bg-slate-200"
                    }`}
                    style={{ minHeight: "2rem" }}
                  />
                )}
              </div>

              {/* Right column */}
              <div className="flex flex-1 items-start justify-between pb-5">
                <div>
                  <p
                    className={`text-sm font-semibold ${
                      isFailedPhase
                        ? "text-red-700"
                        : isProcessing
                        ? "text-blue-700"
                        : isActionRequired
                        ? "text-amber-700"
                        : isCompleted || isReady
                        ? "text-green-700"
                        : isPending
                        ? "text-slate-400"
                        : "text-slate-800"
                    }`}
                  >
                    {phase.label}
                    {isProcessing && activeStatusLabel && (
                      <span className="ml-2 text-xs font-normal text-blue-500">
                        {activeStatusLabel}
                      </span>
                    )}
                    {isActionRequired && activeStatusLabel && (
                      <span className="ml-2 text-xs font-normal text-amber-500">
                        {activeStatusLabel}
                      </span>
                    )}
                    {isReady && activeStatusLabel && (
                      <span className="ml-2 text-xs font-normal text-green-600">
                        {activeStatusLabel}
                      </span>
                    )}
                    {isCompleted && (
                      <span className="ml-2 text-xs font-normal text-green-500">เสร็จสิ้น</span>
                    )}
                    {isFailedPhase && (
                      <span className="ml-2 text-xs font-normal text-red-500">เกิดข้อผิดพลาด</span>
                    )}
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${
                      isFailedPhase
                        ? "text-red-500"
                        : isProcessing
                        ? "text-blue-500"
                        : isActionRequired
                        ? "text-amber-500"
                        : isPending
                        ? "text-slate-400"
                        : "text-slate-500"
                    }`}
                  >
                    {phase.desc}
                  </p>
                  {/* Video-gen sub-status: only shown while AI is actively rendering, not after */}
                  {isProcessing && currentStep === VideoGenerationStep.GeneratingBaseVideo && phase.id === 4 && (
                    <p className="mt-1 text-xs text-blue-400">
                      {videoGenStatus === "submitted" && "กำลังเตรียมเรนเดอร์วิดีโอจากรูปและคลิป..."}
                      {videoGenStatus === "processing" && "กำลังเรนเดอร์วิดีโอจากรูปและคลิปของคุณ"}
                      {!videoGenStatus && "กำลังประกอบวิดีโอจากรูปและคลิป..."}
                      {videoGenLastPolledAt && (
                        <span className="ml-2 text-slate-400">
                          · ตรวจสอบล่าสุด{" "}
                          {videoGenLastPolledAt.toLocaleTimeString("th-TH", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      )}
                    </p>
                  )}
                  {/* Per-step % bar — only while this phase is actively generating
                      AND the running step reports measurable progress. AI-API
                      steps never write renderProgress, so they keep the spinner
                      alone (no bar, by design). */}
                  {isProcessing && renderProgress != null && (
                    <div className="mt-2 w-56 max-w-full">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all duration-700"
                            style={{ width: `${Math.max(0, Math.min(100, renderProgress))}%` }}
                          />
                        </div>
                        <span className="flex-shrink-0 text-xs tabular-nums text-blue-600">
                          {Math.floor(Math.max(0, Math.min(100, renderProgress)))}%
                        </span>
                      </div>
                      {progressDetailLabel(renderProgressDetail) && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {progressDetailLabel(renderProgressDetail)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {/* Every step is covered by the single one-time fee. */}
                <span
                  className={`ml-4 mt-0.5 flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    isCompleted || isReady
                      ? "bg-green-50 text-green-600"
                      : isFailedPhase
                      ? "bg-red-50 text-red-600"
                      : isProcessing
                      ? "bg-blue-100 text-blue-700"
                      : isActionRequired
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-50 text-slate-400"
                  }`}
                >
                  รวมในค่าบริการ
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {hasUnknownStep && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">
            ไม่พบรูปแบบการแสดงผลสำหรับสถานะการผลิตปัจจุบัน กรุณาลองรีเฟรชหรือติดต่อทีมงาน
          </p>
        </div>
      )}

      {/* Stalled recovery: the job has sat on this processing step past its
          generous threshold (likely an interrupted render or a worker that went
          away). We never auto-fail it — instead we let the requester re-trigger
          this step. If it was actually still working, this simply restarts it. */}
      {stalled && !isFailed && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">
            ขั้นตอนนี้ใช้เวลานานกว่าปกติ
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            อาจเกิดปัญหาค้างระหว่างการประมวลผล คุณสามารถกดเริ่มขั้นตอนนี้ใหม่ได้
            หากยังทำงานอยู่ ระบบจะเริ่มประมวลผลใหม่ให้
          </p>
          {retryError && (
            <p className="mt-1 text-xs text-red-600">{retryError}</p>
          )}
          <button
            type="button"
            onClick={handleStalledRetry}
            disabled={retrying || !requestId}
            className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {retrying ? "กำลังเริ่มใหม่..." : "ลองขั้นตอนนี้อีกครั้ง"}
          </button>
        </div>
      )}

      {/* One-time charge — all steps above are included in a single fee. */}
      <div className="mt-1 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            ค่าบริการครั้งเดียว · ครอบคลุมทุกขั้นตอน
          </span>
          <span className="text-sm font-bold text-blue-700">
            {CREDITS_CONFIG.REQUEST_COST_CREDITS} เครดิต
          </span>
        </div>
        {CREDITS_CONFIG.LAUNCH_DISCOUNT_ACTIVE && (
          <p className="mt-1 text-right text-xs text-slate-400">
            <span className="line-through">
              ฿{CREDITS_CONFIG.REQUEST_FULL_PRICE_CREDITS}
            </span>{" "}
            <span className="font-medium text-green-600">
              ฿{CREDITS_CONFIG.REQUEST_COST_CREDITS} ราคาเปิดตัว (ลด 50%)
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
