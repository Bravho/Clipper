"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";

interface Props {
  requestId: string;
  currentStep: VideoGenerationStep;
  /** Phase 7 — when "generating", keep polling for the background Travy render
   * even after the job is Complete, so the Travy clip appears without a manual
   * reload. */
  tventVideoStatus?: string | null;
  /**
   * Progressive per-ratio reveal: when true, the job is at AwaitingFinalApproval
   * with more distribution-channel ratios still composing. Keep polling and
   * refresh as each new ratio's finalExport id appears.
   */
  revealRatios?: boolean;
  requiredRatioCount?: number;
  /** How many ratios had already landed at server render — the refresh baseline. */
  initialReadyRatioCount?: number;
  /** Whether the job already looked stalled at server render — the refresh baseline. */
  initialStalled?: boolean;
  onVideoGenStatus?: (status: "submitted" | "processing", polledAt: Date) => void;
}

// All async steps (montage render, GPT, FFmpeg) complete within ~30s–2min, and
// the status endpoint just reads the job, so a 5s poll is fine everywhere. (The
// old 30s interval was a Veo-era throttle; Veo is no longer on the path.)
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function PipelineStatusPoller({
  requestId,
  currentStep,
  tventVideoStatus,
  revealRatios = false,
  requiredRatioCount,
  initialReadyRatioCount = 0,
  initialStalled = false,
  onVideoGenStatus,
}: Props) {
  const router = useRouter();
  const onVideoGenStatusRef = useRef(onVideoGenStatus);
  // Highest ratio count we've already refreshed for — starts at what the server
  // rendered, so we only refresh when a NEW ratio lands.
  const revealedCountRef = useRef(initialReadyRatioCount);
  // Whether we've already refreshed for the stalled banner — starts at the
  // server-rendered value so we only refresh on the false→true transition.
  const stalledRef = useRef(initialStalled);

  useEffect(() => { onVideoGenStatusRef.current = onVideoGenStatus; }, [onVideoGenStatus]);

  useEffect(() => {
    const tventGenerating = tventVideoStatus === "generating";
    if (!POLLING_STEPS.includes(currentStep) && !tventGenerating && !revealRatios) return;

    const isVideoGenStep = currentStep === VideoGenerationStep.GeneratingBaseVideo;
    const intervalMs = DEFAULT_POLL_INTERVAL_MS;

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
        // Progressive per-ratio reveal: while at AwaitingFinalApproval the step
        // stays put, so refresh whenever a new ratio's finalExport id appears.
        // Each refresh re-renders the server prop (readyRatioCount); once every
        // required ratio has landed, the parent stops mounting this poller.
        if (revealRatios && data.finalExports) {
          const readyCount = Object.values(data.finalExports).filter(Boolean).length;
          if (readyCount > revealedCountRef.current) {
            revealedCountRef.current = readyCount;
            router.refresh();
          }
          if (requiredRatioCount != null && readyCount >= requiredRatioCount) {
            clearInterval(interval);
          }
        }
        // Stalled recovery: the step doesn't change when a job strands, so refresh
        // once when the server reports it has crossed the stall threshold, to
        // reveal the "taking longer than expected — retry" affordance.
        if (data.stalled && !stalledRef.current) {
          stalledRef.current = true;
          router.refresh();
        }
        // Phase 7 — the Travy render runs in the background while the job is
        // already Complete (no step change), so also refresh when its status
        // flips (generating → ready/failed) to reveal the finished clip.
        if (tventGenerating && data.tventVideoStatus && data.tventVideoStatus !== "generating") {
          router.refresh();
        }
      } catch {
        // network error — try again next interval
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [requestId, currentStep, tventVideoStatus, revealRatios, requiredRatioCount, router]);

  return null;
}
