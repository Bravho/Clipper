"use client";

import { useState } from "react";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { isAutoApprovedGate } from "@/config/pipelinePresentation";
import type { RenderProgressDetail } from "@/domain/models/VideoGenerationJob";
import { ProductionPipeline } from "./ProductionPipeline";
import { PipelineStatusPoller } from "./PipelineStatusPoller";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
  failedAtStep: VideoGenerationStep | null;
  durationSeconds?: number;
  totalChannels?: number;
  /** Phase 7 — background Travy render status, for live spinner polling. */
  travyVideoStatus?: string | null;
  /**
   * Progressive per-ratio reveal (compose step): how many distribution-channel
   * ratios must be produced, and how many have already landed. When the job is
   * at AwaitingFinalApproval with more still to come, we keep polling so each
   * remaining ratio appears as it finishes — no manual reload, no approval gate.
   */
  requiredRatioCount?: number;
  readyRatioCount?: number;
  /**
   * Progressive per-CHANNEL reveal (GeneratingAdditionalRatios): how many
   * captioned exports the step must produce in total (primary + additional
   * ratios) and how many have already landed. While more are due, the poller
   * refreshes as each channel's video lands so it becomes playable immediately.
   */
  requiredCaptionedCount?: number;
  readyCaptionedCount?: number;
  /** Server-rendered % baseline for the current generating step (null = none). */
  initialRenderProgress?: number | null;
  initialRenderProgressDetail?: RenderProgressDetail | null;
  /** True when the job has been stuck on a processing step past its threshold. */
  stalled?: boolean;
  /** The job took the step-5 express lane — see ProductionPipeline. */
  autoApproveRemaining?: boolean;
}

/**
 * Client wrapper that owns videoGenStatus + renderProgress state.
 * PipelineStatusPoller updates both directly via callbacks so the sub-status
 * text and the % bar reflect every poll response without waiting for an RSC
 * refresh (which is unreliable for intra-step state changes).
 */
export function PipelineSection({
  requestId,
  currentStep,
  failedAtStep,
  durationSeconds,
  totalChannels,
  travyVideoStatus = null,
  requiredRatioCount,
  readyRatioCount,
  requiredCaptionedCount,
  readyCaptionedCount,
  initialRenderProgress = null,
  initialRenderProgressDetail = null,
  stalled = false,
  autoApproveRemaining = false,
}: Props) {
  const [videoGenStatus, setVideoGenStatus] = useState<"submitted" | "processing" | null>(null);
  const [videoGenLastPolledAt, setVideoGenLastPolledAt] = useState<Date | null>(null);
  const [renderProgress, setRenderProgress] = useState<number | null>(initialRenderProgress);
  const [renderProgressDetail, setRenderProgressDetail] =
    useState<RenderProgressDetail | null>(initialRenderProgressDetail);
  // FIFO render-queue standing (count only — never other requesters' details).
  const [queue, setQueue] = useState<{ position: number | null; state: string | null }>({
    position: null,
    state: null,
  });

  // Reset the % bar when the step changes (render-phase adjustment): the server
  // nulls renderProgress on each heavy dispatch, and the previous step's 95%
  // must not bleed into the next step's bar.
  const [lastStep, setLastStep] = useState(currentStep);
  if (lastStep !== currentStep) {
    setLastStep(currentStep);
    setRenderProgress(initialRenderProgress);
    setRenderProgressDetail(initialRenderProgressDetail);
  }

  // Progressive reveal: at AwaitingFinalApproval the step no longer changes, so
  // POLLING_STEPS won't keep us polling. Keep polling while more ratios are still
  // due; each router.refresh() re-renders this server-driven prop, and once every
  // required ratio has landed revealRatios flips false and the poller unmounts.
  const revealRatios =
    currentStep === VideoGenerationStep.AwaitingFinalApproval &&
    requiredRatioCount != null &&
    (readyRatioCount ?? 0) < requiredRatioCount;

  // Progressive per-channel reveal: GeneratingAdditionalRatios IS in
  // POLLING_STEPS (so polling continues regardless) — this flag only adds the
  // refresh-on-new-captioned-export trigger while more channels are still due.
  const revealCaptioned =
    currentStep === VideoGenerationStep.GeneratingAdditionalRatios &&
    requiredCaptionedCount != null &&
    (readyCaptionedCount ?? 0) < requiredCaptionedCount;

  // Express lane: the approval gates are NOT in POLLING_STEPS (normally nothing
  // moves until the requester clicks), but here the server advances them on its
  // own within seconds. Without this the page would freeze on a gate the job has
  // already left, until a manual reload.
  const autoAdvancing = autoApproveRemaining && isAutoApprovedGate(currentStep);

  const isPolling =
    POLLING_STEPS.includes(currentStep) ||
    travyVideoStatus === "generating" ||
    revealRatios ||
    revealCaptioned ||
    autoAdvancing;

  // Requester-facing queue line. Only ever a COUNT of steps ahead — no other
  // requester's name or step. Shown only while this request has an active step
  // on the shared Mac worker line (position != null).
  const queueMessage =
    queue.position == null
      ? null
      : queue.state === "claimed" || queue.position === 0
        ? "กำลังประมวลผลวิดีโอของคุณอยู่ในขณะนี้"
        : `มีงานอยู่ก่อนหน้าคุณ ${queue.position} รายการในคิวประมวลผล`;

  return (
    <>
      <ProductionPipeline
        currentStep={currentStep}
        failedAtStep={failedAtStep}
        durationSeconds={durationSeconds}
        totalChannels={totalChannels}
        videoGenStatus={videoGenStatus}
        videoGenLastPolledAt={videoGenLastPolledAt}
        renderProgress={renderProgress}
        renderProgressDetail={renderProgressDetail}
        requestId={requestId}
        stalled={stalled}
        autoApproveRemaining={autoApproveRemaining}
      />
      {queueMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange-400" />
          <span>{queueMessage}</span>
        </div>
      )}
      {isPolling && (
        <PipelineStatusPoller
          requestId={requestId}
          currentStep={currentStep}
          travyVideoStatus={travyVideoStatus}
          revealRatios={revealRatios}
          requiredRatioCount={requiredRatioCount}
          initialReadyRatioCount={readyRatioCount}
          revealCaptioned={revealCaptioned}
          requiredCaptionedCount={requiredCaptionedCount}
          initialReadyCaptionedCount={readyCaptionedCount}
          initialStalled={stalled}
          autoAdvancing={autoAdvancing}
          onVideoGenStatus={(status, polledAt) => {
            setVideoGenStatus(status);
            setVideoGenLastPolledAt(polledAt);
          }}
          onProgress={(pct, detail) => {
            // Never move the bar backwards within a step; a step change remounts
            // this component (server props), which resets the baseline.
            setRenderProgress((prev) =>
              pct == null ? prev : prev == null ? pct : Math.max(prev, pct)
            );
            if (detail) setRenderProgressDetail(detail);
          }}
          onQueue={(q) => setQueue(q)}
        />
      )}
    </>
  );
}
