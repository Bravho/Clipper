"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { Button } from "@/components/ui/Button";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  exports: {
    "9:16": UploadedAsset | null;
    "16:9": UploadedAsset | null;
    "1:1": UploadedAsset | null;
    "4:5": UploadedAsset | null;
  };
}

const RATIO_LABELS: Record<string, string> = {
  "9:16": "9:16 — TikTok / Reels / Shorts",
  "16:9": "16:9 — YouTube",
  "1:1":  "1:1 — Instagram",
  "4:5":  "4:5 — Facebook",
};

export function FinalExportReviewPanel({ requestId, job, exports }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [backToStep, setBackToStep] = useState<"video" | "voice" | "composition">("composition");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/staff/requests/${requestId}/pipeline/final/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.push(pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading("reject");
    setError(null);
    try {
      const res = await fetch(`/api/staff/requests/${requestId}/pipeline/final/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, backToStep }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.push(pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 4 — Review Final Exports</h2>

      <div className="grid grid-cols-2 gap-4">
        {(["9:16", "16:9", "1:1", "4:5"] as const).map((ratio) => {
          const asset = exports[ratio];
          return (
            <div key={ratio} className="space-y-1">
              <p className="text-xs font-semibold text-gray-500">{RATIO_LABELS[ratio]}</p>
              {asset ? (
                <video
                  src={asset.storageUrl}
                  controls
                  className="w-full rounded border"
                  style={{ aspectRatio: ratio.replace(":", "/") }}
                />
              ) : (
                <div className="h-32 rounded border bg-gray-50 flex items-center justify-center text-sm text-gray-400">
                  Rendering...
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          onClick={handleApprove}
          disabled={loading !== null}
          variant="primary"
        >
          {loading === "approve" ? "Approving..." : "Approve All Exports"}
        </Button>

        <div className="flex items-center gap-2">
          <select
            value={backToStep}
            onChange={(e) => setBackToStep(e.target.value as typeof backToStep)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="composition">Recompose video</option>
            <option value="voice">Back to voice recording</option>
            <option value="video">Back to video generation</option>
          </select>
          <Button onClick={handleReject} disabled={loading !== null} variant="secondary">
            {loading === "reject" ? "..." : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}
