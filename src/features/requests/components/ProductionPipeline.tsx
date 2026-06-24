"use client";

import {
  calcPipelineCost,
  PIPELINE_PHASES,
  PIPELINE_STEP_COSTS,
  type PipelineCostBreakdown,
} from "@/config/credits";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

// Steps where the AI work is done but staff review is pending.
// The phase shows as "awaiting review" (amber) rather than "in progress" (blue).
const AWAITING_REVIEW_STEPS = new Set<VideoGenerationStep>([
  VideoGenerationStep.AwaitingVideoApproval,
  VideoGenerationStep.AwaitingVoiceApproval,
  VideoGenerationStep.AwaitingSceneDesignApproval,
  VideoGenerationStep.AwaitingAnimationApproval,
  VideoGenerationStep.AwaitingFinalApproval,
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
  [VideoGenerationStep.Publishing]:                 5,
  [VideoGenerationStep.Complete]:                   5,
  // Legacy steps
  [VideoGenerationStep.AwaitingVoiceRecording]:     2,
  [VideoGenerationStep.ProcessingVoice]:            2,
};

// NOTE: cost breakdown field names (step2/step3) retain their original
// internal meaning (step2 = video gen, step3 = voice/music) from
// calcPipelineCost, but the displayed phase order is now audio-first
// (phase 2 = voice, phase 3 = video) — so the mapping is swapped here.
function stepCredit(phaseId: number, costs: PipelineCostBreakdown): string {
  switch (phaseId) {
    case 1: return `${costs.step1} เครดิต`;
    case 2: return `${costs.step3} เครดิต`;
    case 3: return `${costs.step2} เครดิต`;
    case 4: return `${costs.step4} เครดิต`;
    case 5: return costs.extraChannels > 0 ? `${costs.step5} เครดิต` : "ไม่มีค่าเพิ่ม";
    default: return "";
  }
}

function stepHint(phaseId: number, costs: PipelineCostBreakdown, duration: number): string {
  switch (phaseId) {
    case 1: return "10 เครดิต คงที่";
    case 2: return `7/วิ × ${duration}วิ`;
    case 3: return `10/วิ × ${duration}วิ`;
    case 4: return `3/วิ × ${duration}วิ`;
    case 5:
      return costs.extraChannels > 0
        ? `30 × ${costs.extraChannels} ช่องทางเพิ่ม`
        : `${PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS} ช่องทางแรกไม่มีค่าใช้จ่าย`;
    default: return "";
  }
}

interface Props {
  currentStep?: VideoGenerationStep;
  failedAtStep?: VideoGenerationStep | null;
  durationSeconds?: number;
  totalChannels?: number;
  videoGenStatus?: "submitted" | "processing" | null;
  videoGenLastPolledAt?: Date | null;
}

export function ProductionPipeline({
  currentStep,
  failedAtStep,
  durationSeconds = PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
  totalChannels = PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS,
  videoGenStatus,
  videoGenLastPolledAt,
}: Props) {
  const costs = calcPipelineCost(durationSeconds, totalChannels);

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
                      {videoGenStatus === "submitted" && "รอ Veo AI รับงานในคิว..."}
                      {videoGenStatus === "processing" && "Veo AI กำลังเรนเดอร์วิดีโอ"}
                      {!videoGenStatus && "กำลังส่งงานไปยัง Veo AI..."}
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
                  <p className="mt-0.5 text-xs text-slate-400 italic">
                    {stepHint(phase.id, costs, durationSeconds)}
                  </p>
                </div>
                <span
                  className={`ml-4 mt-0.5 flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    isCompleted
                      ? "bg-green-50 text-green-600"
                      : isFailedPhase
                      ? "bg-red-50 text-red-600"
                      : isActive
                      ? "bg-blue-100 text-blue-700"
                      : isAwaitingReview
                      ? "bg-amber-50 text-amber-700"
                      : isPending
                      ? "bg-slate-100 text-slate-400"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {stepCredit(phase.id, costs)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Subtotal + rework + total */}
      <div className="mt-1 space-y-1.5 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>ค่าใช้จ่ายฐาน</span>
          <span>{costs.base} เครดิต</span>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>สำรองแก้ไข ({PIPELINE_STEP_COSTS.REWORK_BUFFER_PERCENT}%)</span>
          <span>+{costs.rework} เครดิต</span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
          <span className="text-sm text-slate-500">ประมาณการรวม</span>
          <span className="text-sm font-bold text-blue-700">{costs.total} เครดิต</span>
        </div>
      </div>
    </div>
  );
}
