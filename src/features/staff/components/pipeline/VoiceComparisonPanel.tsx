"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { Button } from "@/components/ui/Button";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  voiceRecording: UploadedAsset | null;
  processedVoice: UploadedAsset | null;
}

export function VoiceComparisonPanel({ requestId, job, voiceRecording, processedVoice }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callApi(action: "approve" | "reject") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/requests/${requestId}/pipeline/voice/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id }),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 3 — Review Voice Conversion</h2>
      <p className="text-sm text-gray-500">
        Compare the original recording with the ElevenLabs professional voice. Approve if the
        tone and timing match the script, or re-record if the source audio needs to be redone.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Original Recording
          </p>
          {voiceRecording ? (
            <audio src={voiceRecording.storageUrl} controls className="w-full" />
          ) : (
            <p className="text-sm text-gray-400">Not available</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
            Professional Voice (ElevenLabs)
          </p>
          {processedVoice ? (
            <audio src={processedVoice.storageUrl} controls className="w-full" />
          ) : (
            <p className="text-sm text-gray-400">Processing...</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button
          onClick={() => callApi("approve")}
          disabled={loading !== null || !processedVoice}
          variant="primary"
        >
          {loading === "approve" ? "Approving..." : "Approve Voice"}
        </Button>
        <Button
          onClick={() => callApi("reject")}
          disabled={loading !== null}
          variant="secondary"
        >
          {loading === "reject" ? "..." : "Re-record"}
        </Button>
      </div>
    </div>
  );
}
