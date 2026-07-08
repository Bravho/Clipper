"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MontageSceneAsset, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { OrderedSourceAsset } from "@/lib/sourceAssets";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";
import { MOTION_TEMPLATES } from "@/config/motionTemplates";
import { Platform, PLATFORM_LABELS, OPTIONAL_FORM_PLATFORMS, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";

/** Short Thai label for an aspect ratio, e.g. "แนวตั้ง (9:16)". */
function ratioLabel(ratio: string): string {
  if (ratio === "9:16") return "แนวตั้ง (9:16)";
  if (ratio === "16:9") return "แนวนอน (16:9)";
  if (ratio === "1:1") return "จัตุรัส (1:1)";
  if (ratio === "4:5") return "แนวตั้งแคบ (4:5)";
  return ratio;
}
import { MontageSceneAssetsEditor } from "@/features/requests/components/MontageSceneAssetsEditor";
import {
  assetPlaySeconds,
  estimateSuggestedVoiceSeconds,
  VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS,
} from "@/config/montage";

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

/** Small SVG preview of a template, mirroring the real render. */
function TemplateThumb({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 64 112" className="mx-auto mb-1.5 block h-28 w-16">
      <defs>
        <linearGradient id="tvScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b4655" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
      </defs>

      {id === "framed_cream" ? (
        <>
          <rect width="64" height="112" rx="8" fill="#f7ecda" />
          <rect x="7" y="8" width="50" height="78" rx="7" fill="#ffffff" />
          <rect x="10" y="11" width="44" height="72" rx="5" fill="url(#tvScreen)" />
          <path d="M12 100 q4 -3.5 8 0 t8 0 t8 0" fill="none" stroke="#c98a3f" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
          <g stroke="#b4762f" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity="0.85">
            <path d="M40 104 q9 -5 16 -10" />
            <path d="M45 101 q1 -4 -3 -6" />
            <path d="M50 98 q1 -4 -3 -6" />
          </g>
          <rect x="15" y="74" width="34" height="5" rx="2.5" fill="#ffffff" opacity="0.92" />
        </>
      ) : id === "editorial" ? (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <rect width="64" height="24" fill="#000" opacity="0.28" />
          <rect y="82" width="64" height="30" fill="#000" opacity="0.35" />
          <rect x="6" y="7" width="52" height="98" rx="6" fill="none" stroke="#ffffff" strokeWidth="1.3" opacity="0.85" />
          <circle cx="13" cy="15" r="1.8" fill="#f5b301" />
          <rect x="17" y="14" width="14" height="2" rx="1" fill="#f5b301" />
          <rect x="12" y="94" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      ) : id === "clean_frame" ? (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <g stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M9 20 V11 H18" />
            <path d="M55 20 V11 H46" />
            <path d="M9 84 V93 H18" />
            <path d="M55 84 V93 H46" />
          </g>
          <rect x="27" y="15" width="10" height="2.5" rx="1.2" fill="#f5b301" />
          <circle cx="14" cy="78" r="5" fill="none" stroke="#f5b301" strokeWidth="1.2" opacity="0.75" />
          <circle cx="14" cy="78" r="9" fill="none" stroke="#f5b301" strokeWidth="1" opacity="0.4" />
          <rect x="12" y="97" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      ) : (
        <>
          <rect width="64" height="112" rx="8" fill="url(#tvScreen)" />
          <rect x="12" y="96" width="40" height="6" rx="3" fill="#ffffff" opacity="0.92" />
        </>
      )}
    </svg>
  );
}

interface Props {
  requestId: string;
  jobId: string;
  /** Null when shown before the base video exists (audio-first voice approval step). */
  videoUrl: string | null;
  isAwaitingApproval: boolean;
  isAwaitingVoiceRecording?: boolean;
  isAwaitingVoiceApproval?: boolean;
  isAwaitingAnimationApproval?: boolean;
  isAwaitingFinalApproval?: boolean;
  /** Phase 7: reviewing the subtitle + motion-graphic captioned preview. */
  isAwaitingOverlayApproval?: boolean;
  /** Phase 7: gate to generate the remaining channels' aspect ratios. */
  isAwaitingAdditionalRatios?: boolean;
  /** Captioned primary-ratio preview shown at the overlay review step. */
  overlayPreviewUrl?: string | null;
  /** Subtitle languages saved on the job (seed the picker). */
  savedSubtitleLanguages?: ("th" | "en" | "zh")[];
  /** Motion template saved on the job (seed the template picker). */
  savedTemplate?: string | null;
  /** Background Travy render status: 'idle' | 'generating' | 'ready' | 'failed'. */
  tventVideoStatus?: string | null;
  /** Travy (EN+ZH) clip URL once its background render is ready. */
  tventClipUrl?: string | null;
  /** Pipeline is in Failed state — recovery UI is rendered elsewhere, so hide the processing spinner. */
  isPipelineFailed?: boolean;
  /** True only while an async background step is genuinely running — gates the
   *  processing spinner so it never shows at terminal/review states
   *  (Complete/Delivered/Publishing/AwaitingDistributionReview). */
  isProcessing?: boolean;
  /** Pipeline is generating the AI voiceover — show voice-specific processing text. */
  isGeneratingVoice?: boolean;
  voiceRecordingUrl?: string | null;
  voiceRecordingAssetId?: string | null;
  animatedVideoUrl?: string | null;
  savedMusicTrack?: string | null;
  finalClips?: any[];
  /** Aspect ratio of the primary distribution channel — the final review shows this ratio only. */
  primaryRatio?: string | null;
  scenes: ScenePlan[];
  hookThai: string | null;
  hookEnglish: string | null;
  scriptThai: string | null;
  scriptEnglish: string | null;
  captionThai: string | null;
  captionEnglish: string | null;
  captionChinese: string | null;
  sourceAssets?: UploadedAsset[];
  /** Canonical, index-stable source media (images + clips) for montage edits. */
  orderedAssets?: OrderedSourceAsset[];
  activeSceneIndex?: number;
  /** All rendered per-scene segments for the combined review (Approve-all flow). */
  sceneVideos?: { sceneNumber: number; sceneIndex: number; url: string; assetId: string }[];
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
  isAwaitingOverlayApproval = false,
  isAwaitingAdditionalRatios = false,
  overlayPreviewUrl = null,
  savedSubtitleLanguages,
  savedTemplate = null,
  tventVideoStatus = null,
  tventClipUrl = null,
  isPipelineFailed = false,
  isProcessing = false,
  isGeneratingVoice = false,
  voiceRecordingUrl = null,
  voiceRecordingAssetId = null,
  // animatedVideoUrl is still accepted (page passes it) but no longer rendered
  // here — the animation/graphic review moved to the final-approval step.
  savedMusicTrack = null,
  finalClips = [],
  primaryRatio = null,
  scenes,
  hookThai,
  hookEnglish,
  scriptThai,
  scriptEnglish,
  captionThai,
  captionEnglish,
  captionChinese,
  orderedAssets = [],
  activeSceneIndex = 0,
  sceneVideos = [],
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
  // Which scene the per-scene editor targets in the combined review. Defaults to
  // the prop but becomes user-selectable via the per-scene "edit" buttons.
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(activeSceneIndex);
  const safeActiveSceneIndex = Math.min(Math.max(selectedSceneIndex, 0), Math.max(editScenes.length - 1, 0));
  const activeEditScene = editScenes[safeActiveSceneIndex];

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
  // Distribution channels chosen at voice approval, in click order. The FIRST
  // chosen channel is the PRIMARY — it sets the base video's aspect ratio.
  // Travy App (Tvent) is always included (mandatory, locked) and is not counted
  // as a primary click; its export adopts the primary's ratio.
  const [channelOrder, setChannelOrder] = useState<Platform[]>([]);
  const primaryChannel: Platform = channelOrder[0] ?? Platform.TventApp;
  // Ratio derived from the in-panel channel picker (voice-approval step). Named
  // distinctly from the `primaryRatio` PROP, which the page computes from the
  // saved primary channel and is the source of truth at later steps where
  // `channelOrder` is empty.
  const primaryChannelRatio = PLATFORM_ASPECT_RATIOS[primaryChannel];
  const toggleChannel = (p: Platform) =>
    setChannelOrder((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  // Phase 7 (deferred): subtitle-language selection lives with the caption
  // pipeline. Removed from this step for now — exports carry no captions.
  const [voiceApproving, setVoiceApproving] = useState(false);
  const [voiceRecreating, setVoiceRecreating] = useState(false);
  const [displayedVoiceUrl, setDisplayedVoiceUrl] = useState<string | null>(voiceRecordingUrl);
  const [displayedVoiceAssetId, setDisplayedVoiceAssetId] = useState<string | null>(voiceRecordingAssetId);

  // First voice step — suggested MAX voiceover length, estimated from the
  // uploaded media (each still ≈ a few seconds, each clip its real footage), and
  // the measured length of the generated voice. Both are probed client-side from
  // media metadata (the model stores no clip duration). When the voice runs more
  // than VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS beyond the suggestion, approval
  // is blocked so the pictures aren't forced to stretch/blank far past comfort.
  const [clipSecondsTotal, setClipSecondsTotal] = useState<number | null>(null);
  const [voiceSeconds, setVoiceSeconds] = useState<number | null>(null);
  const imageCount = orderedAssets.filter((a) => a.kind === "image").length;
  const suggestedVoiceSeconds =
    clipSecondsTotal == null
      ? null
      : estimateSuggestedVoiceSeconds({ imageCount, clipSecondsTotal });
  const voiceTooLong =
    suggestedVoiceSeconds != null &&
    voiceSeconds != null &&
    voiceSeconds > suggestedVoiceSeconds + VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS;

  // Probe the uploaded clips' real durations once, at the voice-approval step.
  useEffect(() => {
    if (!isAwaitingVoiceApproval) return;
    const clips = orderedAssets.filter((a) => a.kind === "clip");
    if (clips.length === 0) {
      setClipSecondsTotal(0);
      return;
    }
    let cancelled = false;
    let done = 0;
    let sum = 0;
    const els: HTMLVideoElement[] = [];
    const cleanup = (v: HTMLVideoElement) => {
      v.removeAttribute("src");
      try { v.load(); } catch { /* ignore */ }
    };
    const finish = (v: HTMLVideoElement, d: number) => {
      if (cancelled) return;
      if (Number.isFinite(d) && d > 0) sum += d;
      done += 1;
      if (done === clips.length) setClipSecondsTotal(sum);
      cleanup(v);
    };
    clips.forEach((c) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => finish(v, v.duration);
      v.onerror = () => finish(v, 0);
      v.src = c.url;
      els.push(v);
    });
    return () => {
      cancelled = true;
      els.forEach(cleanup);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwaitingVoiceApproval, orderedAssets]);
  const [animationApproving, setAnimationApproving] = useState(false);
  const [finalApproving, setFinalApproving] = useState(false);
  // Phase 7 — subtitle languages chosen at the merged-review step (seed from the
  // job, default to Thai for the requester's own channels). Travy always EN+ZH.
  const [subtitleLangs, setSubtitleLangs] = useState<("th" | "en" | "zh")[]>(
    savedSubtitleLanguages && savedSubtitleLanguages.length > 0
      ? savedSubtitleLanguages.slice(0, 2)
      : ["th"]
  );
  // At most two subtitle languages may be shown at once (a third would crowd the
  // frame). Selecting a third when two are already chosen is ignored.
  const MAX_SUBTITLE_LANGS = 2;
  const toggleSubtitleLang = (l: "th" | "en" | "zh") =>
    setSubtitleLangs((prev) => {
      if (prev.includes(l)) return prev.filter((x) => x !== l);
      if (prev.length >= MAX_SUBTITLE_LANGS) return prev;
      return [...prev, l];
    });
  const [overlayApproving, setOverlayApproving] = useState(false);
  const [additionalGenerating, setAdditionalGenerating] = useState(false);
  const [editingSubtitle, setEditingSubtitle] = useState(false);
  // Phase 7 — chosen motion template (default "none" = clean video + subtitles).
  const [selectedTemplate, setSelectedTemplate] = useState<string>(savedTemplate ?? "none");

  const voiceRecreatingRef = useRef(false);
  useEffect(() => { voiceRecreatingRef.current = voiceRecreating; }, [voiceRecreating]);

  useEffect(() => {
    // While a regeneration is in flight the server briefly has no voice asset
    // (processedVoiceAssetId is nulled). A background router.refresh() during
    // that window must not clobber the currently displayed audio with null.
    if (voiceRecreatingRef.current && !voiceRecordingUrl) return;
    setDisplayedVoiceUrl(voiceRecordingUrl);
    setDisplayedVoiceAssetId(voiceRecordingAssetId);
  }, [voiceRecordingUrl, voiceRecordingAssetId]);

  // Combined preview modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVoiceRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);

  const handleApproveVoice = async () => {
    setVoiceApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Primary channel first (sets the base ratio); Travy App always included.
        body: JSON.stringify({
          jobId,
          targetPlatforms: [...channelOrder, Platform.TventApp],
        }),
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

  const handleRegenerateVoice = async () => {
    // Compare against what is actually displayed right now — not the
    // server-rendered prop, which can be stale if a previous regeneration
    // finished without a completed router.refresh().
    const previousAssetId = displayedVoiceAssetId;

    setVoiceRecreating(true);
    setVoiceSeconds(null); // re-measured once the new voice loads
    setError(null);
    try {
      // Persist any script edits first — the server reads approvedScriptThai
      // when synthesizing, so the regenerated voice speaks the edited text.
      if (editScriptThai.trim() && editScriptThai !== (scriptThai ?? "")) {
        const patchRes = await fetch(`/api/requests/${requestId}/script`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, scriptThai: editScriptThai }),
        });
        if (!patchRes.ok) {
          const body = await patchRes.json().catch(() => ({}));
          throw new Error(body.error ?? "ไม่สามารถบันทึกบทพูดที่แก้ไขได้");
        }
      }

      const res = await fetch(`/api/requests/${requestId}/voice/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้างเสียงพากย์ใหม่ได้");
      }

      const maxAttempts = 90;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        const statusRes = await fetch(`/api/requests/${requestId}/pipeline-status`, {
          cache: "no-store",
        });
        if (!statusRes.ok) continue;

        const status = await statusRes.json();
        if (status.currentStep === VideoGenerationStep.Failed) {
          throw new Error(
            status.voiceError
              ? `ไม่สามารถสร้างเสียงพากย์ใหม่ได้: ${status.voiceError}`
              : "ไม่สามารถสร้างเสียงพากย์ใหม่ได้ กรุณาลองอีกครั้งหรือติดต่อแอดมิน"
          );
        }

        if (
          status.currentStep === VideoGenerationStep.AwaitingVoiceApproval &&
          status.processedVoiceAssetId &&
          status.processedVoiceUrl &&
          status.processedVoiceAssetId !== previousAssetId
        ) {
          setDisplayedVoiceAssetId(status.processedVoiceAssetId);
          setDisplayedVoiceUrl(status.processedVoiceUrl);
          router.refresh();
          return;
        }
      }

      throw new Error("หมดเวลารอการสร้างเสียงพากย์ใหม่ กรุณาลองอีกครั้ง");
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
        body: JSON.stringify({
          jobId,
          selectedMusicTrack,
        }),
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

  // Phase 7 (deferred): "regenerate animation" returns with the motion-graphics
  // + subtitle step that follows the merged-video review.

  const [audioRevising, setAudioRevising] = useState(false);
  const handleReviseAudioMerge = async () => {
    setAudioRevising(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/revise-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถแก้ไขการรวมเสียงได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setAudioRevising(false);
    }
  };

  const handleApproveFinal = async () => {
    setFinalApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          subtitleLanguages: subtitleLangs,
          selectedMotionTemplate: selectedTemplate,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถดำเนินการขั้นตอนถัดไปได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setFinalApproving(false);
    }
  };

  // Phase 7 — overlay (subtitle + motion graphic) review handlers.
  const handleApproveOverlay = async () => {
    setOverlayApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/approve-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถอนุมัติซับไตเติ้ลและกราฟิกได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setOverlayApproving(false);
    }
  };

  const handleEditSubtitleVideo = async () => {
    setEditingSubtitle(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/edit-subtitle-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถย้อนกลับไปแก้ไขได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setEditingSubtitle(false);
    }
  };

  const handleGenerateAdditionalRatios = async () => {
    setAdditionalGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/generate-additional-ratios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถสร้างอัตราส่วนเพิ่มเติมได้");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setAdditionalGenerating(false);
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

  const updateScene = (index: number, patch: Partial<ScenePlan>) => {
    setEditScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  };

  /** Even-split duration allocation, remainder on the last asset; min 1s each. */
  const allocateDurations = (count: number, totalSeconds: number): number[] => {
    if (count <= 0) return [];
    const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : count;
    const per = Math.max(1, Math.floor(total / count));
    const arr = new Array<number>(count).fill(per);
    const remainder = total - per * count;
    if (remainder > 0) arr[count - 1] = per + remainder;
    return arr;
  };

  /** Trim-aware: a clip with an in/out window keeps that window as its duration;
   *  only stills / untrimmed clips share the scene's remaining budget. The scene
   *  auto-grows if pinned clips exceed the target. */
  const reallocateSceneAssets = (scene: ScenePlan): ScenePlan => {
    if (!scene.assets || scene.assets.length === 0) return scene;
    const isTrimmedClip = (a: MontageSceneAsset) =>
      a.kind === "clip" &&
      Number.isFinite(a.trimStartSeconds) &&
      Number.isFinite(a.trimEndSeconds) &&
      (a.trimEndSeconds as number) > (a.trimStartSeconds as number);
    const pinned = scene.assets.map((a) => (isTrimmedClip(a) ? assetPlaySeconds(a) : null));
    const pinnedTotal = pinned.reduce((sum: number, d) => sum + (d ?? 0), 0);
    const flexCount = pinned.filter((d) => d == null).length;
    const flexBudget = Math.max(flexCount, (Number(scene.durationSeconds) || 0) - pinnedTotal);
    const flexDurations = allocateDurations(flexCount, flexBudget);
    let c = 0;
    const assets = scene.assets.map((a, i) => ({
      ...a,
      durationSeconds: pinned[i] ?? flexDurations[c++] ?? 1,
    }));
    const durationSeconds = assets.reduce((sum, a) => sum + (Number(a.durationSeconds) || 0), 0);
    return { ...scene, assets, durationSeconds };
  };

  /** Persist montage asset edits for a scene during revision: keep scene.assets,
   *  clear imageIndexes (legacy Veo morph rules stay dormant), resize the scene. */
  const updateSceneAssets = (index: number, assets: MontageSceneAsset[]) => {
    const total = assets.reduce((sum, a) => sum + assetPlaySeconds(a), 0);
    updateScene(index, {
      assets,
      imageIndexes: [],
      ...(total > 0 ? { durationSeconds: total } : {}),
    });
  };

  /** Edit a scene's duration and redistribute it across its montage assets. */
  const updateSceneDurationMontage = (index: number, seconds: number) => {
    setEditScenes((prev) =>
      prev.map((scene, i) =>
        i === index ? reallocateSceneAssets({ ...scene, durationSeconds: Math.max(1, seconds) }) : scene
      )
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
      router.refresh();
      setIsSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsSubmitting(false);
    }
  };

  /** Go back to the scene-design step to edit the whole plan (not one scene). */
  const handleReopenSceneDesign = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/scene-design/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถกลับไปแก้ไขแผนฉากได้");
      }
      router.refresh();
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
          // Re-render only the scene being edited; others are kept.
          sceneIndex: safeActiveSceneIndex,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งขอแก้ไขได้");
      }
      router.refresh();
      setIsSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Video card — hidden when shown before the base video exists
          (audio-first voice approval step) */}
      <Card className="mb-6">
        {/* Combined review: every scene's video, each revised individually,
            then "Approve all" merges them into one. In revise mode only the
            scene being edited is shown, to avoid confusing it with the others. */}
        {isAwaitingApproval && sceneVideos.length > 0 ? (
          mode === "review" ? (
            <>
              <h2 className="mb-1 text-base font-semibold text-slate-900">
                ตรวจสอบวิดีโอแต่ละฉาก
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                ดูวิดีโอแต่ละฉากด้านล่าง แก้ไขทีละฉากได้ตามต้องการ เมื่อพอใจทุกฉากแล้วกด “อนุมัติทุกฉาก” เพื่อรวมเป็นวิดีโอเดียว
              </p>
              <div className="flex flex-col gap-4">
                {sceneVideos.map((sv) => (
                  <div key={sv.assetId} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                        ฉาก {sv.sceneNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setSelectedSceneIndex(sv.sceneIndex); setMode("revise"); setError(null); }}
                        disabled={isSubmitting}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        แก้ไขฉากนี้
                      </button>
                    </div>
                    <video
                      src={sv.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="mx-auto max-h-[420px] w-auto rounded-lg bg-black object-contain"
                    />
                    {editScenes[sv.sceneIndex]?.visualDescriptionThai && (
                      <p className="mt-2 text-xs text-slate-500">
                        {editScenes[sv.sceneIndex]?.visualDescriptionThai}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            // Revise mode — show ONLY the scene currently being edited.
            (() => {
              const sv = sceneVideos.find((v) => v.sceneIndex === safeActiveSceneIndex);
              return (
                <>
                  <h2 className="mb-3 text-base font-semibold text-slate-900">
                    กำลังแก้ไข ฉาก {safeActiveSceneIndex + 1}
                  </h2>
                  {sv && (
                    <video
                      key={sv.assetId}
                      src={sv.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="mx-auto max-h-[420px] w-auto rounded-lg bg-black object-contain"
                    />
                  )}
                </>
              );
            })()
          )
        ) : (
          videoUrl && (
            <>
              <h2 className="mb-3 text-base font-semibold text-slate-900">
                วิดีโอฉากที่สร้างจากรูปและคลิปของคุณ
              </h2>
              <video
                src={videoUrl}
                controls
                playsInline
                className="mx-auto max-h-[480px] w-auto rounded-lg bg-black object-contain"
              />
            </>
          )
        )}

        {isAwaitingApproval && (
          <div className="mt-4">
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {mode === "review" ? (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {sceneVideos.length === 0 && (
                  <button
                    onClick={() => setMode("revise")}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    ขอแก้ไขวีดิโอ
                  </button>
                )}
                {sceneVideos.length > 0 && (
                  <button
                    type="button"
                    onClick={handleReopenSceneDesign}
                    disabled={isSubmitting}
                    className="mr-auto rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="กลับไปแก้ไขแผนฉาก (รูป/คลิป ลำดับ ความยาว และบทฉาก) แล้วสร้างวิดีโอใหม่"
                  >
                    ← แก้ไขวีดิโอ
                  </button>
                )}
                <Button onClick={handleApprove} loading={isSubmitting} disabled={isSubmitting}>
                  {sceneVideos.length > 0 ? "อนุมัติทุกฉากและรวมวิดีโอ" : "อนุมัติวีดิโอนี้"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {sceneVideos.length > 0 && (
                  <span className="mr-auto text-sm font-medium text-amber-700">
                    กำลังแก้ไข ฉาก {safeActiveSceneIndex + 1}
                  </span>
                )}
                <button
                  onClick={() => { setMode("review"); setError(null); }}
                  disabled={isSubmitting}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <Button onClick={handleReviseSubmit} loading={isSubmitting} disabled={isSubmitting}>
                  {sceneVideos.length > 0 ? "สร้างฉากนี้ใหม่" : "ส่งขอสร้างวีดิโอใหม่"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Voice Approval Phase - iAppTTS AI-generated voice */}
        {isAwaitingVoiceApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-blue-100 bg-blue-50/50">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ขั้นตอนที่ 2: ตรวจสอบเสียงพากย์ AI</h3>
              <p className="text-sm text-slate-500 mb-4">
                AI สร้างเสียงพากย์ภาษาไทยจากบทพูดที่คุณอนุมัติ ฟังเสียงด้านล่างแล้วอนุมัติหรือสร้างเสียงใหม่ได้
              </p>

              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-700">การสร้างเสียงพากย์ล้มเหลว</p>
                  <p className="mt-0.5 text-sm text-red-600 break-words">{error}</p>
                </div>
              )}

              <div className="mb-3 rounded-lg border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  บทพูด
                </p>
                <textarea
                  value={editScriptThai}
                  onChange={(e) => setEditScriptThai(e.target.value)}
                  disabled={voiceRecreating || voiceApproving}
                  rows={4}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none resize-none disabled:bg-slate-50 disabled:text-slate-400"
                  placeholder="บทพูดภาษาไทย"
                />
                <p className="mt-1 text-xs text-slate-400">
                  แก้ไขบทพูดได้ตามต้องการ แล้วกด &quot;สร้างเสียงพากย์ใหม่&quot; เพื่อให้ AI อ่านบทที่แก้ไข
                </p>
              </div>

              <div className="mb-4">
                <button
                  type="button"
                  onClick={handleRegenerateVoice}
                  disabled={voiceRecreating || voiceApproving || !editScriptThai.trim()}
                  className="rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {voiceRecreating ? "กำลังสร้างเสียงพากย์ใหม่..." : "สร้างเสียงพากย์ใหม่"}
                </button>
                <p className="mt-1.5 text-xs text-slate-400">
                  ระบบ AI จะสร้างเสียงใหม่จากบทพูดด้านบน
                </p>
              </div>

              {voiceRecreating ? (
                /* Unmount the old <audio> while regenerating — this immediately
                   stops any playback of the obsolete voice and guarantees the
                   element is recreated with the new src once iAppTTS finishes. */
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                  <p className="text-sm text-blue-700">AI กำลังสร้างเสียงพากย์ใหม่จากบทพูดด้านบน...</p>
                </div>
              ) : displayedVoiceUrl ? (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-blue-600 mb-1">เสียงพากย์ AI</p>
                  <audio
                    key={displayedVoiceAssetId ?? displayedVoiceUrl}
                    src={displayedVoiceUrl}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const d = (e.target as HTMLAudioElement).duration;
                      if (Number.isFinite(d) && d > 0) setVoiceSeconds(d);
                    }}
                    className="w-full"
                  />
                </div>
              ) : (
                <p className="text-sm text-amber-600 mb-4">ไม่พบไฟล์เสียงพากย์ กรุณาสร้างเสียงใหม่</p>
              )}

              {/* Suggested max length (from uploaded media) + gate. A voice that
                  overshoots by more than the tolerance can't be approved — the
                  requester shortens the script and regenerates. */}
              {suggestedVoiceSeconds != null && suggestedVoiceSeconds > 0 && (
                <div
                  className={`mb-4 rounded-lg border p-3 ${
                    voiceTooLong ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      ความยาวเสียงพากย์ที่แนะนำ
                    </p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                      ≈ {Math.round(suggestedVoiceSeconds)} วินาที
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    ประเมินจากไฟล์ที่อัปโหลด (รูปภาพนับ 5 วินาที/รูป และคลิปนับตามความยาวจริง)
                    {voiceSeconds != null && (
                      <>
                        {" "}— เสียงพากย์ปัจจุบัน{" "}
                        <span className={`font-semibold ${voiceTooLong ? "text-red-600" : "text-slate-700"}`}>
                          {Math.round(voiceSeconds)} วินาที
                        </span>
                      </>
                    )}
                  </p>
                  {voiceTooLong && (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      เสียงพากย์ยาวเกินกว่าที่แนะนำมากกว่า {VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS} วินาที —
                      กรุณาแก้บทพูดให้สั้นลงแล้วกด “สร้างเสียงพากย์ใหม่” ก่อนอนุมัติ
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ช่องทางในการเผยแพร่
                </p>
                <p className="mb-3 text-xs text-slate-400">
                  เลือกได้มากกว่าหนึ่งช่องทาง ช่องทางแรกที่เลือกคือช่องทางหลัก ระบบจะสร้างวิดีโอในอัตราส่วนของช่องทางหลัก (ช่องทางอื่นจะครอบตัดจากวิดีโอนี้)
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {/* Travy App — mandatory, locked, dark grey. Its ratio mirrors
                      the primary channel's ratio. */}
                  <div
                    aria-disabled
                    className="cursor-not-allowed rounded-md border border-slate-300 bg-slate-200 px-3 py-2 text-left text-sm text-slate-700"
                  >
                    <span className="block font-medium">
                      {PLATFORM_LABELS[Platform.TventApp]}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {ratioLabel(primaryChannelRatio)} · ค่าเริ่มต้น
                    </span>
                  </div>

                  {OPTIONAL_FORM_PLATFORMS.map((p) => {
                    const isSelected = channelOrder.includes(p);
                    const isPrimary = primaryChannel === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleChannel(p)}
                        disabled={voiceRecreating || voiceApproving}
                        className={`relative rounded-md border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"
                        }`}
                      >
                        {isPrimary && (
                          <span className="absolute right-1.5 top-1.5 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            หลัก
                          </span>
                        )}
                        <span className="block font-medium">{PLATFORM_LABELS[p]}</span>
                        <span className="block text-xs text-slate-400">
                          {ratioLabel(PLATFORM_ASPECT_RATIOS[p])}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                <Button
                  onClick={handleApproveVoice}
                  loading={voiceApproving}
                  disabled={voiceRecreating || voiceApproving || voiceTooLong}
                >
                  อนุมัติเสียงพากย์
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Animation Approval Phase */}
        {isAwaitingAnimationApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-purple-100 bg-purple-50/40">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ขั้นตอนที่ 3.5: เลือกเพลงพื้นหลังและรวมเสียงเข้าในวีดิโอ</h3>
              <p className="text-sm text-slate-500 mb-4">
                เลือกเพลงประกอบสำหรับวิดีโอ แล้วกดอนุมัติเพื่อให้ระบบรวมเสียงพากย์ เพลงพื้นหลัง และวิดีโอเข้าด้วยกัน
                ขั้นตอนตรวจสอบ Animation และ Graphic จะอยู่ในขั้นตอนถัดไป หลังจากรวมเสียงและวิดีโอเรียบร้อยแล้ว
              </p>

              {/* Voice audio playback */}
              {displayedVoiceUrl && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-purple-700 mb-1">เสียงพากย์ AI</p>
                  <audio
                    key={displayedVoiceAssetId ?? displayedVoiceUrl}
                    src={displayedVoiceUrl}
                    controls
                    preload="metadata"
                    className="w-full"
                  />
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

              {/* Distribution channels are chosen at the voice-approval step. */}
              {/* Phase 7 (deferred): subtitle-language picker removed — captions
                  return with the Phase 7 caption/timeline pipeline. */}

              <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                <Button
                  onClick={handleApproveAnimation}
                  loading={animationApproving}
                  disabled={animationApproving || selectedMusicTrack === null}
                >
                  อนุมัติและรวมเสียงเข้าในวีดิโอ →
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Final Video Approval Phase */}
        {isAwaitingFinalApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-green-100 bg-green-50/30">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ตรวจสอบวิดีโอที่รวมเสียงแล้ว</h3>
              <p className="text-sm text-slate-500 mb-4">
                วิดีโอของคุณรวมเสียงพากย์และเพลงพื้นหลัง (ปรับระดับให้เสียงพูดเด่นชัด) ตามอัตราส่วนของช่องทางหลักที่เลือกเรียบร้อยแล้ว ตรวจสอบได้ด้านล่าง ขั้นตอนถัดไปคือการเพิ่ม Motion Graphic และซับไตเติ้ล/คำบรรยาย
              </p>

              {finalClips.length > 0 ? (() => {
                // Aspect ratio is fixed by the PRIMARY distribution channel — no
                // ratio selector. Show that clip (fallback to the first export).
                const primaryClip = finalClips.find((c) => c.videoRatio === primaryRatio) || finalClips[0];
                return (
                  <div className="space-y-4">
                    {/* Preview video at the primary channel's aspect ratio */}
                    <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[500px]">
                      <video
                        key={primaryClip.id}
                        src={primaryClip.storageUrl}
                        controls
                        className="max-h-[480px] w-auto object-contain rounded"
                      />
                    </div>

                    {/* Phase 7 — choose subtitle languages for YOUR channels.
                        These seed the subtitle + motion-graphic step. (Travy
                        always gets English + Chinese, handled automatically.) */}
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <p className="text-sm font-medium text-slate-800">เลือกภาษาซับไตเติ้ลสำหรับช่องทางของคุณ (สูงสุด 2 ภาษา)</p>
                      <p className="text-xs text-slate-400 mt-0.5 mb-3">
                        ใช้เป็นข้อมูลตั้งต้นในขั้นตอนเพิ่มซับไตเติ้ลและ Motion Graphic (ช่อง Travy จะมีซับไตเติ้ลอังกฤษ+จีนโดยอัตโนมัติ)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { code: "th", label: "ไทย" },
                          { code: "en", label: "อังกฤษ" },
                          { code: "zh", label: "จีน" },
                        ] as const).map(({ code, label }) => {
                          const selected = subtitleLangs.includes(code);
                          // Once two are chosen, the unselected option is locked
                          // (max two languages on screen at once).
                          const atMax = !selected && subtitleLangs.length >= MAX_SUBTITLE_LANGS;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggleSubtitleLang(code)}
                              disabled={atMax}
                              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                                selected
                                  ? "border-green-300 bg-green-50 text-green-700"
                                  : atMax
                                    ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
                                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {selected ? "✓ " : ""}{label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Phase 7 — motion-graphic template picker (default None). */}
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <p className="text-sm font-medium text-slate-800">เลือกเทมเพลตกราฟิก (Motion Template)</p>
                      <p className="text-xs text-slate-400 mt-0.5 mb-3">
                        เลือกสไตล์กรอบและกราฟิกที่จะซ้อนบนวิดีโอ (ค่าเริ่มต้น: ไม่มีเทมเพลต — วิดีโอเต็มจอ + ซับไตเติ้ล)
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {MOTION_TEMPLATES.map((tpl) => {
                          const active = selectedTemplate === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => setSelectedTemplate(tpl.id)}
                              className={`shrink-0 w-24 rounded-lg border p-2 text-left transition ${
                                active
                                  ? "border-green-400 ring-2 ring-green-200 bg-green-50"
                                  : "border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              <TemplateThumb id={tpl.id} />
                              <p className="text-[11px] font-medium leading-tight text-slate-700">{tpl.name}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
                      <a
                        href={primaryClip.storageUrl}
                        download={`final_video_${primaryClip.videoRatio.replace(":", "_")}.mp4`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        ดาวน์โหลด ({primaryClip.videoRatio})
                      </a>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handleReviseAudioMerge}
                          disabled={audioRevising || finalApproving}
                          className="rounded-md border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        >
                          {audioRevising ? "กำลังย้อนกลับ..." : "แก้ไขการรวมเสียง"}
                        </button>
                        <Button
                          onClick={handleApproveFinal}
                          loading={finalApproving}
                          disabled={finalApproving || audioRevising || subtitleLangs.length === 0}
                        >
                          อนุมัติและเพิ่มซับไตเติ้ล/Motion Graphic →
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <p className="text-sm text-slate-400">ไม่พบวิดีโอที่สร้างเสร็จแล้ว กรุณาติดต่อแอดมิน</p>
              )}
            </Card>
          </div>
        )}

        {/* Phase 7 — subtitle + motion-graphic overlay review (captioned preview) */}
        {isAwaitingOverlayApproval && (
          <div className="mt-6 space-y-6">
            <Card className="border-green-100 bg-green-50/30">
              <h3 className="text-base font-semibold text-slate-900 mb-2">ตรวจสอบซับไตเติ้ลและ Motion Graphic</h3>
              <p className="text-sm text-slate-500 mb-4">
                เพิ่มซับไตเติ้ล (ภาษาที่เลือก) และ Motion Graphic ซ้อนบนวิดีโอที่รวมเสียงแล้ว ตรวจสอบตัวอย่างด้านล่าง หากพอใจให้กดอนุมัติเพื่อรวมเป็นวิดีโอสุดท้าย
              </p>

              {overlayPreviewUrl ? (
                <>
                  <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[500px]">
                    <video
                      key={overlayPreviewUrl}
                      src={overlayPreviewUrl}
                      controls
                      className="max-h-[480px] w-auto object-contain rounded"
                    />
                  </div>
                  <div className="mt-2 flex justify-start">
                    <a
                      href={overlayPreviewUrl}
                      download={`subtitled_video_${(primaryRatio ?? "9:16").replace(":", "_")}.mp4`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      ดาวน์โหลดวิดีโอที่มีซับไตเติ้ล{primaryRatio ? ` (${primaryRatio})` : ""}
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">กำลังเตรียมตัวอย่าง...</p>
              )}

              {/* Subtitle languages + template were chosen at the previous
                  (merged-video) step. To change them, use "แก้ไขเทมเพลต/ภาษา"
                  to go back — this step is only for reviewing/approving the
                  captioned result. */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleEditSubtitleVideo}
                  disabled={editingSubtitle || overlayApproving}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {editingSubtitle ? "กำลังย้อนกลับ..." : "← แก้ไขเทมเพลต/ภาษา"}
                </button>
                <Button
                  onClick={handleApproveOverlay}
                  loading={overlayApproving}
                  disabled={overlayApproving || editingSubtitle || !overlayPreviewUrl}
                >
                  อนุมัติและรวมเป็นวิดีโอสุดท้าย →
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Phase 7 — gate to generate the remaining channels' aspect ratios */}
        {isAwaitingAdditionalRatios && (
          <div className="mt-6 space-y-6">
            <Card className="border-blue-100 bg-blue-50/30">
              <h3 className="text-base font-semibold text-slate-900 mb-2">สร้างอัตราส่วนสำหรับช่องทางอื่น</h3>
              <p className="text-sm text-slate-500 mb-4">
                วิดีโอช่องทางหลักพร้อมแล้ว กดปุ่มด้านล่างเพื่อสร้างวิดีโอ (พร้อมซับไตเติ้ลและ Motion Graphic) สำหรับช่องทางอื่นที่มีอัตราส่วนต่างกัน หลังจากนั้นระบบจะสร้างวิดีโอสำหรับช่อง Travy ให้อัตโนมัติ
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={handleGenerateAdditionalRatios}
                  loading={additionalGenerating}
                  disabled={additionalGenerating}
                >
                  สร้างอัตราส่วนช่องทางอื่น →
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Phase 7 — automatic Travy (EN+ZH) render status */}
        {tventVideoStatus && tventVideoStatus !== "idle" && (
          <Card className="mt-6 border-slate-100 bg-slate-50/60">
            <h3 className="text-base font-semibold text-slate-900 mb-2">วิดีโอสำหรับช่อง Travy (อังกฤษ + จีน)</h3>
            {tventVideoStatus === "generating" && (
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้) คุณสามารถดูได้เมื่อสร้างเสร็จ
              </div>
            )}
            {tventVideoStatus === "ready" && (
              tventClipUrl ? (
                <div className="space-y-3">
                  <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[420px]">
                    <video src={tventClipUrl} controls className="max-h-[400px] w-auto object-contain rounded" />
                  </div>
                  <a
                    href={tventClipUrl}
                    download="final_tvent.mp4"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    ดาวน์โหลดวิดีโอ Travy
                  </a>
                </div>
              ) : (
                <p className="text-sm text-slate-400">วิดีโอ Travy พร้อมแล้ว</p>
              )
            )}
            {tventVideoStatus === "failed" && (
              <p className="text-sm text-red-600">การสร้างวิดีโอ Travy ล้มเหลว กรุณาติดต่อแอดมิน</p>
            )}
          </Card>
        )}

        {/* Processing Indicator — shown ONLY while an async background step is
            genuinely running. Gated on isProcessing so it never lingers at
            terminal/review states (Complete/Delivered/Publishing/DistributionReview),
            which fixes the phantom "กำลังประมวลผล..." spinner. */}
        {!isPipelineFailed && isProcessing && (
          <Card className="mt-6 border-slate-100 bg-slate-50 p-5 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4" />
            {isGeneratingVoice ? (
              <>
                <h4 className="text-sm font-semibold text-slate-800">กำลังสร้างเสียงพากย์ AI...</h4>
                <p className="mt-1 text-xs text-slate-400 max-w-[280px]">
                  AI กำลังสร้างเสียงพากย์ภาษาไทยจากบทพูดที่อนุมัติ ขั้นตอนนี้ใช้เวลา 5-15 วินาที
                </p>
              </>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-slate-800">กำลังประมวลผลวิดีโอของคุณ...</h4>
                <p className="mt-1 text-xs text-slate-400 max-w-[280px]">
                  AI กำลังรวมเสียงพากย์และเพลงพื้นหลัง (ปรับระดับให้เสียงพูดเด่นชัด) เข้ากับวิดีโอตามอัตราส่วนของช่องทางหลักด้วย FFmpeg ขั้นตอนนี้ใช้เวลา 10-30 วินาที
                </p>
              </>
            )}
          </Card>
        )}

      </Card>

      {/* iAppTTS voice generation notice - shown while AI is generating */}
      {/* (The pipeline poller handles the GeneratingVoice step automatically) */}

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
              <strong>ส่งขอสร้างวีดิโอใหม่</strong> เพื่อเรนเดอร์วิดีโอฉากนี้จากรูปและคลิปใหม่อีกครั้ง
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
              {activeEditScene && (
                <div
                  key={activeEditScene.sceneNumber}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">
                      Scene {safeActiveSceneIndex + 1} of {editScenes.length}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={activeEditScene.durationSeconds}
                      onChange={(e) =>
                        updateSceneDurationMontage(safeActiveSceneIndex, Number(e.target.value) || 1)
                      }
                      className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                    />
                    <span className="text-xs text-slate-400">seconds</span>
                  </div>
                  <textarea
                    value={activeEditScene.visualDescriptionThai ?? ""}
                    onChange={(e) => updateSceneDescription(safeActiveSceneIndex, e.target.value)}
                    rows={3}
                    className={`${ta} text-sm text-slate-700`}
                  />
                  <MontageSceneAssetsEditor
                    orderedAssets={orderedAssets}
                    assets={activeEditScene.assets ?? []}
                    sceneDurationSeconds={activeEditScene.durationSeconds}
                    onChange={(assets) => updateSceneAssets(safeActiveSceneIndex, assets)}
                  />
                </div>
              )}
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

          {!isAwaitingVoiceApproval && (scriptThai ?? scriptEnglish) && (
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
                src={videoUrl ?? undefined}
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
