"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
  onVideoGenStatus?: (status: "submitted" | "processing", polledAt: Date) => void;
}

// Veo video generation takes a few minutes; poll less aggressively to avoid
// hammering the Veo API. All other async steps (GPT, FFmpeg) complete
// within ~30s so 5s is appropriate there.
const VIDEO_GEN_POLL_INTERVAL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function PipelineStatusPoller({ requestId, currentStep, onVideoGenStatus }: Props) {
  const router = useRouter();
  const onVideoGenStatusRef = useRef(onVideoGenStatus);

  useEffect(() => { onVideoGenStatusRef.current = onVideoGenStatus; }, [onVideoGenStatus]);

  useEffect(() => {
    if (!POLLING_STEPS.includes(currentStep)) return;

    const isVideoGenStep = currentStep === VideoGenerationStep.GeneratingBaseVideo;
    const intervalMs = isVideoGenStep ? VIDEO_GEN_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/pipeline-status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const { currentStep: newStep, videoGenStatus, videoGenLastPolledAt } = data;

        // Update videoGenStatus directly in client state — do not rely on RSC
        // refresh for intra-step sub-status changes.
        if (isVideoGenStep && videoGenStatus && onVideoGenStatusRef.current) {
          onVideoGenStatusRef.current(
            videoGenStatus,
            videoGenLastPolledAt ? new Date(videoGenLastPolledAt) : new Date()
          );
        }

        // Keep refreshing until the server-rendered currentStep prop actually
        // changes. This avoids a one-refresh race leaving the old voice asset
        // mounted after iAppTTS completes.
        if (newStep && newStep !== currentStep) {
          router.refresh();
        }
      } catch {
        // network error — try again next interval
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [requestId, currentStep, router]);

  return null;
}
