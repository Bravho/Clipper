"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { Button } from "@/components/ui/Button";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  baseVideoAsset: UploadedAsset | null;
}

export function VideoReviewPanel({ requestId, job, baseVideoAsset }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [backToStep, setBackToStep] = useState<"video" | "content">("video");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/staff/requests/${requestId}/pipeline/video/approve`, {
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
      const res = await fetch(`/api/staff/requests/${requestId}/pipeline/video/reject`, {
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
      <h2 className="text-lg font-semibold">Step 2 — Review Generated Video</h2>

      {baseVideoAsset ? (
        <video
          src={baseVideoAsset.storageUrl}
          controls
          className="w-full max-w-sm rounded-lg border"
        />
      ) : (
        <div className="h-48 flex items-center justify-center rounded-lg border bg-gray-50 text-gray-400 text-sm">
          Video not available
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleApprove} disabled={loading !== null} variant="primary">
          {loading === "approve" ? "Approving..." : "Approve Video"}
        </Button>

        <div className="flex items-center gap-2">
          <select
            value={backToStep}
            onChange={(e) => setBackToStep(e.target.value as "video" | "content")}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="video">Regenerate video only</option>
            <option value="content">Back to scene plan</option>
          </select>
          <Button onClick={handleReject} disabled={loading !== null} variant="secondary">
            {loading === "reject" ? "Rejecting..." : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}
