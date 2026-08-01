"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MontageSceneAsset, ScenePlan, StoryboardScene } from "@/domain/models/VideoGenerationJob";
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
import { RetentionNoteText } from "@/features/requests/components/RetentionNoteText";
import { spaceExpiryNote } from "@/lib/retentionNotes";
import {
  assetPlaySeconds,
  estimateSuggestedVoiceSeconds,
  estimateStoryboardTotalRange,
  suggestVoiceDurationRange,
  VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS,
} from "@/config/montage";

const ta =
  "w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300";

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
  isAwaitingVoiceApproval?: boolean;
  isAwaitingAnimationApproval?: boolean;
  isAwaitingFinalApproval?: boolean;
  /** Phase 7: reviewing the subtitle + motion-graphic captioned preview. */
  isAwaitingOverlayApproval?: boolean;
  /** Primary-ratio subtitle/Motion Graphic render is currently running. */
  isGeneratingOverlay?: boolean;
  /** Phase 7: gate to generate the remaining channels' aspect ratios. */
  isAwaitingAdditionalRatios?: boolean;
  /**
   * The remaining channels' videos are rendering one-by-one (in generation
   * order). Shows the per-channel grid: each finished channel's video is
   * playable/downloadable immediately while the rest keep generating.
   */
  isGeneratingAdditionalRatios?: boolean;
  /**
   * Per-channel captioned videos (page-computed, targetPlatforms order minus
   * Travy = the order the ratios are generated in). `url`/`assetId` are null
   * until that channel's ratio has rendered.
   */
  channelVideos?: {
    platform: string;
    label: string;
    ratio: string | null;
    url: string | null;
    assetId: string | null;
  }[];
  /** Captioned primary-ratio preview shown at the overlay review step. */
  overlayPreviewUrl?: string | null;
  /** Subtitle languages saved on the job (seed the picker). */
  savedSubtitleLanguages?: ("th" | "en" | "zh")[];
  /** Motion template saved on the job (seed the template picker). */
  savedTemplate?: string | null;
  /** Background Travy render status: 'idle' | 'generating' | 'ready' | 'failed'. */
  travyVideoStatus?: string | null;
  /** Reason the Travy render failed (shown instead of an opaque error). */
  travyVideoError?: string | null;
  /** Travy (EN+ZH) clip URL once its background render is ready. */
  travyClipUrl?: string | null;
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
  /** Approved Stage-1 rough storyboard — used to estimate the total video length
   *  (and a suggested voice length) at the pre-video voice-approval step. */
  storyboard?: StoryboardScene[];
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

