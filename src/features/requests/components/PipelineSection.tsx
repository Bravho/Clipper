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
}: Props) {
  const [videoGenStatus, setVideoGenStatus] = useState<"submitted" | "processing" | null>(null);
  const [videoGenLastPolledAt, setVideoGenLastPolledAt] = useState<Date | null>(null);

  const isPolling = POLLING_STEPS.includes(currentStep);

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
          onVideoGenStatus={(status, polledAt) => {
            setVideoGenStatus(status);
            setVideoGenLastPolledAt(polledAt);
          }}
        />
      )}
    </>
  );
}
