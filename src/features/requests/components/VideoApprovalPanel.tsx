"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import { Platform, PLATFORM_LABELS, FORM_PLATFORMS } from "@/domain/enums/Platform";

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
  isAwaitingVoiceApproval?: boolean;
  isAwaitingAnimationApproval?: boolean;
  isAwaitingFinalApproval?: boolean;
  voiceRecordingUrl?: string | null;
  animatedVideoUrl?: string | null;
  savedMusicTrack?: string | null;
  finalClips?: any[];
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
  isAwaitingVoiceApproval = false,
  isAwaitingAnimationApproval = false,
  isAwaitingFinalApproval = false,
  voiceRecordingUrl = null,
  animatedVideoUrl = null,
  savedMusicTrack = null,
  finalClips = [],
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
  const [voiceError, setVoiceError] = useState<string | null>(null);   // conversion errors
  const [uploadError, setUploadError] = useState<string | null>(null); // submit-button errors

  // Music picker state — initialise from job's saved track so approval steps show the current selection
  const [selectedMusicTrack, setSelectedMusicTrack] = useState<string | null>(savedMusicTrack ?? null);
  const [playingMusicTrack, setPlayingMusicTrack] = useState<string | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  // Requester approval states
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([Platform.TventApp]);
  const [voiceApproving, setVoiceApproving] = useState(false);
  const [voiceRecreating, setVoiceRecreating] = useState(false);
  const [animationApproving, setAnimationApproving] = useState(false);
  const [animationRegenerating, setAnimationRegenerating] = useState(false);
  const [finalApproving, setFinalApproving] = useState(false);
  const [selectedExportRatio, setSelectedExportRatio] = useState<string>("9:16");

  // Combined preview modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVoiceRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);

  const togglePlatform = (p: Platform) => {
    if (p === Platform.TventApp) return; // TventApp is mandatory
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
  };

  const handleApproveVoice = async () => {
    setVoiceApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, targetPlatforms: selectedPlatforms, selectedMusicTrack }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติเสียงพากย์ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setVoiceApproving(false);
    }
  };

  const handleRejectVoice = async () => {
    setVoiceRecreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/reject-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งกลับไปบันทึกเสียงพากย์ใหม่ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setVoiceRecreating(false);
    }
  };

  const handleApproveAnimation = async () => {
    setAnimationApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-animation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, targetPlatforms: selectedPlatforms, selectedMusicTrack }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติ Animation ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setAnimationApproving(false);
    }
  };

  const handleRegenerateAnimation = async () => {
    setAnimationRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/regenerate-animation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้าง Animation ใหม่ได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setAnimationRegenerating(false);
    }
  };

  const handleApproveFinal = async () => {
    setFinalApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งมอบวิดีโอสุดท้ายได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setFinalApproving(false);
    }
  };
  const previewMusicGainRef = useRef<GainNode | null>(null);
  const previewAnalyserRef = useRef<AnalyserNode | null>(null);
  const duckingRafRef = useRef<number | null>(null);

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

  // Build Web Audio graph when preview modal opens; tear it down when it closes.
  // Voice → AnalyserNode → destination (for speech detection)
  // Music → GainNode → destination (for real-time ducking)
  useEffect(() => {
    if (!showPreviewModal) {
      if (duckingRafRef.current) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null; }
      previewAudioCtxRef.current?.close();
      previewAudioCtxRef.current = null;
      previewMusicGainRef.current = null;
      previewAnalyserRef.current = null;
      return;
    }

    // Delay so the <audio> elements finish mounting before we attach them
    const timer = setTimeout(() => {
      const voice = previewVoiceRef.current;
      const music = previewMusicRef.current;
      if (!voice) return;

      const ctx = new AudioContext();
      previewAudioCtxRef.current = ctx;

      const voiceSource = ctx.createMediaElementSource(voice);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      voiceSource.connect(analyser);
      analyser.connect(ctx.destination);
      previewAnalyserRef.current = analyser;

      if (music) {
        const musicSource = ctx.createMediaElementSource(music);
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.25;
        musicSource.connect(gainNode);
        gainNode.connect(ctx.destination);
        previewMusicGainRef.current = gainNode;
      }
    }, 80);

    return () => {
      clearTimeout(timer);
      if (duckingRafRef.current) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null; }
      previewAudioCtxRef.current?.close();
      previewAudioCtxRef.current = null;
      previewMusicGainRef.current = null;
      previewAnalyserRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreviewModal]);

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

  function handleMusicTrackClick(trackId: string) {
    // Stop any currently playing preview regardless of which track was clicked
    if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current.src = ""; }
    setPlayingMusicTrack(null);

    if (trackId === "none") {
      setSelectedMusicTrack("none");
      return;
    }

    const track = BACKGROUND_MUSIC_TRACKS.find((t) => t.id === trackId)!;
    if (playingMusicTrack !== trackId) {
      const audio = new Audio(track.url);
      audio.onended = () => setPlayingMusicTrack(null);
      audio.play();
      musicAudioRef.current = audio;
      setPlayingMusicTrack(trackId);
    }
    setSelectedMusicTrack(trackId);
  }

  function openPreview() {
    if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current.src = ""; }
    setPlayingMusicTrack(null);
    setShowPreviewModal(true);
    setIsPreviewPlaying(false);
  }

  function closePreview() {
    if (duckingRafRef.current) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null; }
    setShowPreviewModal(false);
    setIsPreviewPlaying(false);
    if (previewVideoRef.current) { previewVideoRef.current.pause(); previewVideoRef.current.currentTime = 0; }
    if (previewVoiceRef.current) { previewVoiceRef.current.pause(); previewVoiceRef.current.currentTime = 0; }
    if (previewMusicRef.current) { previewMusicRef.current.pause(); previewMusicRef.current.currentTime = 0; }
  }

  async function togglePreview() {
    const video = previewVideoRef.current;
    const voice = previewVoiceRef.current;
    const ctx = previewAudioCtxRef.current;
    if (!video || !voice) return;

    if (isPreviewPlaying) {
      video.pause();
      voice.pause();
      previewMusicRef.current?.pause();
      if (duckingRafRef.current) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null; }
      setIsPreviewPlaying(false);
    } else {
      // Browser suspends AudioContext until a user gesture — resume it here
      if (ctx?.state === "suspended") await ctx.resume();

      video.currentTime = 0;
      voice.currentTime = 0;
      const music = previewMusicRef.current;
      if (music) music.currentTime = 0;

      try {
        await Promise.all([video.play(), voice.play(), music ? music.play() : Promise.resolve()]);
        setIsPreviewPlaying(true);

        // Real-time ducking: read voice amplitude via AnalyserNode and adjust music GainNode
        const analyser = previewAnalyserRef.current;
        const gainNode = previewMusicGainRef.current;
        if (analyser && gainNode && ctx) {
          // Capture as consts so the tick closure sees non-nullable types
          const _analyser: AnalyserNode = analyser;
          const _gainNode: GainNode = gainNode;
          const _ctx: AudioContext = ctx;
          const bufferLength = _analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          function tick() {
            _analyser.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              const v = (dataArray[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / bufferLength);

            // Speaking: duck music to 4%; silent: restore to 25%
            // Fast attack (0.05s) so music drops quickly when speech starts;
            // slow release (0.5s) so it fades back up naturally between sentences.
            const isSpeaking = rms > 0.02;
            _gainNode.gain.setTargetAtTime(
              isSpeaking ? 0.04 : 0.25,
              _ctx.currentTime,
              isSpeaking ? 0.05 : 0.5,
            );

            duckingRafRef.current = requestAnimationFrame(tick);
          }
          duckingRafRef.current = requestAnimationFrame(tick);
        }

        video.onended = () => {
          voice.pause();
          previewMusicRef.current?.pause();
          if (duckingRafRef.current) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null; }
          setIsPreviewPlaying(false);
        };
      } catch {
        // Autoplay blocked — user needs to interact again
      }
    }
  }

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
    setUploadError(null);
  }, [REC_KEY, CONV_KEY, playbackUrl]);

  async function handleConvert() {
    if (!recordedBlob) return;
    setRecorderState("converting");
    setVoiceError(null);

    try {
      const form = new FormData();
      form.append("audio", recordedBlob, "recording.wav");

      const res = await fetch("/api/rvc/convert", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `RVC error: ${res.status}`);
      }

      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "audio/wav" });
      const newUrl = URL.createObjectURL(blob);

      if (convertedUrlRef.current) URL.revokeObjectURL(convertedUrlRef.current);
      convertedUrlRef.current = newUrl;

      setConvertedBlob(blob);
      setConvertedUrl(newUrl);
      setConversionCount((c) => c + 1);
      setRecorderState("converted");
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "การแปลงเสียงล้มเหลว กรุณาลองอีกครั้ง");
      setRecorderState("recorded");
    }
  }

  async function handleVoiceUpload() {
    if (!convertedBlob) return;
    setVoiceUploading(true);
    setUploadError(null);

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
        body: JSON.stringify({ jobId, assetId, selectedMusicTrack: selectedMusicTrack === "none" ? null : selectedMusicTrack }),
      });
      if (!confirmRes.ok) throw new Error((await confirmRes.json()).error);

      // Upload succeeded — clear persisted session data
      sessionStorage.removeItem(REC_KEY);
      sessionStorage.removeItem(`${REC_KEY}_meta`);
      sessionStorage.removeItem(CONV_KEY);
      router.push(pathname);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "อัพโหลดล้มเหลว");
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

        {/* Voice Approval Phase */}
        {isAwaitingVoiceApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-blue-100 bg-blue-50/50">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ขั้นตอนที่ 3: ตรวจสอบเสียงพากย์ RVC</h3>
              <p className="text-sm text-slate-500 mb-4">
                ตรวจสอบความถูกต้องของเสียงพากย์ที่แปลงผ่านโปรแกรมของคุณ และเลือกช่องทางที่ต้องการเผยแพร่ด้านล่าง
              </p>
              {voiceRecordingUrl ? (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-blue-600 mb-1">เสียงที่แปลงแล้ว (WAV)</p>
                  <audio src={voiceRecordingUrl} controls className="w-full" />
                </div>
              ) : (
                <p className="text-sm text-amber-600 mb-4">ไม่พบไฟล์เสียงพากย์ กรุณาบันทึกใหม่อีกครั้ง</p>
              )}

              {/* Background music picker */}
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">เพลงพื้นหลัง</p>
                  <p className="text-xs text-slate-400 mt-0.5">คลิกเพื่อฟังตัวอย่าง เสียงพูดจะดังขึ้นอัตโนมัติเมื่อไม่มีการพูด</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleMusicTrackClick("none")}
                    className={[
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                      selectedMusicTrack === "none"
                        ? "border-slate-500 bg-slate-100 text-slate-800 font-medium"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                      {selectedMusicTrack === "none" ? (
                        <svg className="w-4 h-4 text-slate-700" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" /><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 20v4M8 20h8" /></svg>
                      )}
                    </span>
                    <span className="truncate">ไม่ใส่เพลง</span>
                  </button>
                  {BACKGROUND_MUSIC_TRACKS.map((track) => {
                    const isSelected = selectedMusicTrack === track.id;
                    const isPlaying = playingMusicTrack === track.id;
                    return (
                      <button
                        key={track.id}
                        onClick={() => handleMusicTrackClick(track.id)}
                        className={[
                          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                          isSelected
                            ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          {isPlaying ? (
                            <span className="flex gap-0.5 items-end h-4">
                              <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "60%", animationDelay: "0ms" }} />
                              <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "100%", animationDelay: "100ms" }} />
                              <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "40%", animationDelay: "200ms" }} />
                            </span>
                          ) : isSelected ? (
                            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                          )}
                        </span>
                        <span className="truncate">{track.label}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedMusicTrack === null && (
                  <p className="text-xs text-amber-600">กรุณาเลือกเพลง หรือเลือก &ldquo;ไม่ใส่เพลง&rdquo; ก่อนอนุมัติ</p>
                )}
              </div>

              {/* Distribution platforms checkbox list */}
              <div className="border-t border-slate-200/80 pt-4 mb-4">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">เลือกช่องทางการเผยแพร่</p>
                <p className="text-xs text-slate-400 mb-3">ระบบจะคำนวณซับไตเติ้ลและปรับขนาดวิดีโอ (FFmpeg) ตามช่องทางที่คุณเลือก</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FORM_PLATFORMS.map((p) => {
                    const isMandatory = p === Platform.TventApp;
                    const isChecked = selectedPlatforms.includes(p) || isMandatory;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        className={[
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all",
                          isChecked
                            ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                          isMandatory ? "opacity-80 cursor-not-allowed" : ""
                        ].join(" ")}
                      >
                        <span className="flex-shrink-0 w-4.5 h-4.5 flex items-center justify-center rounded border border-slate-300 bg-white text-blue-600">
                          {isChecked && "✓"}
                        </span>
                        <span className="truncate">{PLATFORM_LABELS[p]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleRejectVoice}
                  disabled={voiceRecreating || voiceApproving}
                  className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {voiceRecreating ? "กำลังยกเลิก..." : "บันทึกเสียงใหม่"}
                </button>
                <Button
                  onClick={handleApproveVoice}
                  loading={voiceApproving}
                  disabled={voiceRecreating || voiceApproving || selectedMusicTrack === null}
                >
                  อนุมัติเสียงและสร้างวิดีโอสุดท้าย →
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Animation Approval Phase */}
        {isAwaitingAnimationApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-purple-100 bg-purple-50/40">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ขั้นตอนที่ 3.5: ตรวจสอบ Animation และ Graphic</h3>
              <p className="text-sm text-slate-500 mb-4">
                AI สร้าง animation และ graphic overlays ลงบนวิดีโอแล้ว — ตรวจสอบผลลัพธ์ด้านล่างและเลือกช่องทางเผยแพร่ก่อนอนุมัติ
              </p>

              {animatedVideoUrl ? (
                <div className="mb-5 flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[480px]">
                  <video
                    src={animatedVideoUrl}
                    controls
                    className="max-h-[460px] w-auto object-contain rounded"
                  />
                </div>
              ) : (
                <p className="text-sm text-amber-600 mb-4">ไม่พบวิดีโอ Animation กรุณาลองสร้างใหม่อีกครั้ง</p>
              )}

              {/* Voice audio playback */}
              {voiceRecordingUrl && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-purple-700 mb-1">เสียงพากย์ที่แปลงแล้ว (RVC)</p>
                  <audio src={voiceRecordingUrl} controls className="w-full" />
                </div>
              )}

              {/* Background music picker */}
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">เพลงพื้นหลัง</p>
                  <p className="text-xs text-slate-400 mt-0.5">คลิกเพื่อฟังตัวอย่าง เสียงพูดจะดังขึ้นอัตโนมัติเมื่อไม่มีการพูด</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleMusicTrackClick("none")}
                    className={[
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                      selectedMusicTrack === "none"
                        ? "border-slate-500 bg-slate-100 text-slate-800 font-medium"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                      {selectedMusicTrack === "none" ? (
                        <svg className="w-4 h-4 text-slate-700" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" /><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 20v4M8 20h8" /></svg>
                      )}
                    </span>
                    <span className="truncate">ไม่ใส่เพลง</span>
                  </button>
                  {BACKGROUND_MUSIC_TRACKS.map((track) => {
                    const isSelected = selectedMusicTrack === track.id;
                    const isPlaying = playingMusicTrack === track.id;
                    return (
                      <button
                        key={track.id}
                        onClick={() => handleMusicTrackClick(track.id)}
                        className={[
                          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                          isSelected
                            ? "border-purple-500 bg-purple-50 text-purple-800 font-medium"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                          {isPlaying ? (
                            <span className="flex gap-0.5 items-end h-4">
                              <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "60%", animationDelay: "0ms" }} />
                              <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "100%", animationDelay: "100ms" }} />
                              <span className="w-0.5 bg-purple-500 rounded-full animate-bounce" style={{ height: "40%", animationDelay: "200ms" }} />
                            </span>
                          ) : isSelected ? (
                            <svg className="w-4 h-4 text-purple-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                          )}
                        </span>
                        <span className="truncate">{track.label}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedMusicTrack === null && (
                  <p className="text-xs text-amber-600">กรุณาเลือกเพลง หรือเลือก &ldquo;ไม่ใส่เพลง&rdquo; ก่อนอนุมัติ</p>
                )}
              </div>

              {/* Distribution platforms */}
              <div className="border-t border-slate-200/80 pt-4 mb-4">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">เลือกช่องทางการเผยแพร่</p>
                <p className="text-xs text-slate-400 mb-3">ระบบจะปรับขนาดวิดีโอ (FFmpeg) ตามช่องทางที่คุณเลือก</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FORM_PLATFORMS.map((p) => {
                    const isMandatory = p === Platform.TventApp;
                    const isChecked = selectedPlatforms.includes(p) || isMandatory;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        className={[
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all",
                          isChecked
                            ? "border-purple-500 bg-purple-50 text-purple-800 font-medium"
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                          isMandatory ? "opacity-80 cursor-not-allowed" : ""
                        ].join(" ")}
                      >
                        <span className="flex-shrink-0 w-4.5 h-4.5 flex items-center justify-center rounded border border-slate-300 bg-white text-purple-600">
                          {isChecked && "✓"}
                        </span>
                        <span className="truncate">{PLATFORM_LABELS[p]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleRegenerateAnimation}
                  disabled={animationRegenerating || animationApproving}
                  className="rounded-md border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  {animationRegenerating ? "กำลังสร้างใหม่..." : "ขอสร้าง Animation ใหม่"}
                </button>
                <Button
                  onClick={handleApproveAnimation}
                  loading={animationApproving}
                  disabled={animationRegenerating || animationApproving || selectedMusicTrack === null}
                >
                  อนุมัติและสร้างวิดีโอสุดท้าย →
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Final Video Approval Phase */}
        {isAwaitingFinalApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-green-100 bg-green-50/30">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ขั้นตอนสุดท้าย: ตรวจสอบวิดีโอที่ตัดต่อเสร็จแล้ว</h3>
              <p className="text-sm text-slate-500 mb-4">
                วิดีโอของคุณได้รับการฝังซับไตเติ้ลสองภาษา (ไทย/อังกฤษ) และจัดวางตำแหน่งสินค้าแบบกึ่งกลางเรียบร้อยแล้ว ตรวจสอบแต่ละขนาดได้ด้านล่าง:
              </p>

              {finalClips.length > 0 ? (() => {
                const activeClip = finalClips.find(c => c.videoRatio === selectedExportRatio) || finalClips[0];
                return (
                  <div className="space-y-4">
                    {/* Ratio tabs */}
                    <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
                      {finalClips.map((clip) => {
                        const ratio = clip.videoRatio;
                        const isActive = selectedExportRatio === ratio;
                        return (
                          <button
                            key={clip.id}
                            type="button"
                            onClick={() => setSelectedExportRatio(ratio)}
                            className={[
                              "px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                              isActive
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            ].join(" ")}
                          >
                            ขนาด {ratio === "9:16" ? "แนวตั้ง (9:16)" : ratio === "16:9" ? "แนวนอน (16:9)" : ratio === "1:1" ? "จัตุรัส (1:1)" : `แนวตั้งแคบ (${ratio})`}
                          </button>
                        );
                      })}
                    </div>

                    {/* Preview video */}
                    <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[500px]">
                      <video
                        key={activeClip.id}
                        src={activeClip.storageUrl}
                        controls
                        className="max-h-[480px] w-auto object-contain rounded"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
                      <div className="flex gap-2">
                        {finalClips.map(clip => (
                          <a
                            key={clip.id}
                            href={clip.storageUrl}
                            download={`final_video_${clip.videoRatio.replace(":", "_")}.mp4`}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            ดาวน์โหลด ({clip.videoRatio})
                          </a>
                        ))}
                      </div>
                      <Button
                        onClick={handleApproveFinal}
                        loading={finalApproving}
                        disabled={finalApproving}
                      >
                        อนุมัติและรับมอบวิดีโอ ✓
                      </Button>
                    </div>
                  </div>
                );
              })() : (
                <p className="text-sm text-slate-400">ไม่พบวิดีโอที่สร้างเสร็จแล้ว กรุณาติดต่อแอดมิน</p>
              )}
            </Card>
          </div>
        )}

        {/* Processing Indicator */}
        {!isAwaitingApproval && !isAwaitingVoiceRecording && !isAwaitingVoiceApproval && !isAwaitingAnimationApproval && !isAwaitingFinalApproval && (
          <Card className="mt-6 border-slate-100 bg-slate-50 p-5 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4" />
            <h4 className="text-sm font-semibold text-slate-800">กำลังประมวลผลวิดีโอของคุณ...</h4>
            <p className="mt-1 text-xs text-slate-400 max-w-[280px]">
              AI กำลังถอดเสียงและจับคู่ซับไตเติ้ลสองภาษา (ไทยและอังกฤษ) พร้อมจัดตําแหน่งภาพสินค้าให้อัตโนมัติด้วย FFmpeg ขั้นตอนนี้ใช้เวลา 10-30 วินาที
            </p>
          </Card>
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
              <p className="text-sm font-semibold text-red-700">การแปลงเสียงล้มเหลว</p>
              <p className="text-sm text-red-600">{voiceError}</p>
              <p className="text-xs text-red-500 mt-1">เสียงที่บันทึกยังคงอยู่ — ลองแปลงอีกครั้งหรือบันทึกใหม่</p>
            </div>
          )}

          {/* Background music picker — shown once RVC conversion is done */}
          {recorderState === "converted" && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">เพลงพื้นหลัง</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  คลิกเพื่อฟังตัวอย่าง เสียงพูดจะดังขึ้นอัตโนมัติเมื่อไม่มีการพูด
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {/* No-music option */}
                <button
                  onClick={() => handleMusicTrackClick("none")}
                  className={[
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                    selectedMusicTrack === "none"
                      ? "border-slate-500 bg-slate-100 text-slate-800 font-medium"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {selectedMusicTrack === "none" ? (
                      <svg className="w-4 h-4 text-slate-700" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                        <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 20v4M8 20h8" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">ไม่ใส่เพลง</span>
                </button>

                {BACKGROUND_MUSIC_TRACKS.map((track) => {
                  const isSelected = selectedMusicTrack === track.id;
                  const isPlaying = playingMusicTrack === track.id;
                  return (
                    <button
                      key={track.id}
                      onClick={() => handleMusicTrackClick(track.id)}
                      className={[
                        "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                        isSelected
                          ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        {isPlaying ? (
                          <span className="flex gap-0.5 items-end h-4">
                            <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "60%", animationDelay: "0ms" }} />
                            <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "100%", animationDelay: "100ms" }} />
                            <span className="w-0.5 bg-blue-500 rounded-full animate-bounce" style={{ height: "40%", animationDelay: "200ms" }} />
                          </span>
                        ) : isSelected ? (
                          <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{track.label}</span>
                    </button>
                  );
                })}
              </div>
              {selectedMusicTrack === null && (
                <p className="text-xs text-amber-600">กรุณาเลือกเพลง หรือเลือก &ldquo;ไม่ใส่เพลง&rdquo; ก่อนส่งเสียงพากย์</p>
              )}
            </div>
          )}

          {/* Preview combined button — only enabled once converted + music chosen */}
          {recorderState === "converted" && selectedMusicTrack !== null && (
            <div className="mb-4">
              <button
                onClick={openPreview}
                className="flex items-center gap-2 rounded-full border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 px-5 py-2.5 text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
                ดูตัวอย่างรวม (วิดีโอ + เสียง + เพลง)
              </button>
              <p className="mt-1.5 text-xs text-slate-400">ฟังก่อนส่ง — เพลงพื้นหลังจะเล่นที่ระดับเสียง 25%</p>
            </div>
          )}

          <Button
            onClick={handleVoiceUpload}
            disabled={!convertedBlob || voiceUploading || selectedMusicTrack === null}
            loading={voiceUploading}
          >
            {voiceUploading ? "กำลังสร้าง Animation..." : "เพิ่ม animation และ graphic"}
          </Button>

          {uploadError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-700">ส่งเสียงพากย์ไม่สำเร็จ</p>
              <p className="text-sm text-red-600">{uploadError}</p>
            </div>
          )}
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

      {/* Combined preview modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">ตัวอย่างรวม</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedMusicTrack === "none"
                    ? "วิดีโอ + เสียงพากย์ (ไม่มีเพลงพื้นหลัง)"
                    : `วิดีโอ + เสียงพากย์ + ${BACKGROUND_MUSIC_TRACKS.find((t) => t.id === selectedMusicTrack)?.label ?? ""}`}
                </p>
              </div>
              <button
                onClick={closePreview}
                className="rounded-full p-1.5 hover:bg-slate-100 text-slate-500 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Video — muted because its own audio track is empty */}
            <div className="bg-black">
              <video
                ref={previewVideoRef}
                src={videoUrl}
                muted
                playsInline
                className="w-full"
                style={{ maxHeight: 400 }}
              />
            </div>

            {/* Hidden audio elements */}
            {convertedUrl && <audio ref={previewVoiceRef} src={convertedUrl} />}
            {selectedMusicTrack && selectedMusicTrack !== "none" && (() => {
              const track = BACKGROUND_MUSIC_TRACKS.find((t) => t.id === selectedMusicTrack);
              return track ? <audio ref={previewMusicRef} src={track.url} loop /> : null;
            })()}

            {/* Play controls */}
            <div className="px-5 py-4 space-y-3">
              <button
                onClick={togglePreview}
                className="flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 text-sm font-medium transition-colors"
              >
                {isPreviewPlaying ? (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    หยุดชั่วคราว
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    เล่นตัวอย่าง
                  </>
                )}
              </button>
              <p className="text-xs text-slate-400">
                * เพลงพื้นหลังจะดังอัตโนมัติขึ้นระหว่างช่วงที่ไม่มีการพูด (ระบบ FFmpeg จัดการในขั้นตอนถัดไป)
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
