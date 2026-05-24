"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { PlatformPublishView } from "@/services/staff/VideoPipelinePresentationService";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { PublishStatus } from "@/domain/enums/PublishStatus";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  platforms: PlatformPublishView[];
}

function PlatformCard({ requestId, job, view }: { requestId: string; job: VideoGenerationJob; view: PlatformPublishView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [caption, setCaption] = useState(view.defaultCaption ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublished = view.record?.status === PublishStatus.Published;
  const isFailed = view.record?.status === PublishStatus.Failed;
  const isPublishing = view.record?.status === PublishStatus.Publishing;

  async function handlePublish() {
    if (!caption.trim()) { setError("Caption is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/requests/${requestId}/pipeline/publish/${view.platform}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, caption }),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error);
      router.push(pathname);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={[
      "rounded-lg border p-4 space-y-3",
      view.isLocked ? "opacity-50 bg-gray-50" : isPublished ? "border-green-300 bg-green-50" : "bg-white",
    ].join(" ")}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-700">{view.label}</p>
        {isPublished && <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Published</span>}
        {isPublishing && <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">Publishing...</span>}
        {isFailed && <span className="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Failed</span>}
        {view.videoRatio && <span className="text-xs text-gray-400">{view.videoRatio}</span>}
      </div>

      {view.isLocked && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">{view.lockReason}</p>
      )}

      {isPublished && view.record?.platformUrl && (
        <a
          href={view.record.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline break-all"
        >
          {view.record.platformUrl}
        </a>
      )}

      {!view.isLocked && !isPublished && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Caption</label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              disabled={loading}
            />
          </div>
          {(error ?? view.record?.errorMessage) && (
            <p className="text-xs text-red-600">{error ?? view.record?.errorMessage}</p>
          )}
          <Button onClick={handlePublish} disabled={loading || isPublishing} variant="primary">
            {loading || isPublishing ? "Publishing..." : `Publish to ${view.label}`}
          </Button>
        </>
      )}
    </div>
  );
}

export function PublishingPanel({ requestId, job, platforms }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 5 — Publish to Platforms</h2>
        <p className="text-sm text-gray-500 mt-1">
          Publish YouTube first — Tvent requires the YouTube link.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {platforms.map((view) => (
          <PlatformCard
            key={view.platform}
            requestId={requestId}
            job={job}
            view={view}
          />
        ))}
      </div>
    </div>
  );
}
