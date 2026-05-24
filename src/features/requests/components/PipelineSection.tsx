"use client";

import { useState } from "react";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { ProductionPipeline } from "./ProductionPipeline";
import { PipelineStatusPoller } from "./PipelineStatusPoller";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
  failedAtStep: VideoGenerationStep | null;
}

/**
 * Client wrapper that owns klingStatus state.
 * PipelineStatusPoller updates klingStatus directly via a callback so the
 * sub-status text reflects every poll response without waiting for an RSC
 * refresh (which is unreliable for intra-step state changes).
 */
export function PipelineSection({ requestId, currentStep, failedAtStep }: Props) {
  const [klingStatus, setKlingStatus] = useState<"submitted" | "processing" | null>(null);
  const [klingLastPolledAt, setKlingLastPolledAt] = useState<Date | null>(null);

  const isPolling = POLLING_STEPS.includes(currentStep);

  return (
    <>
      <ProductionPipeline
        currentStep={currentStep}
        failedAtStep={failedAtStep}
        klingStatus={klingStatus}
        klingLastPolledAt={klingLastPolledAt}
      />
      {isPolling && (
        <PipelineStatusPoller
          requestId={requestId}
          currentStep={currentStep}
          onKlingStatus={(status, polledAt) => {
            setKlingStatus(status);
            setKlingLastPolledAt(polledAt);
          }}
        />
      )}
    </>
  );
}
