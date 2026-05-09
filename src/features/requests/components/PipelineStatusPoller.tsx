"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
}

/**
 * Invisible client component that polls /api/requests/[id]/pipeline-status
 * every 5 seconds while the pipeline is in an async AI processing step.
 * Calls router.refresh() when the step changes so the server component
 * re-renders with the updated state (including failures).
 */
export function PipelineStatusPoller({ requestId, currentStep }: Props) {
  const router = useRouter();
  const stepRef = useRef(currentStep);

  useEffect(() => {
    stepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    if (!POLLING_STEPS.includes(currentStep)) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/pipeline-status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { currentStep: newStep } = await res.json();
        if (newStep && newStep !== stepRef.current) {
          router.refresh();
        }
      } catch {
        // network error — try again next interval
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [requestId, currentStep, router]);

  return null;
}
