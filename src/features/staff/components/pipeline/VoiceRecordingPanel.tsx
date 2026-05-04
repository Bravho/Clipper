"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { Button } from "@/components/ui/Button";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
}

export function VoiceRecordingPanel({ requestId, job }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const script = job.approvedScriptThai ?? job.scriptThai ?? "";
  const hookLine = job.approvedHookThai ?? job.hookThai ?? "";

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      // Step 1: Get presigned URL
      const initRes = await fetch(
        `/api/staff/requests/${requestId}/pipeline/voice-recording`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.id,
            fileName: file.name,
            fileSizeBytes: file.size,
            mimeType: file.type,
          }),
        }
      );
      if (!initRes.ok) throw new Error((await initRes.json()).error);
      const { assetId, presignedUrl } = await initRes.json();

      // Step 2: Upload directly to DO Spaces
      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");

      // Step 3: Confirm and trigger ElevenLabs
      const confirmRes = await fetch(
        `/api/staff/requests/${requestId}/pipeline/voice-recording/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, assetId }),
        }
      );
      if (!confirmRes.ok) throw new Error((await confirmRes.json()).error);

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 3 — Record Voiceover</h2>

      {/* Script read-along */}
      <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
          Hook (first 3 seconds)
        </p>
        <p className="text-base font-medium text-gray-800">{hookLine}</p>
        <hr />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Full Script (Thai — read aloud)
        </p>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{script}</p>
      </div>

      {/* File upload */}
      <div className="space-y-2">
        <p className="text-sm text-gray-600">
          Record your voice reading the script above, then upload the audio file (MP3 or WAV).
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/wave"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm text-gray-600"
        />
        {file && (
          <p className="text-xs text-gray-500">
            Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        onClick={handleUpload}
        disabled={!file || loading}
        variant="primary"
      >
        {loading ? "Uploading & Processing..." : "Upload & Apply Voice Conversion"}
      </Button>
    </div>
  );
}