export function VideoApprovalPanel({
  requestId,
  jobId,
  videoUrl,
  isAwaitingApproval,
  isAwaitingVoiceApproval = false,
  isAwaitingAnimationApproval = false,
  isAwaitingFinalApproval = false,
  isAwaitingOverlayApproval = false,
  isGeneratingOverlay = false,
  isAwaitingAdditionalRatios = false,
  isGeneratingAdditionalRatios = false,
  channelVideos = [],
  overlayPreviewUrl = null,
  savedSubtitleLanguages,
  savedTemplate = null,
  travyVideoStatus = null,
  travyVideoError = null,
  travyClipUrl = null,
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
  storyboard = [],
  activeSceneIndex = 0,
  sceneVideos = [],
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"review" | "revise">("review");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMergingScenes, setIsMergingScenes] = useState(false);
  const [regeneratingScene, setRegeneratingScene] = useState<{
    index: number;
    previousAssetId: string | null;
  } | null>(null);
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

  // Keep the scene-specific generating state visible until the rendered asset
  // for that exact scene is replaced. This avoids returning to the edit form
  // while GeneratingBaseVideo is already running.
  useEffect(() => {
    if (!regeneratingScene || !isAwaitingApproval) return;
    const latest = sceneVideos.find((video) => video.sceneIndex === regeneratingScene.index);
    if (latest && latest.assetId !== regeneratingScene.previousAssetId) {
      setRegeneratingScene(null);
    }
  }, [isAwaitingApproval, regeneratingScene, sceneVideos]);

  // Music picker state — initialise from job's saved track so approval steps show the current selection
  const [selectedMusicTrack, setSelectedMusicTrack] = useState<string | null>(savedMusicTrack ?? null);
  const [playingMusicTrack, setPlayingMusicTrack] = useState<string | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Requester approval states
  // Distribution channels chosen at voice approval, in click order. The FIRST
  // chosen channel is the PRIMARY — it sets the base video's aspect ratio.
  // Travy App (Travy) is always included (mandatory, locked) and always exports
  // at its own fixed ratio (16:9, same as YouTube).
  const [channelOrder, setChannelOrder] = useState<Platform[]>([]);
  const primaryChannel: Platform = channelOrder[0] ?? Platform.TravyApp;
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

  // Estimated total video length (a range) taken from the approved rough
  // storyboard — the same estimate shown above the player. The suggested
  // speaking-voice length is derived from it and is always SHORTER than the
  // video so the narration comfortably fits inside the picture. Falls back to
  // the media-based suggestion for older jobs with no storyboard.
  const orderedByIndex = new Map(orderedAssets.map((a) => [a.index, a]));
  const estimatedVideoRange = estimateStoryboardTotalRange(
    storyboard.map((s) => (s.assetIndexes ?? []).map((idx) => orderedByIndex.get(idx)))
  );
  const hasStoryboardEstimate = estimatedVideoRange.maxSeconds > 0;
  const suggestedVoiceRange = suggestVoiceDurationRange(estimatedVideoRange);
  // Cap the acceptable voice length: it must fit within the longest estimated
  // video length (plus the usual estimate tolerance). Use the storyboard-based
  // ceiling when available, else the legacy media-based one.
  const voiceCapSeconds = hasStoryboardEstimate
    ? suggestedVoiceRange.maxSeconds
    : suggestedVoiceSeconds;
  const voiceTooLong =
    voiceCapSeconds != null &&
    voiceSeconds != null &&
    voiceSeconds > voiceCapSeconds + VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS;

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
  useEffect(() => {
    // Once the refreshed server state leaves the music-selection gate, the
    // normal pipeline `isProcessing` flag owns the loading UI.
    if (!isAwaitingAnimationApproval) setAnimationApproving(false);
  }, [isAwaitingAnimationApproval]);
  const [finalApproving, setFinalApproving] = useState(false);
  const [overlayMergeProgress, setOverlayMergeProgress] = useState<number | null>(null);
  useEffect(() => {
    if (!isAwaitingFinalApproval) setFinalApproving(false);
  }, [isAwaitingFinalApproval]);

  useEffect(() => {
    if (!isGeneratingOverlay) {
      setOverlayMergeProgress(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/pipeline-status`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (typeof data.renderProgress === "number") {
          setOverlayMergeProgress((prev) =>
            prev == null ? data.renderProgress : Math.max(prev, data.renderProgress)
          );
        }
      } catch {
        // The main pipeline poller still owns recovery/navigation; a missed
        // percentage poll must not affect the render itself.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isGeneratingOverlay, requestId]);
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
  // Per-ratio % while the additional channels render: light self-poll of the
  // pipeline-status endpoint (the page-level poller owns the RSC refresh that
  // reveals each finished video; this only animates the % on the pending card).
  const [additionalProgress, setAdditionalProgress] = useState<{
    pct: number | null;
    detail: { unit?: string; unitsDone?: number; unitsTotal?: number } | null;
  }>({ pct: null, detail: null });
  useEffect(() => {
    if (!isGeneratingAdditionalRatios) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/pipeline-status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        setAdditionalProgress({
          pct: typeof data.renderProgress === "number" ? data.renderProgress : null,
          detail: data.renderProgressDetail ?? null,
        });
      } catch {
        /* network error — try again next interval */
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [isGeneratingAdditionalRatios, requestId]);

  /**
   * % of the ratio CURRENTLY rendering, derived from the overall unit-based
   * progress: overall = (unitsDone + unitFraction) / unitsTotal, so
   * unitFraction = overall × unitsTotal − unitsDone. Only meaningful for the
   * ratio named in `detail.unit`; other pending ratios are queued (no bar).
   */
  const currentUnitPct = (ratio: string | null): number | null => {
    const { pct, detail } = additionalProgress;
    if (pct == null || !detail || !ratio || detail.unit !== ratio) return null;
    if (detail.unitsTotal == null || detail.unitsDone == null) return pct;
    const fraction = (pct / 100) * detail.unitsTotal - detail.unitsDone;
    return Math.max(0, Math.min(100, fraction * 100));
  };
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
          targetPlatforms: [...channelOrder, Platform.TravyApp],
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
    // Stop every sound source used by this review step before starting the
    // merge. This includes the standalone music sample and voice player.
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current.src = "";
      musicAudioRef.current = null;
    }
    setPlayingMusicTrack(null);
    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
      voicePreviewAudioRef.current.currentTime = 0;
    }
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
    setIsMergingScenes(sceneVideos.length > 0);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      setIsSubmitting(false);
      setIsMergingScenes(false);
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
    const targetSceneIndex = safeActiveSceneIndex;
    const previousAssetId =
      sceneVideos.find((video) => video.sceneIndex === targetSceneIndex)?.assetId ?? null;
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
          sceneIndex: targetSceneIndex,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "ไม่สามารถส่งขอแก้ไขได้");
      }
      setRegeneratingScene({ index: targetSceneIndex, previousAssetId });
      setMode("review");
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
        {regeneratingScene ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              กำลังสร้างฉาก {regeneratingScene.index + 1} ใหม่
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              ระบบกำลังแก้ไขเฉพาะฉากนี้ ฉากอื่นจะยังคงเดิม
            </p>
          </div>
        ) : isMergingScenes ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
            <h2 className="mt-4 text-base font-semibold text-slate-900">
              กำลังรวมวิดีโอทุกฉาก
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              ระบบกำลังสร้างวิดีโอรวม กรุณารอสักครู่
            </p>
          </div>
        ) : isAwaitingApproval && sceneVideos.length > 0 ? (
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
                        onClick={() => {
                          setRegeneratingScene(null);
                          setSelectedSceneIndex(sv.sceneIndex);
                          setMode("revise");
                          setError(null);
                        }}
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
          // Once the pipeline reaches subtitle review or any later channel-ratio
          // stage, the non-subtitled base montage is obsolete. Never fall back
          // to it—even when the captioned/watermarked preview URL is temporarily
          // unavailable. The relevant captioned cards below either show the
          // correct asset or their own preparing/loading state.
          videoUrl &&
          !animationApproving &&
          !finalApproving &&
          !isProcessing &&
          !isAwaitingOverlayApproval &&
          !isAwaitingAdditionalRatios &&
          !isGeneratingAdditionalRatios && (
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

        {isAwaitingApproval && !isMergingScenes && !regeneratingScene && (
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
                    ← แก้ไขแผนทุกฉาก
                  </button>
                )}
                <Button onClick={handleApprove} loading={isSubmitting} disabled={isSubmitting}>
                  {sceneVideos.length > 0 ? "อนุมัติทุกฉากและรวมวิดีโอ" : "อนุมัติวีดิโอนี้"}
                </Button>
              </div>
            ) : sceneVideos.length === 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-3">
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
            ) : null}
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

              {/* Estimated total video length (from the approved storyboard) and a
                  suggested voice length that is always SHORTER than the video, so
                  the narration fits inside the picture. A voice that overshoots the
                  video by more than the tolerance can't be approved — the requester
                  shortens the script and regenerates. Falls back to the media-based
                  estimate for older jobs without a storyboard. */}
              {hasStoryboardEstimate ? (
                <div
                  className={`mb-4 rounded-lg border p-3 ${
                    voiceTooLong ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      ความยาววิดีโอโดยประมาณ
                    </p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                      ≈ {estimatedVideoRange.minSeconds}-{estimatedVideoRange.maxSeconds} วินาที
                    </span>
                  </div>
                  {suggestedVoiceRange.maxSeconds > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                        ความยาวเสียงพากย์ที่แนะนำ
                      </p>
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 tabular-nums">
                        ≈ {suggestedVoiceRange.minSeconds}-{suggestedVoiceRange.maxSeconds} วินาที
                      </span>
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-slate-500">
                    เสียงพากย์ที่แนะนำจะสั้นกว่าความยาววิดีโอโดยประมาณ เพื่อให้เสียงพูดพอดีกับภาพ
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
                      เสียงพากย์ยาวเกินกว่าความยาววิดีโอโดยประมาณมากกว่า {VOICE_OVER_SUGGESTION_TOLERANCE_SECONDS} วินาที —
                      กรุณาแก้บทพูดให้สั้นลงแล้วกด “สร้างเสียงพากย์ใหม่” ก่อนอนุมัติ
                    </p>
                  )}
                </div>
              ) : (
                suggestedVoiceSeconds != null &&
                suggestedVoiceSeconds > 0 && (
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
                )
              )}

              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ช่องทางในการเผยแพร่
                </p>
                <p className="mb-3 text-xs text-slate-400">
                  เลือกได้มากกว่าหนึ่งช่องทาง ช่องทางแรกที่เลือกคือช่องทางหลัก ระบบจะสร้างวิดีโอในอัตราส่วนของช่องทางหลัก (ช่องทางอื่นจะครอบตัดจากวิดีโอนี้)
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {/* Travy App — mandatory, locked, dark grey. Fixed at 16:9
                      (same as YouTube — the Travy clip is uploaded to YouTube
                      and shown in the Travy web app). */}
                  <div
                    aria-disabled
                    className="cursor-not-allowed rounded-md border border-slate-300 bg-slate-200 px-3 py-2 text-left text-sm text-slate-700"
                  >
                    <span className="block font-medium">
                      {PLATFORM_LABELS[Platform.TravyApp]}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {ratioLabel(PLATFORM_ASPECT_RATIOS[Platform.TravyApp])} · ค่าเริ่มต้น
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
                  disabled={
                    voiceRecreating ||
                    voiceApproving ||
                    voiceSeconds == null ||
                    voiceTooLong
                  }
                >
                  อนุมัติเสียงพากย์
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Animation Approval Phase */}
        {isAwaitingAnimationApproval && !animationApproving && (
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
                    ref={voicePreviewAudioRef}
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
        {isAwaitingFinalApproval && !finalApproving && (
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
                    {/* Required choice for the NEXT render. Keep this above the
                        tall video player so it is immediately visible on mobile. */}
                    <div className="rounded-xl border-2 border-blue-300 bg-blue-50/70 p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                            ขั้นตอนถัดไป · ต้องเลือกก่อนสร้างวิดีโอ
                          </p>
                          <h4 className="mt-1 text-base font-semibold text-slate-900">
                            เลือกภาษาซับไตเติ้ล
                          </h4>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          เลือกแล้ว {subtitleLangs.length}/{MAX_SUBTITLE_LANGS}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        เลือก 1–2 ภาษาสำหรับวิดีโอทุกช่องทางของคุณ จากนั้นกดปุ่มสร้างซับไตเติ้ลด้านล่าง
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {([
                          { code: "th", label: "ไทย", short: "TH" },
                          { code: "en", label: "อังกฤษ", short: "EN" },
                          { code: "zh", label: "จีน", short: "ZH" },
                        ] as const).map(({ code, label, short }) => {
                          const selected = subtitleLangs.includes(code);
                          const atMax = !selected && subtitleLangs.length >= MAX_SUBTITLE_LANGS;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggleSubtitleLang(code)}
                              disabled={atMax}
                              aria-pressed={selected}
                              className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                                selected
                                  ? "border-blue-500 bg-blue-600 text-white ring-2 ring-blue-200"
                                  : atMax
                                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300"
                                    : "border-blue-200 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50"
                              }`}
                            >
                              <span className="text-xs opacity-75">{short}</span>
                              <span>{selected ? "✓ " : ""}{label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Travy ใช้ซับไตเติ้ลอังกฤษและจีนโดยอัตโนมัติ
                      </p>
                      {subtitleLangs.length === 0 && (
                        <p className="mt-2 text-sm font-medium text-red-600">
                          กรุณาเลือกอย่างน้อย 1 ภาษา
                        </p>
                      )}
                    </div>

                    {/* Preview video at the primary channel's aspect ratio */}
                    <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[500px]">
                      <video
                        key={primaryClip.id}
                        src={primaryClip.storageUrl}
                        controls
                        className="max-h-[480px] w-auto object-contain rounded"
                      />
                    </div>

                    {/* Storage-expiry note for this intermediate merged master:
                        its stored file lives only for the final_exports/ window,
                        so tell the requester when it will be purged. */}
                    <RetentionNoteText
                      note={spaceExpiryNote(primaryClip.storageKey, primaryClip.createdAt)}
                      className="text-center"
                    />

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
                          สร้างซับไตเติ้ล (
                          {subtitleLangs
                            .map((code) => ({ th: "ไทย", en: "อังกฤษ", zh: "จีน" })[code])
                            .join(" + ")}
                          ) และ Motion Graphic →
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

        {/* Phase 7 — gate to generate the remaining channels' aspect ratios,
            then the live per-channel grid while they render one-by-one */}
        {(isAwaitingAdditionalRatios || isGeneratingAdditionalRatios) && (
          <div className="mt-6 space-y-6">
            {/* Completed subtitled video for the primary channel — reuses the
                clip already rendered/approved at the overlay step, so it appears
                immediately (no re-render) and the requester can play + download
                the SUBTITLED result right away. */}
            {overlayPreviewUrl && (
              <Card className="border-green-100 bg-green-50/30">
                <h3 className="text-base font-semibold text-slate-900 mb-2">
                  วิดีโอฉบับสมบูรณ์ (พร้อมซับไตเติ้ล){primaryRatio ? ` — ${primaryRatio}` : ""}
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                  วิดีโอช่องทางหลักพร้อมซับไตเติ้ลและ Motion Graphic เรียบร้อยแล้ว เล่นดูหรือดาวน์โหลดได้ทันที
                </p>
                <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[500px]">
                  <video
                    key={overlayPreviewUrl}
                    src={overlayPreviewUrl}
                    controls
                    playsInline
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
              </Card>
            )}
            {isAwaitingAdditionalRatios && (
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
            )}
            {/* Live per-channel grid (generation order = channel selection order):
                each channel's card flips from spinner → playable video the moment
                its ratio finishes rendering, while the rest keep generating. The
                page-level poller refreshes as each captioned export lands. */}
            {isGeneratingAdditionalRatios && (
              <Card className="border-blue-100 bg-blue-50/30">
                <h3 className="text-base font-semibold text-slate-900 mb-2">
                  วิดีโอสำหรับช่องทางอื่น
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                  ระบบกำลังสร้างวิดีโอของแต่ละช่องทางตามลำดับ ช่องทางที่เสร็จแล้วสามารถเล่นดูและดาวน์โหลดได้ทันที
                  โดยไม่ต้องรอช่องทางอื่น
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {channelVideos
                    .filter((c) => c.ratio !== primaryRatio)
                    .map((c) => {
                      const ready = !!c.assetId;
                      const unitPct = ready ? null : currentUnitPct(c.ratio);
                      const rendering = !ready && unitPct != null;
                      return (
                        <div
                          key={c.platform}
                          className={`rounded-lg border p-3 ${
                            ready
                              ? "border-green-200 bg-green-50/40"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-800">
                              {c.label}
                            </span>
                            <span className="text-xs text-slate-400">
                              {c.ratio ? ratioLabel(c.ratio) : ""}
                            </span>
                          </div>
                          {ready && c.url ? (
                            <>
                              <div className="flex justify-center overflow-hidden rounded-md bg-slate-900 p-1.5 max-h-[320px]">
                                <video
                                  key={c.url}
                                  src={c.url}
                                  controls
                                  playsInline
                                  className="max-h-[300px] w-auto rounded object-contain"
                                />
                              </div>
                              <a
                                href={c.url}
                                download={`subtitled_video_${(c.ratio ?? "").replace(":", "_")}.mp4`}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                ดาวน์โหลดวิดีโอ ({c.ratio})
                              </a>
                            </>
                          ) : ready ? (
                            <p className="text-sm text-green-700">
                              วิดีโอพร้อมแล้ว — ดูได้ในขั้นตอนถัดไป
                            </p>
                          ) : (
                            <div className="flex items-center gap-3 py-3 text-sm text-slate-500">
                              <div className="h-5 w-5 flex-shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                              <div className="min-w-0 flex-1">
                                {rendering ? (
                                  <>
                                    <p>กำลังสร้างวิดีโอช่องทางนี้...</p>
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                          className="h-full rounded-full bg-blue-600 transition-all duration-700"
                                          style={{ width: `${unitPct}%` }}
                                        />
                                      </div>
                                      <span className="flex-shrink-0 text-xs tabular-nums text-blue-600">
                                        {Math.floor(unitPct)}%
                                      </span>
                                    </div>
                                  </>
                                ) : (
                                  <p>อยู่ในคิว — รอสร้างตามลำดับ</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Phase 7 — automatic Travy (EN+ZH) render status */}
        {travyVideoStatus && travyVideoStatus !== "idle" && (
          <Card className="mt-6 border-slate-100 bg-slate-50/60">
            <h3 className="text-base font-semibold text-slate-900 mb-2">วิดีโอสำหรับช่อง Travy (อังกฤษ + จีน)</h3>
            {travyVideoStatus === "generating" && (
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                ระบบกำลังสร้างวิดีโอสำหรับช่อง Travy โดยอัตโนมัติ (ไม่สามารถยกเลิกได้) คุณสามารถดูได้เมื่อสร้างเสร็จ
              </div>
            )}
            {travyVideoStatus === "ready" && (
              travyClipUrl ? (
                <div className="space-y-3">
                  <div className="flex justify-center bg-slate-900 rounded-lg p-2 overflow-hidden max-h-[420px]">
                    <video src={travyClipUrl} controls className="max-h-[400px] w-auto object-contain rounded" />
                  </div>
                  <a
                    href={travyClipUrl}
                    download="final_travy.mp4"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    ดาวน์โหลดวิดีโอ Travy
                  </a>
                </div>
              ) : (
                <p className="text-sm text-slate-400">วิดีโอ Travy พร้อมแล้ว</p>
              )
            )}
            {travyVideoStatus === "failed" && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-600">การสร้างวิดีโอ Travy ล้มเหลว</p>
                {travyVideoError && (
                  <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
                    สาเหตุ: {travyVideoError}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  ระบบจะให้คุณลองสร้างใหม่ได้ในขั้นตอนตรวจสอบการเผยแพร่
                </p>
              </div>
            )}
          </Card>
        )}

        {/* Processing Indicator — shown ONLY while an async background step is
            genuinely running. Gated on isProcessing so it never lingers at
            terminal/review states (Complete/Delivered/Publishing/DistributionReview),
            which fixes the phantom "กำลังประมวลผล..." spinner. */}
        {/* Suppressed during GeneratingAdditionalRatios — the per-channel grid
            above carries its own per-channel spinners/progress. */}
        {!isPipelineFailed &&
          !regeneratingScene &&
          (isProcessing || animationApproving || finalApproving) &&
          !isGeneratingAdditionalRatios && (
          <Card className="mt-6 border-slate-100 bg-slate-50 p-5 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4" />
            {isGeneratingOverlay || finalApproving ? (
              <>
                <h4 className="text-sm font-semibold text-slate-800">
                  กำลังรวมซับไตเติ้ลและ Motion Graphic...
                </h4>
                <p className="mt-1 text-xs text-slate-400 max-w-[320px]">
                  ระบบกำลังเรนเดอร์ซับไตเติ้ลลงในวิดีโอ คุณสามารถดูตัวอย่างได้เมื่อขั้นตอนนี้เสร็จสมบูรณ์
                </p>
                <div className="mt-4 w-72 max-w-full">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-700"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, finalApproving ? 0 : overlayMergeProgress ?? 0)
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-blue-600">
                    {Math.floor(
                      Math.max(0, Math.min(100, finalApproving ? 0 : overlayMergeProgress ?? 0))
                    )}
                    %
                  </p>
                </div>
              </>
            ) : isGeneratingVoice ? (
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

      {/* Script section — editable in revise mode, read-only otherwise */}
      {mode === "revise" ? (
        <div className="mb-6 flex flex-col gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">
              {sceneVideos.length > 0
                ? `แก้ไขฉาก ${safeActiveSceneIndex + 1}`
                : "แก้ไขสคริปต์วิดีโอที่อนุมัติ"}
            </p>
            <p className="mt-0.5 text-sm text-amber-700">
              {sceneVideos.length > 0 ? (
                <>
                  ปรับรายละเอียด รูป คลิป และช่วงเวลาของฉากนี้ แล้วกด{" "}
                  <strong>แก้ไขฉากนี้</strong> ระบบจะสร้างใหม่เฉพาะฉากนี้
                </>
              ) : (
                <>
                  แก้ไขบทพูดและแผนฉากด้านล่าง จากนั้นคลิก{" "}
                  <strong>ส่งขอสร้างวีดิโอใหม่</strong>
                </>
              )}
            </p>
          </div>

          {/* Hook */}
          {sceneVideos.length === 0 && (
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
          )}

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
                    aspectRatio={primaryRatio}
                    onChange={(assets) => updateSceneAssets(safeActiveSceneIndex, assets)}
                  />
                  {sceneVideos.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
                      <button
                        type="button"
                        onClick={() => { setMode("review"); setError(null); }}
                        disabled={isSubmitting}
                        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                      <Button
                        onClick={handleReviseSubmit}
                        loading={isSubmitting}
                        disabled={isSubmitting}
                      >
                        แก้ไขฉากนี้
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Script */}
          {sceneVideos.length === 0 && (
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
          )}

          {/* Caption */}
          {sceneVideos.length === 0 && (
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
          )}

          {sceneVideos.length === 0 && (
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
          )}
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

    </>
  );
}
