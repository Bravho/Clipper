"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Encodes raw mono PCM chunks captured from the Web Audio API into a WAV blob. */
function encodePcmToWav(chunks: Float32Array[], sampleRate: number): Blob {
  const numSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytesPerSample = 2;
  const dataLength = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const write = (offset: number, chars: string) =>
    chars.split("").forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  write(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

interface Props {
  requestId: string;
  jobId: string;
  videoUrl: string;
  isAwaitingApproval: boolean;
  isAwaitingVoiceRecording?: boolean;
  scenes: ScenePlan[];
  hookThai: string | null;
  hookEnglish: string | null;
  scriptThai: string | null;
  scriptEnglish: string | null;
  captionThai: string | null;
  captionEnglish: string | null;
  captionChinese: string | null;
}

type RecorderState = "idle" | "recording" | "recorded" | "converting" | "converted";

export function VideoApprovalPanel({
  requestId,
  jobId,
  videoUrl,
  isAwaitingApproval,
  isAwaitingVoiceRecording = false,
  scenes,
  hookThai,
  hookEnglish,
  scriptThai,
  scriptEnglish,
  captionThai,
  captionEnglish,
  captionChinese,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<"review" | "revise">("review");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editHookThai, setEditHookThai] = useState(hookThai ?? "");
  const [editScriptThai, setEditScriptThai] = useState(scriptThai ?? "");
  const [editCaptionThai, setEditCaptionThai] = useState(captionThai ?? "");
  const [editScenes, setEditScenes] = useState<ScenePlan[]>(scenes);

  // Voice recorder state
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [conversionCount, setConversionCount] = useState(0);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(44100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const elapsedRef = useRef(0);
  // Ref so handleConvert always revokes the live URL, not a stale closure value
  const convertedUrlRef = useRef<string | null>(null);

  const REC_KEY = `rvc_rec_${requestId}`;
  const CONV_KEY = `rvc_conv_${requestId}`;

  // Auto-save scriptThai + captionThai to the DB 800ms after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/requests/${requestId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, scriptThai: editScriptThai, captionThai: editCaptionThai }),
      }).catch(() => { /* silent — user is still able to edit */ });
    }, 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editScriptThai, editCaptionThai]);

  // Keep ref in sync with state so handleConvert always revokes the live URL
  useEffect(() => { convertedUrlRef.current = convertedUrl; }, [convertedUrl]);

  // Restore recording from sessionStorage on mount
  useEffect(() => {
    if (!isAwaitingVoiceRecording) return;
    try {
      const recData = sessionStorage.getItem(REC_KEY);
      const recMeta = sessionStorage.getItem(`${REC_KEY}_meta`);
      if (!recData || !recMeta) return;

      const { mimeType, elapsed: savedElapsed } = JSON.parse(recMeta) as { mimeType: string; elapsed: number };
      const blob = base64ToBlob(recData, mimeType);
      setRecordedBlob(blob);
      setPlaybackUrl(URL.createObjectURL(blob));
      elapsedRef.current = savedElapsed;
      setElapsed(savedElapsed);

      const convData = sessionStorage.getItem(CONV_KEY);
      if (convData) {
        const convBlob = base64ToBlob(convData, "audio/wav");
        const restoredUrl = URL.createObjectURL(convBlob);
        convertedUrlRef.current = restoredUrl;
        setConvertedBlob(convBlob);
        setConvertedUrl(restoredUrl);
        setConversionCount(1);
        setRecorderState("converted");
      } else {
        setRecorderState("recorded");
      }
    } catch { /* ignore corrupt storage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Persist raw recording whenever it changes
  useEffect(() => {
    if (!recordedBlob) return;
    blobToBase64(recordedBlob).then((b64) => {
      try {
        sessionStorage.setItem(REC_KEY, b64);
        sessionStorage.setItem(`${REC_KEY}_meta`, JSON.stringify({
          mimeType: recordedBlob.type,
          elapsed: elapsedRef.current,
        }));
      } catch { /* storage full — non-critical */ }
    });
  }, [recordedBlob, REC_KEY]);

  // Persist converted audio whenever it changes
  useEffect(() => {
    if (!convertedBlob) return;
    blobToBase64(convertedBlob).then((b64) => {
      try { sessionStorage.setItem(CONV_KEY, b64); } catch { }
    });
  }, [convertedBlob, CONV_KEY]);

  // Cleanup object URLs and audio resources on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, [playbackUrl]);

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const startRecording = useCallback(async () => {
    setMicError(null);
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Web Audio API: capture raw PCM from the microphone — no codec compression
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      sampleRateRef.current = audioCtx.sampleRate;
      samplesRef.current = [];

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        samplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setElapsed(0);
      setRecorderState("recording");
      timerRef.current = setInterval(() => setElapsed((s) => { const n = s + 1; elapsedRef.current = n; return n; }), 1000);
    } catch {
      setMicError("ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตการใช้งานไมโครโฟนในเบราว์เซอร์");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // Disconnect audio graph and stop mic
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    // Encode all captured PCM chunks directly into a WAV blob
    const wavBlob = encodePcmToWav(samplesRef.current, sampleRateRef.current);
    samplesRef.current = [];
    setRecordedBlob(wavBlob);
    setPlaybackUrl(URL.createObjectURL(wavBlob));
    setRecorderState("recorded");
  }, []);

  const reRecord = useCallback(() => {
    sessionStorage.removeItem(REC_KEY);
    sessionStorage.removeItem(`${REC_KEY}_meta`);
    sessionStorage.removeItem(CONV_KEY);
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    if (convertedUrlRef.current) URL.revokeObjectURL(convertedUrlRef.current);
    convertedUrlRef.current = null;
    setPlaybackUrl(null);
    setConvertedUrl(null);
    setRecordedBlob(null);
    setConvertedBlob(null);
    setConversionCount(0);
    elapsedRef.current = 0;
    setElapsed(0);
    setRecorderState("idle");
    setVoiceError(null);
  }, [REC_KEY, CONV_KEY, playbackUrl]);

  async function handleConvert() {
    if (!recordedBlob) return;
    setRecorderState("converting");
    setVoiceError(null);

    try {
      const rvcBase = process.env.NEXT_PUBLIC_RVC_SERVER_URL;
      if (!rvcBase) throw new Error("RVC server URL not configured (NEXT_PUBLIC_RVC_SERVER_URL)");

      // Step 1 — submit job directly to RVC server (CORS enabled on the server)
      const form = new FormData();
      form.append("audio", recordedBlob, "recording.wav");
      form.append("voice_id", process.env.NEXT_PUBLIC_RVC_DEFAULT_VOICE_MODEL ?? "mind_model");

      const submitRes = await fetch(`${rvcBase}/api/rvc/convert`, { method: "POST", body: form });
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error ?? `RVC submit error: ${submitRes.status}`);
      }
      const { job_id } = await submitRes.json();

      // Step 2 — poll until completed or failed (max 15 minutes)
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`${rvcBase}/api/rvc/jobs/${job_id}`);
        if (!statusRes.ok) throw new Error(`RVC status error: ${statusRes.status}`);
        const job = await statusRes.json();

        if (job.status === "failed") throw new Error(`RVC conversion failed: ${job.error ?? "unknown"}`);
        if (job.status !== "completed") continue;

        // Step 3 — download converted audio (no-store to prevent browser caching)
        const dlRes = await fetch(`${rvcBase}/api/rvc/jobs/${job_id}/download`, { cache: "no-store" });
        if (!dlRes.ok) throw new Error(`RVC download error: ${dlRes.status}`);

        const buf = await dlRes.arrayBuffer();
        const blob = new Blob([buf], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);

        // Use ref so we always revoke the live URL, not a stale closure value
        if (convertedUrlRef.current) URL.revokeObjectURL(convertedUrlRef.current);
        convertedUrlRef.current = newUrl;

        setConvertedBlob(blob);
        setConvertedUrl(newUrl);
        setConversionCount((c) => c + 1);
        setRecorderState("converted");
        return;
      }

      throw new Error("RVC conversion timed out (>15 minutes)");
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "การแปลงเสียงล้มเหลว กรุณาลองอีกครั้ง");
      setRecorderState("recorded");
    }
  }

  async function handleVoiceUpload() {
    if (!convertedBlob) return;
    setVoiceUploading(true);
    setVoiceError(null);

    const file = new File([convertedBlob], `voice-converted.wav`, { type: "audio/wav" });

    try {
      const initRes = await fetch(`/api/requests/${requestId}/voice-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type,
        }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).error);
      const { assetId, presignedUrl } = await initRes.json();

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("การอัพโหลดไปยัง storage ล้มเหลว");

      const confirmRes = await fetch(`/api/requests/${requestId}/voice-recording/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, assetId }),
      });
      if (!confirmRes.ok) throw new Error((await confirmRes.json()).error);

      // Upload succeeded — clear persisted session data
      sessionStorage.removeItem(REC_KEY);
      sessionStorage.removeItem(`${REC_KEY}_meta`);
      sessionStorage.removeItem(CONV_KEY);
      router.push(pathname);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "อัพโหลดล้มเหลว");
    } finally {
      setVoiceUploading(false);
    }
  }

  const updateSceneDescription = (index: number, value: string) => {
    setEditScenes((prev) =>
      prev.map((s, i) => (i === index ? { ...s, visualDescriptionThai: value } : s))
    );
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติวิดีโอได้");
      }
      router.push(pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsSubmitting(false);
    }
  };

  const handleReviseSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/revise-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          scenePlan: editScenes,
          hookThai: editHookThai,
          scriptThai: editScriptThai,
          captionThai: editCaptionThai,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งขอแก้ไขได้");
      }
      router.push(pathname);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Video card */}
      <Card className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          วิดีโอที่สร้างโดย Kling AI
        </h2>
        <video
          src={videoUrl}
          controls
          playsInline
          className="w-full rounded-lg bg-black"
          style={{ maxHeight: 480 }}
        />

        {isAwaitingApproval && (
          <div className="mt-4">
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {mode === "review" ? (
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setMode("revise")}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  ขอแก้ไขวีดิโอ
                </button>
                <Button onClick={handleApprove} loading={isSubmitting} disabled={isSubmitting}>
                  อนุมัติวีดิโอนี้
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setMode("review"); setError(null); }}
                  disabled={isSubmitting}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <Button onClick={handleReviseSubmit} loading={isSubmitting} disabled={isSubmitting}>
                  ส่งขอสร้างวีดิโอใหม่
                </Button>
              </div>
            )}
          </div>
        )}

        {!isAwaitingApproval && !isAwaitingVoiceRecording && (
          <p className="mt-2 text-xs text-slate-400">
            วิดีโอฐานที่อนุมัติแล้ว — ทีมงานกำลังดำเนินการในขั้นตอนถัดไป
          </p>
        )}

        {isAwaitingVoiceRecording && (
          <p className="mt-2 text-xs text-slate-400">
            วิดีโอฐานที่อนุมัติแล้ว — บันทึกเสียงพากย์ของคุณด้านล่าง
          </p>
        )}
      </Card>

      {/* Voice recorder bar — shown first so user records before reading the script */}
      {isAwaitingVoiceRecording && (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-900">บันทึกเสียงพากย์</h2>
          <p className="mb-4 text-sm text-slate-500">
            บันทึกเสียงของคุณ ระบบจะแปลงเสียงอัตโนมัติด้วย RVC ก่อนส่ง
          </p>

          {micError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{micError}</p>
            </div>
          )}

          <div className="flex items-center gap-4 mb-4">
            {recorderState === "idle" && (
              <button
                onClick={startRecording}
                className="flex items-center gap-2 rounded-full bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 text-sm font-medium transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-white inline-block" />
                เริ่มบันทึกเสียง
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
            {(recorderState === "recorded" || recorderState === "converting" || recorderState === "converted") && (
              <button
                onClick={reRecord}
                disabled={recorderState === "converting"}
                className="flex items-center gap-2 rounded-full border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                บันทึกใหม่
              </button>
            )}
          </div>

          {/* Original recording + convert button */}
          {playbackUrl && (recorderState === "recorded" || recorderState === "converting" || recorderState === "converted") && (
            <div className="mb-4 space-y-2">
              <p className="text-xs text-slate-500">เสียงต้นฉบับ ({formatTime(elapsed)})</p>
              <audio src={playbackUrl} controls className="w-full" />
              {recorderState === "recorded" && (
                <button
                  onClick={handleConvert}
                  className="flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-medium transition-colors"
                >
                  แปลงเสียงด้วย RVC
                </button>
              )}
              {recorderState === "converting" && (
                <p className="text-sm text-blue-600 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin inline-block" />
                  กำลังแปลงเสียงผ่าน RVC...
                </p>
              )}
              {recorderState === "converted" && (
                <button
                  onClick={handleConvert}
                  className="flex items-center gap-2 rounded-full border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 text-sm font-medium transition-colors"
                >
                  ส่งไปยัง RVC อีกครั้ง
                </button>
              )}
            </div>
          )}

          {/* Converted audio preview */}
          {convertedUrl && recorderState === "converted" && (
            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold text-blue-600">
                เสียงที่แปลงแล้ว (RVC)
                {conversionCount > 1 && (
                  <span className="ml-2 font-normal text-blue-400">· แปลงครั้งที่ {conversionCount}</span>
                )}
              </p>
              <audio key={convertedUrl} src={convertedUrl} controls className="w-full" />
            </div>
          )}

          {voiceError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-700">เกิดข้อผิดพลาด</p>
              <p className="text-sm text-red-600">{voiceError}</p>
              <p className="text-xs text-red-500 mt-1">เสียงที่บันทึกยังคงอยู่ — ลองแปลงอีกครั้งหรือบันทึกใหม่</p>
            </div>
          )}

          <Button
            onClick={handleVoiceUpload}
            disabled={!convertedBlob || voiceUploading}
            loading={voiceUploading}
          >
            {voiceUploading ? "กำลังอัพโหลด..." : "ส่งเสียงพากย์"}
          </Button>
        </Card>
      )}

      {/* บทพูด + แคปชั่น editable — shown after recorder */}
      {isAwaitingVoiceRecording && (
        <Card className="mb-6 flex flex-col gap-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">บทพูด</p>
            <textarea
              value={editScriptThai}
              onChange={(e) => setEditScriptThai(e.target.value)}
              rows={4}
              className={ta}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">แคปชั่นโซเชียล</p>
            <textarea
              value={editCaptionThai}
              onChange={(e) => setEditCaptionThai(e.target.value)}
              rows={3}
              className={ta}
            />
          </div>
        </Card>
      )}

      {/* Script section — editable in revise mode, read-only otherwise */}
      {mode === "revise" ? (
        <div className="mb-6 flex flex-col gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">แก้ไขสคริปต์วิดีโอที่อนุมัติ</p>
            <p className="mt-0.5 text-sm text-amber-700">
              แก้ไขบทพูดและแผนฉากด้านล่าง จากนั้นคลิก{" "}
              <strong>ส่งขอสร้างวีดิโอใหม่</strong> เพื่อให้ Kling AI สร้างวิดีโอใหม่
            </p>
          </div>

          {/* Hook */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              ฮุค (3 วินาทีแรก)
            </h3>
            <textarea
              value={editHookThai}
              onChange={(e) => setEditHookThai(e.target.value)}
              rows={2}
              className={`${ta} text-sm text-slate-800`}
            />
          </div>

          {/* Scene plan */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              แผนฉาก
            </h3>
            <div className="flex flex-col gap-3">
              {editScenes.map((scene, index) => (
                <div
                  key={scene.sceneNumber}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                      ฉาก {scene.sceneNumber}
                    </span>
                    <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                  </div>
                  <textarea
                    value={scene.visualDescriptionThai ?? ""}
                    onChange={(e) => updateSceneDescription(index, e.target.value)}
                    rows={3}
                    className={`${ta} text-sm text-slate-700`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Script */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              บทพูด
            </h3>
            <textarea
              value={editScriptThai}
              onChange={(e) => setEditScriptThai(e.target.value)}
              rows={4}
              className={`${ta} text-sm text-slate-800`}
            />
          </div>

          {/* Caption */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              แคปชั่นโซเชียล
            </h3>
            <textarea
              value={editCaptionThai}
              onChange={(e) => setEditCaptionThai(e.target.value)}
              rows={3}
              className={`${ta} text-sm text-slate-700`}
            />
          </div>

          <div className="flex justify-end gap-3 pb-2">
            <button
              onClick={() => { setMode("review"); setError(null); }}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <Button onClick={handleReviseSubmit} loading={isSubmitting} disabled={isSubmitting}>
              ส่งขอสร้างวีดิโอใหม่
            </Button>
          </div>
        </div>
      ) : (
        /* Read-only approved script */
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900">สคริปต์วิดีโอที่อนุมัติ</h2>

          {(hookThai ?? hookEnglish) && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                ฮุค (3 วินาทีแรก)
              </p>
              {hookThai && <p className="text-sm text-slate-800">{hookThai}</p>}
              {hookEnglish && <p className="mt-0.5 text-sm italic text-slate-500">{hookEnglish}</p>}
            </div>
          )}

          {scenes.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                แผนฉาก
              </p>
              <div className="flex flex-col gap-2">
                {scenes.map((scene) => (
                  <div
                    key={scene.sceneNumber}
                    className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                        ฉาก {scene.sceneNumber}
                      </span>
                      <span className="text-xs text-slate-400">{scene.durationSeconds} วินาที</span>
                    </div>
                    {scene.visualDescriptionThai && (
                      <p className="text-sm text-slate-700">{scene.visualDescriptionThai}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(scriptThai ?? scriptEnglish) && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                บทพูด
              </p>
              {scriptThai && <p className="text-sm text-slate-800">{scriptThai}</p>}
              {scriptEnglish && <p className="mt-1 text-sm italic text-slate-500">{scriptEnglish}</p>}
            </div>
          )}

          {(captionThai ?? captionEnglish ?? captionChinese) && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                แคปชั่นโซเชียล
              </p>
              <div className="flex flex-col gap-2">
                {captionThai && (
                  <div>
                    <p className="text-xs text-slate-400">ภาษาไทย</p>
                    <p className="text-sm text-slate-700">{captionThai}</p>
                  </div>
                )}
                {captionEnglish && (
                  <div>
                    <p className="text-xs text-slate-400">English</p>
                    <p className="text-sm text-slate-700">{captionEnglish}</p>
                  </div>
                )}
                {captionChinese && (
                  <div>
                    <p className="text-xs text-slate-400">中文</p>
                    <p className="text-sm text-slate-700">{captionChinese}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

    </>
  );
}
