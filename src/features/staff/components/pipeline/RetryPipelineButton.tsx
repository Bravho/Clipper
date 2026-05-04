"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VideoGenerationStep, PIPELINE_STEP_LABELS } from "@/domain/enums/VideoGenerationStep";

interface Props {
  requestId: string;
  jobId: string;
  failedAtStep: VideoGenerationStep | null;
}

export function RetryPipelineButton({ requestId, jobId, failedAtStep }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepLabel = failedAtStep ? PIPELINE_STEP_LABELS[failedAtStep] : "Start";

  async function handleRetry() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/requests/${requestId}/pipeline/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // Job may have been lost after server restart — refresh to get current state
        if (d.error?.includes("not found")) {
          router.refresh();
          return;
        }
        throw new Error(d.error ?? "Retry failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleRetry}
        disabled={loading}
        className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
      >
        {loading ? "Retrying..." : `Retry from "${stepLabel}"`}
      </button>
    </div>
  );
}
