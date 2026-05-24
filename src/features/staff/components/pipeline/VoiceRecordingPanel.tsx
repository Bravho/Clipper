"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import { Button } from "@/components/ui/Button";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  baseVideoAsset: UploadedAsset | null;
}

type RecorderState = "idle" | "recording" | "recorded";

export function VoiceRecordingPanel({ requestId, job, baseVideoAsset }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  // Recorder state
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  // Upload state
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const script = job.approvedScriptThai ?? job.scriptThai ?? "";
  const hookLine = job.approvedHookThai ?? job.hookThai ?? "";
  const captionThai = job.approvedCaptionThai ?? job.captionThai ?? "";
  const captionEnglish = job.approvedCaptionEnglish ?? job.captionEnglish ?? "";
  const captionChinese = job.approvedCaptionChinese ?? job.captionChinese ?? "";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [playbackUrl]);

  const startRecording = useCallback(async () => {
    setMicError(null);
    setUploadError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setPlaybackUrl(url);
        setRecorderState("recorded");
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100);
      setElapsed(0);
      setRecorderState("recording");

      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setMicError("ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตการใช้งานไมโครโฟนในเบราว์เซอร์");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  const reRecord = useCallback(() => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    setRecordedBlob(null);
    setElapsed(0);
    setRecorderState("idle");
    setUploadError(null);
  }, [playbackUrl]);

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  async function handleUpload() {
    if (!recordedBlob) return;
    setLoading(true);
    setUploadError(null);

    const ext = recordedBlob.type.includes("webm") ? "webm" : "wav";
    const file = new File([recordedBlob], `voice-recording.${ext}`, { type: recordedBlob.type });

    try {
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

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");

      const confirmRes = await fetch(
        `/api/staff/requests/${requestId}/pipeline/voice-recording/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, assetId }),
        }
      );
      if (!confirmRes.ok) throw new Error((await confirmRes.json()).error);

      router.push(pathname);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 3 — Record Voiceover</h2>

      {/* Approved base video */}
      {baseVideoAsset ? (
        <video
          src={baseVideoAsset.storageUrl}
          controls
          className="w-full max-w-sm rounded-lg border"
        />
      ) : (
        <div className="h-40 flex items-center justify-center rounded-lg border bg-gray-50 text-gray-400 text-sm">
          Video not available
        </div>
      )}

      {/* Voice recorder bar */}
      <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">บันทึกเสียงพากย์</p>

        {micError && (
          <p className="text-sm text-red-600">{micError}</p>
        )}

        <div className="flex items-center gap-4">
          {/* Record / Stop */}
          {recorderState === "idle" && (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 rounded-full bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 text-sm font-medium transition-colors"
            >
              <span className="w-3 h-3 rounded-full bg-white inline-block" />
              เริ่มบันทึก
            </button>
          )}

          {recorderState === "recording" && (
            <>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 rounded-full bg-gray-700 hover:bg-gray-800 text-white px-5 py-2.5 text-sm font-medium transition-colors"
              >
                <span className="w-3 h-3 rounded bg-white inline-block" />
                หยุดบันทึก
              </button>
              <div className="flex items-center gap-2 text-red-500">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse inline-block" />
                <span className="font-mono text-sm font-semibold">{formatTime(elapsed)}</span>
              </div>
            </>
          )}

          {recorderState === "recorded" && (
            <button
              onClick={reRecord}
              className="flex items-center gap-2 rounded-full border border-gray-300 hover:bg-gray-100 text-gray-700 px-5 py-2.5 text-sm font-medium transition-colors"
            >
              บันทึกใหม่
            </button>
          )}
        </div>

        {/* Playback */}
        {playbackUrl && recorderState === "recorded" && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">ฟังเสียงที่บันทึก ({formatTime(elapsed)})</p>
            <audio src={playbackUrl} controls className="w-full" />
          </div>
        )}
      </div>

      {/* Script and captions — for reference while recording */}
      <div className="rounded-lg border bg-amber-50 p-4 space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
            ฮุก (3 วินาทีแรก)
          </p>
          <p className="text-base font-medium text-gray-800">{hookLine || "—"}</p>
        </div>
        <hr className="border-amber-200" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">บทพูด</p>
          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{script || "—"}</p>
        </div>
      </div>

      {(captionThai || captionEnglish || captionChinese) && (
        <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">แคปชั่นโซเชียล</p>
          {captionThai && (
            <div className="space-y-0.5">
              <p className="text-xs text-gray-400">ไทย</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{captionThai}</p>
            </div>
          )}
          {captionEnglish && (
            <div className="space-y-0.5">
              <p className="text-xs text-gray-400">English</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{captionEnglish}</p>
            </div>
          )}
          {captionChinese && (
            <div className="space-y-0.5">
              <p className="text-xs text-gray-400">中文</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{captionChinese}</p>
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-1">
          <p className="text-sm font-semibold text-red-700">เกิดข้อผิดพลาด</p>
          <p className="text-sm text-red-600 break-words">{uploadError}</p>
          <p className="text-xs text-red-500 mt-1">
            เสียงที่บันทึกยังคงอยู่ — กดอัพโหลดอีกครั้งเพื่อลอง หรือกด บันทึกใหม่ เพื่อเริ่มต้นใหม่
          </p>
        </div>
      )}

      <Button
        onClick={handleUpload}
        disabled={!recordedBlob || loading}
        variant="primary"
      >
        {loading ? "กำลังอัพโหลด..." : "อัพโหลดเสียงพากย์ (RVC จะประมวลผลอัตโนมัติ)"}
      </Button>
    </div>
  );
}
