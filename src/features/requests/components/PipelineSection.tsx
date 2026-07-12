"use client";

import { useState } from "react";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { ProductionPipeline } from "./ProductionPipeline";
import { PipelineStatusPoller } from "./PipelineStatusPoller";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
  failedAtStep: VideoGenerationStep | null;
  durationSeconds?: number;
  totalChannels?: number;
  /** Phase 7 — background Travy render status, for live spinner polling. */
  tventVideoStatus?: string | null;
  /**
   * Progressive per-ratio reveal (compose step): how many distribution-channel
   * ratios must be produced, and how many have already landed. When the job is
   * at AwaitingFinalApproval with more still to come, we keep polling so each
   * remaining ratio appears as it finishes — no manual reload, no approval gate.
   */
  requiredRatioCount?: number;
  readyRatioCount?: number;
}

/**
 * Client wrapper that owns videoGenStatus state.
 * PipelineStatusPoller updates videoGenStatus directly via a callback so the
 * sub-status text reflects every poll response without waiting for an RSC
 * refresh (which is unreliable for intra-step state changes).
 */
export function PipelineSection({
  requestId,
  currentStep,
  failedAtStep,
  durationSeconds,
  totalChannels,
  tventVideoStatus = null,
  requiredRatioCount,
  readyRatioCount,
}: Props) {
  const [videoGenStatus, setVideoGenStatus] = useState<"submitted" | "processing" | null>(null);
  const [videoGenLastPolledAt, setVideoGenLastPolledAt] = useState<Date | null>(null);

  // Progressive reveal: at AwaitingFinalApproval the step no longer changes, so
  // POLLING_STEPS won't keep us polling. Keep polling while more ratios are still
  // due; each router.refresh() re-renders this server-driven prop, and once every
  // required ratio has landed revealRatios flips false and the poller unmounts.
  const revealRatios =
    currentStep === VideoGenerationStep.AwaitingFinalApproval &&
    requiredRatioCount != null &&
    (readyRatioCount ?? 0) < requiredRatioCount;

  const isPolling =
    POLLING_STEPS.includes(currentStep) ||
    tventVideoStatus === "generating" ||
    revealRatios;

  return (
    <>
      <ProductionPipeline
        currentStep={currentStep}
        failedAtStep={failedAtStep}
        durationSeconds={durationSeconds}
        totalChannels={totalChannels}
        videoGenStatus={videoGenStatus}
        videoGenLastPolledAt={videoGenLastPolledAt}
      />
      {isPolling && (
        <PipelineStatusPoller
          requestId={requestId}
          currentStep={currentStep}
          tventVideoStatus={tventVideoStatus}
          revealRatios={revealRatios}
          requiredRatioCount={requiredRatioCount}
          initialReadyRatioCount={readyRatioCount}
          onVideoGenStatus={(status, polledAt) => {
            setVideoGenStatus(status);
            setVideoGenLastPolledAt(polledAt);
          }}
        />
      )}
    </>
  );
}
