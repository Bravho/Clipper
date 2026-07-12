"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREDITS_CONFIG, PIPELINE_PHASES } from "@/config/credits";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/** Fallbacks for display only — duration/channels no longer affect the price. */
const DEFAULT_DURATION_SECONDS = 15;
const DEFAULT_CHANNELS = 2;

// Steps where the AI work is done but staff review is pending.
// The phase shows as "awaiting review" (amber) rather than "in progress" (blue).
const AWAITING_REVIEW_STEPS = new Set<VideoGenerationStep>([
  VideoGenerationStep.AwaitingVideoApproval,
  VideoGenerationStep.AwaitingVoiceApproval,
  VideoGenerationStep.AwaitingSceneDesignApproval,
  VideoGenerationStep.AwaitingAnimationApproval,
  VideoGenerationStep.AwaitingFinalApproval,
  VideoGenerationStep.AwaitingOverlayApproval,
  VideoGenerationStep.AwaitingAdditionalRatios,
]);

const STEP_TO_PHASE: Partial<Record<VideoGenerationStep, number>> = {
  [VideoGenerationStep.AnalyzingContent]:          1,
  [VideoGenerationStep.AwaitingContentApproval]:   1,
  // Audio-first reorder: voice generation now runs before video generation.
  [VideoGenerationStep.GeneratingVoice]:            2,
  [VideoGenerationStep.AwaitingVoiceApproval]:      2,
  [VideoGenerationStep.GeneratingSceneDesign]:      3,
  [VideoGenerationStep.AwaitingSceneDesignApproval]: 3,
  [VideoGenerationStep.AwaitingSceneScriptApproval]: 3,
  [VideoGenerationStep.GeneratingBaseVideo]:        3,
  [VideoGenerationStep.AwaitingVideoApproval]:      3,
  [VideoGenerationStep.GeneratingAnimations]:       3,
  [VideoGenerationStep.AwaitingAnimationApproval]:  3,
  [VideoGenerationStep.ComposingFinalVideo]:        4,
  [VideoGenerationStep.AwaitingFinalApproval]:      4,
  [VideoGenerationStep.GeneratingOverlay]:          4,
  [VideoGenerationStep.AwaitingOverlayApproval]:    4,
  [VideoGenerationStep.AwaitingAdditionalRatios]:   4,
  [VideoGenerationStep.GeneratingAdditionalRatios]: 4,
  [VideoGenerationStep.Publishing]:                 5,
  [VideoGenerationStep.Complete]:                   5,
  // Legacy steps
  [VideoGenerationStep.AwaitingVoiceRecording]:     2,
  [VideoGenerationStep.ProcessingVoice]:            2,
};

interface Props {
  currentStep?: VideoGenerationStep;
  failedAtStep?: VideoGenerationStep | null;
  durationSeconds?: number;
  totalChannels?: number;
  videoGenStatus?: "submitted" | "processing" | null;
  videoGenLastPolledAt?: Date | null;
  /** Request id — needed to POST the stalled-step retry. */
  requestId?: string;
  /** True when the job has been stuck on this processing step past its threshold. */
  stalled?: boolean;
}

export function ProductionPipeline({
  currentStep,
  failedAtStep,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  totalChannels = DEFAULT_CHANNELS,
  videoGenStatus,
  videoGenLastPolledAt,
  requestId,
  stalled = false,
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

  const isFailed = currentStep === VideoGenerationStep.Failed;
  const failedPhase = isFailed && failedAtStep ? (STEP_TO_PHASE[failedAtStep] ?? 0) : 0;
  const activePhase = currentStep && !isFailed ? (STEP_TO_PHASE[currentStep] ?? 0) : 0;
  const isTracking = activePhase > 0 || (isFailed && failedPhase > 0);

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

      <ol className="relative">
        {PIPELINE_PHASES.map((phase, idx) => {
          const isLast = idx === PIPELINE_PHASES.length - 1;
          const isCompletedNormal = !isFailed && isTracking && activePhase > phase.id;
          const isCompletedBeforeFailure = isFailed && failedPhase > phase.id;
          const isCompleted = isCompletedNormal || isCompletedBeforeFailure;
          // "Awaiting review" = AI done, staff reviewing — amber indicator, no spinner.
          const isAwaitingReview =
            !isFailed &&
            isTracking &&
            activePhase === phase.id &&
            currentStep != null &&
            AWAITING_REVIEW_STEPS.has(currentStep);
          const isActive = !isFailed && isTracking && activePhase === phase.id && !isAwaitingReview;
          const isFailedPhase = isFailed && failedPhase === phase.id;
          const isPending = isTracking && !isCompleted && !isActive && !isAwaitingReview && !isFailedPhase;

          return (
            <li key={phase.id} className="flex gap-4">
              {/* Left column: circle + connector */}
              <div className="flex flex-col items-center">
                {isCompleted ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">
                    ✓
                  </div>
                ) : isFailedPhase ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    ✕
                  </div>
                ) : isActive ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-white" />
                  </div>
                ) : isAwaitingReview ? (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white">
                    ⏸
                  </div>
                ) : (
                  <div
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isPending
                        ? "bg-slate-200 text-slate-400"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {phase.id}
                  </div>
                )}
                {!isLast && (
                  <div
                    className={`mt-1 w-px flex-1 ${
                      isCompleted
                        ? "bg-green-300"
                        : isFailedPhase
                        ? "bg-red-200"
                        : isAwaitingReview
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
                        : isActive
                        ? "text-blue-700"
                        : isAwaitingReview
                        ? "text-amber-700"
                        : isCompleted
                        ? "text-green-700"
                        : isPending
                        ? "text-slate-400"
                        : "text-slate-800"
                    }`}
                  >
                    {phase.label}
                    {isActive && (
                      <span className="ml-2 text-xs font-normal text-blue-500">กำลังดำเนินการ</span>
                    )}
                    {isAwaitingReview && (
                      <span className="ml-2 text-xs font-normal text-amber-500">
                        {currentStep === VideoGenerationStep.AwaitingVideoApproval
                          ? "รอผู้ใช้ตรวจสอบ"
                          : "รอทีมงานตรวจสอบ"}
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
                        : isActive
                        ? "text-blue-500"
                        : isAwaitingReview
                        ? "text-amber-500"
                        : isPending
                        ? "text-slate-400"
                        : "text-slate-500"
                    }`}
                  >
                    {phase.desc}
                  </p>
                  {/* Video-gen sub-status: only shown while AI is actively rendering, not after */}
                  {isActive && currentStep === VideoGenerationStep.GeneratingBaseVideo && phase.id === 3 && (
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
                </div>
                {/* Every step is covered by the single one-time fee. */}
                <span
                  className={`ml-4 mt-0.5 flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    isCompleted
                      ? "bg-green-50 text-green-600"
                      : isFailedPhase
                      ? "bg-red-50 text-red-600"
                      : isActive
                      ? "bg-blue-100 text-blue-700"
                      : isAwaitingReview
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
