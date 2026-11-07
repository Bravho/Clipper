"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { ROUTES } from "@/config/routes";
import type {
  AdLabAvatarVoice,
  AdLabAvatarVideoStatus,
  AdLabAvatarVideoEntry,
  AdLabTwinCreation,
  AdLabLookCreation,
  TwinCreationStage,
  AdLabVideoKind,
  AdLabVideoVoiceSource,
} from "@/domain/models/AdLab";
import { applySpokenTextEdit, buildSpokenText } from "@/services/ad-lab/spokenText";
import {
  ELEVENLABS_V3_MAX_CHARS,
  estimateSpeechSeconds,
  estimateAvatarVideoCostUsd,
} from "@/services/ad-lab/avatarCost";
import {
  AD_LAB_VOICE_SPEEDS,
  AD_LAB_VOICE_TONES,
  DEFAULT_VOICE_SPEED_ID,
  DEFAULT_VOICE_TONE_ID,
  type AdLabVoiceSpeedId,
  type AdLabVoiceToneId,
  isValidSpeedId,
  isValidToneId,
} from "@/config/adLabVoiceOptions";
import { autoPickLook, getLookOrientation } from "@/config/twinLookPicker";
import { useAdLabStore } from "./useAdLabStore";
import { CostConfirmDialog } from "./CostConfirmDialog";
import { AvatarAdvancedSettings } from "./AvatarAdvancedSettings";
import { AddTwinLookPanel } from "./AddTwinLookPanel";
import { applicableSettings, settingsSummary, withDefaultFit, type AvatarVideoSettings, type LookFrame } from "@/config/heygenVideoOptions";
import { avatarRatePerSec } from "@/services/ad-lab/avatarCost";
import {
  DEFAULT_HEYGEN_ASPECT_RATIO,
  HEYGEN_ASPECT_RATIO_OPTIONS,
  aspectFramingNote,
  type HeyGenAspectRatio,
} from "@/config/heygenAspectRatios";
import { useAvatarJobPolling, type AvatarPollingUpdate } from "./useAvatarJobPolling";
import { VideoManagerSection } from "./VideoManagerSection";
import { legacyVideoFromEntry, removeAvatarVideo } from "@/services/ad-lab/avatarVideoHistory";

// ---------------------------------------------------------------------------
// Types

interface AvatarConfig {
  heygenConfigured: boolean;
  elevenLabsConfigured: boolean;
  maxSeconds: number;
  voices: Array<{ id: string; label: string; gender: string; previewUrl?: string }>;
  defaultVoiceId?: string;
  speeds: Array<{ id: string; label: string; speed: number }>;
  defaultSpeedId?: string;
  tones: Array<{ id: string; label: string }>;
  defaultToneId?: string;
  rates: { voiceUsdPer1kChars: number; avatarUsdPerSec: number };
  thaiCharsPerSecond: number;
}

interface LookItem {
  id: string;
  name: string;
  groupId?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  status?: string;
  selectable?: boolean;
  avatarType?: string;
  imageWidth?: number;
  imageHeight?: number;
  preferredOrientation?: "portrait" | "landscape" | "square";
  engine?: "avatar_v" | "avatar_iv" | null;
  supportedApiEngines?: string[];
  defaultVoiceId?: string;
}

// Natural image dimensions keyed by look id — used for aspect-ratio-aware preview display
type LookImageDims = Record<string, { w: number; h: number }>;

const TEST_VIDEO_SAMPLE_SCRIPT =
  "สวัสดีครับ ผมคือ AI Avatar ของคุณ พร้อมนำเสนอสินค้าและบริการที่ยอดเยี่ยมให้กับลูกค้าทุกท่าน วันนี้ขอแนะนำสิ่งที่พิเศษสุดให้กับคุณ";

const T_LOOKS_ERR = "โหลดรายการ Avatar จาก HeyGen ไม่สำเร็จ: ";

interface LooksResponse {
  configured: boolean;
  looks: LookItem[];
  defaultLookId?: string;
}

interface EstimateResult {
  chars: number;
  estSeconds: number;
  voiceCostUsd: number;
  videoCostUsd: number;
  scriptHash: string;
  tooLong: boolean;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)} USD`;
}

function fmtSec(n: number): string {
  return `~${Math.round(n)} วินาที`;
}

// ---------------------------------------------------------------------------
// Main component

export function AvatarWorkspace() {
  const { store, ready, update } = useAdLabStore();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Config ----------------------------------------------------------------
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");

  // Draft selection -------------------------------------------------------
  const [hydratedForBrand, setHydratedForBrand] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const selectedDraftIdRef = useRef<string | null>(null);
  selectedDraftIdRef.current = selectedDraftId;

  // Estimate --------------------------------------------------------------
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

  // Voice -----------------------------------------------------------------
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [selectedSpeedId, setSelectedSpeedId] = useState<AdLabVoiceSpeedId>(DEFAULT_VOICE_SPEED_ID);
  const [selectedToneId, setSelectedToneId] = useState<AdLabVoiceToneId>(DEFAULT_VOICE_TONE_ID);
  const [voiceConfirmOpen, setVoiceConfirmOpen] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [liveAudioUrl, setLiveAudioUrl] = useState<string | null>(null);
  const lastFetchedAudioKey = useRef<string | null>(null);

  // Digital Twin look picker ----------------------------------------------
  const [looks, setLooks] = useState<LookItem[]>([]);
  const [looksLoading, setLooksLoading] = useState(true);
  const [looksError, setLooksError] = useState("");
  const [looksConfigured, setLooksConfigured] = useState(false);
  const [defaultLookId, setDefaultLookId] = useState<string | undefined>();
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
  const [manualLookId, setManualLookId] = useState("");
  // Natural image dimensions per look id for aspect-ratio-correct preview
  const [lookImageDims, setLookImageDims] = useState<LookImageDims>({});

  // Video kind / voice source (Task B) ----------------------------------------
  const [videoKind, setVideoKind] = useState<AdLabVideoKind>("production");
  const [voiceSource, setVoiceSource] = useState<AdLabVideoVoiceSource>("elevenlabs");
  const [testScript, setTestScript] = useState(TEST_VIDEO_SAMPLE_SCRIPT);
  const [productionTtsScript, setProductionTtsScript] = useState("");

  // Video -----------------------------------------------------------------
  const [videoConfirmOpen, setVideoConfirmOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<HeyGenAspectRatio>(DEFAULT_HEYGEN_ASPECT_RATIO);
  const [advSettings, setAdvSettings] = useState<AvatarVideoSettings>({});
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState("");

  const [resendConfirmOpen, setResendConfirmOpen] = useState(false);

  // Digital Twin step 2 mode: "existing" = pick from list, "create" = create new
  const [lookMode, setLookMode] = useState<"existing" | "create">("existing");
  // groupId of the twin to show the "add portrait look" panel for, or null
  const [addLookForGroupId, setAddLookForGroupId] = useState<string | null>(null);
  // look overrides: keyed `${groupId}:${ratio}`, synced with avatar.lookOverrides
  const [lookOverrides, setLookOverrides] = useState<Record<string, string>>({});
  const [twinFile, setTwinFile] = useState<File | null>(null);
  const [twinName, setTwinName] = useState("");
  const [twinFileError, setTwinFileError] = useState("");
  const [twinResolutionWarning, setTwinResolutionWarning] = useState("");
  const [twinVideoMeta, setTwinVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [twinCostConfirmOpen, setTwinCostConfirmOpen] = useState(false);
  const [twinProgress, setTwinProgress] = useState(0);
  const [twinError, setTwinError] = useState("");
  const twinPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Script inline edit
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editSaved, setEditSaved] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [estimateKey, setEstimateKey] = useState(0);

  // ---------------------------------------------------------------------------
  // Derived state

  const selectedBrandId = store.selectedBrandId || store.brands[0]?.id || "";
  const brand = useMemo(
    () => store.brands.find((b) => b.id === selectedBrandId),
    [selectedBrandId, store.brands]
  );

  const approvedDrafts = useMemo(
    () =>
      store.drafts
        .filter((d) => d.brandId === selectedBrandId && d.status === "approved")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [selectedBrandId, store.drafts]
  );

  const selectedDraft = useMemo(
    () => approvedDrafts.find((d) => d.id === selectedDraftId) ?? null,
    [approvedDrafts, selectedDraftId]
  );

  const avatar = selectedDraft?.avatar ?? null;
  const voice = avatar?.voice ?? null;
  const video = avatar?.video ?? null;
  const twinCreation = avatar?.twinCreation ?? null;
  const lookCreation = avatar?.lookCreation ?? null;

  const spokenText = selectedDraft ? buildSpokenText(selectedDraft) : "";
  const isStale =
    !!(avatar?.scriptHash && estimate?.scriptHash && avatar.scriptHash !== estimate.scriptHash);

  // The effective lookId: manual field takes precedence when filled, else picker selection.
  const effectiveLookId = manualLookId.trim() || selectedLookId;

  // defaultVoiceId for the currently selected look (undefined when using manual ID)
  const selectedLookDefaultVoiceId = useMemo(() => {
    if (manualLookId.trim()) return undefined; // unknown for manual IDs
    return looks.find(l => l.id === selectedLookId)?.defaultVoiceId;
  }, [looks, selectedLookId, manualLookId]);

  // Migrate legacy avatar.video → videos array (read-only; written back on submit)
  const videos: AdLabAvatarVideoEntry[] = useMemo(() => {
    const stored = avatar?.videos ?? [];
    if (avatar?.videos !== undefined) return stored;
    if (!avatar?.video) return stored;
    const v = avatar.video;
    if (stored.some(entry => entry.id === v.idempotencyKey || (v.heygenVideoId && entry.heygenVideoId === v.heygenVideoId))) return stored;
    const entry: AdLabAvatarVideoEntry = {
      id: v.idempotencyKey,
      kind: "production",
      voiceSource: "elevenlabs",
      lookId: v.lookId ?? "",
      engine: v.engine,
      idempotencyKey: v.idempotencyKey,
      heygenVideoId: v.heygenVideoId,
      jobToken: v.jobToken,
      status: v.status,
      durationSec: v.durationSec,
      estCostUsd: v.estCostUsd,
      videoKey: v.videoKey,
      createdAt: v.requestedAt,
      updatedAt: v.completedAt ?? v.requestedAt,
      error: v.error,
      attempts: v.attempts,
      aspectRatio: v.aspectRatio,
      audioAssetId: v.audioAssetId,
      assetToken: v.assetToken,
      sourceAudioKey: v.sourceAudioKey,
    };
    return [...stored, entry];
  }, [avatar?.video, avatar?.videos]);

  const primaryVideoId = avatar?.primaryVideoId ?? (videos[0]?.status === "ready" ? videos[0]?.id : undefined);

  // Speed-adjusted estimates
  const currentSpeed = AD_LAB_VOICE_SPEEDS.find((s) => s.id === selectedSpeedId)?.speed ?? 0.85;
  const adjustedEstSeconds = estimate ? estimate.estSeconds / currentSpeed : 0;
  // Engine is decided by the server from the look's supported_api_engines; this mirrors it
  // for the estimate (a manual look ID not in the list is estimated as avatar_v).
  const selectedEngine: "avatar_v" | "avatar_iv" =
    looks.find((l) => l.id === effectiveLookId)?.engine === "avatar_iv" ? "avatar_iv" : "avatar_v";
  const engineLabel = selectedEngine === "avatar_iv" ? "Avatar IV" : "Avatar V";
  // Pricing (developers.heygen.com/docs/pricing, 2026-10-13): avatar_iv photo $0.05/s, everything else $0.0667/s.
  const selectedAvatarType = looks.find((l) => l.id === effectiveLookId)?.avatarType ?? "digital_twin";
  // Look frame for the default-fit decision: HeyGen's image_width/height, else the preview image size.
  function selectedLookFrame(): LookFrame {
    const l = looks.find((x) => x.id === effectiveLookId);
    const dims = effectiveLookId ? lookImageDims[effectiveLookId] : undefined;
    return {
      width: l?.imageWidth ?? dims?.w,
      height: l?.imageHeight ?? dims?.h,
      orientation: l?.preferredOrientation,
    };
  }
  const adjustedVideoCostUsd = adjustedEstSeconds * avatarRatePerSec(selectedEngine, selectedAvatarType);
  const isTooLong = estimate
    ? estimate.chars > ELEVENLABS_V3_MAX_CHARS || adjustedEstSeconds > (config?.maxSeconds ?? 180)
    : false;

  const isVoiceSettingsStale = !!(
    voice &&
    (voice.speedId !== selectedSpeedId || voice.toneId !== selectedToneId)
  );

  // Voice settings reset when draft/voice changes
  useEffect(() => {
    setSelectedSpeedId(voice?.speedId && isValidSpeedId(voice.speedId) ? voice.speedId : DEFAULT_VOICE_SPEED_ID);
    setSelectedToneId(voice?.toneId && isValidToneId(voice.toneId) ? voice.toneId : DEFAULT_VOICE_TONE_ID);
  }, [selectedDraftId, voice?.audioKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const editTextNormalized = useMemo(
    () =>
      editText
        .replace(/【[^】]*】/g, "")
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .trim(),
    [editText],
  );
  const editCharError = useMemo(() => {
    if (!editTextNormalized) return "ข้อความต้องไม่ว่างเปล่า";
    if (editTextNormalized.length > ELEVENLABS_V3_MAX_CHARS)
      return `เกินขีดจำกัด ${ELEVENLABS_V3_MAX_CHARS.toLocaleString()} ตัวอักษร`;
    return "";
  }, [editTextNormalized]);

  // lookId staleness: video was made with a different lookId
  const lookIdChanged = !!(video?.lookId && effectiveLookId && video.lookId !== effectiveLookId);

  // Can submit TTS video: look selected + has a known defaultVoiceId
  const canTts = !!(effectiveLookId && selectedLookDefaultVoiceId && !manualLookId.trim());
  // Can submit audio video: voice ready, not stale/too-long
  const canAudio = !!(effectiveLookId && voice && !isStale && !isTooLong && !voiceLoading);

  // Script used for TTS modes
  const ttsScript = videoKind === "test" ? testScript : productionTtsScript;
  const ttsScriptLen = ttsScript.trim().length;
  const ttsEstSeconds = ttsScriptLen > 0 ? estimateSpeechSeconds(ttsScriptLen) : 0;
  const ttsVideoCostUsd = ttsEstSeconds > 0
    ? estimateAvatarVideoCostUsd(ttsEstSeconds, selectedEngine, selectedAvatarType)
    : 0;
  const ttsTooLong = ttsScriptLen > ELEVENLABS_V3_MAX_CHARS || ttsEstSeconds > (config?.maxSeconds ?? 180);

  const videoStepEnabled = !!(
    config?.heygenConfigured &&
    effectiveLookId &&
    (
      (videoKind === "test" && canTts && ttsScriptLen > 0 && !ttsTooLong) ||
      (videoKind === "production" && voiceSource === "elevenlabs" && canAudio) ||
      (videoKind === "production" && voiceSource === "twin_tts" && canTts && ttsScriptLen > 0 && !ttsTooLong)
    )
  );

  const voiceOrLookNewerThanVideo = !!(
    video?.requestedAt && (
      (voice?.createdAt && voice.createdAt > video.requestedAt) ||
      lookIdChanged
    )
  );

  // ---------------------------------------------------------------------------
  // Effects: config fetch

  useEffect(() => {
    fetch("/api/ad-lab/avatar/config")
      .then((res) => res.json())
      .then((data: AvatarConfig & { error?: string }) => {
        if (data.error) setConfigError(data.error);
        else setConfig(data);
      })
      .catch(() => setConfigError("ไม่สามารถโหลดการตั้งค่าได้"))
      .finally(() => setConfigLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Effects: fetch looks

  // Load the account's looks. Distinguishes: key missing (configured=false),
  // API error (message from the server), and no avatars (empty list).
  const loadLooks = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLooksLoading(true);
    setLooksError("");
    try {
      const res = await fetch("/api/ad-lab/avatar/looks");
      const data = (await res.json().catch(() => ({}))) as Partial<LooksResponse> & { error?: string; reason?: string };
      if (isCancelled()) return;
      if (!res.ok || data.error) {
        setLooksError(T_LOOKS_ERR + (data.error ?? `HTTP ${res.status}`));
        return;
      }
      setLooksConfigured(Boolean(data.configured));
      setLooks(data.looks ?? []);
      setDefaultLookId(data.defaultLookId);
    } catch (err) {
      if (!isCancelled()) setLooksError(T_LOOKS_ERR + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (!isCancelled()) setLooksLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLooks(() => cancelled);
    return () => { cancelled = true; };
  }, [loadLooks]);

  // Voice preview
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const selectedPreviewUrl = config?.voices.find((v) => v.id === selectedVoiceId)?.previewUrl;

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    setPreviewPlaying(false);
  }, [selectedVoiceId]);

  useEffect(() => () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
  }, []);

  const togglePreview = useCallback(() => {
    if (!selectedPreviewUrl) return;
    let audio = previewAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("ended", () => setPreviewPlaying(false));
      audio.addEventListener("pause", () => setPreviewPlaying(false));
      audio.addEventListener("error", () => setPreviewPlaying(false));
      previewAudioRef.current = audio;
    }
    if (!audio.paused) { audio.pause(); return; }
    const src = new URL(selectedPreviewUrl, window.location.origin).href;
    if (audio.src !== src) audio.src = src;
    audio.currentTime = 0;
    audio.play().then(() => setPreviewPlaying(true)).catch(() => setPreviewPlaying(false));
  }, [selectedPreviewUrl]);

  // Set default voice when config loads
  useEffect(() => {
    if (!config || selectedVoiceId) return;
    const preferred = config.voices.find((v) => v.id === config.defaultVoiceId);
    setSelectedVoiceId(preferred?.id ?? config.voices[0]?.id ?? "");
  }, [config, selectedVoiceId]);

  // Pre-select look: draft.avatar.video.lookId → defaultLookId → first look
  useEffect(() => {
    if (looksLoading) return;
    const storedLookId = video?.lookId;
    if (storedLookId && looks.find((l) => l.id === storedLookId)) {
      setSelectedLookId(storedLookId);
    } else if (defaultLookId && looks.find((l) => l.id === defaultLookId)) {
      setSelectedLookId(defaultLookId);
    } else if (looks.length > 0) {
      setSelectedLookId(looks[0]?.id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looksLoading, looks, defaultLookId]);

  // ---------------------------------------------------------------------------
  // Effects: auto-select draft

  useEffect(() => {
    if (!ready || !selectedBrandId || hydratedForBrand === selectedBrandId) return;
    const paramId = searchParams.get("draftId");
    const match = approvedDrafts.find((d) => d.id === paramId);
    setSelectedDraftId(match?.id ?? approvedDrafts[0]?.id ?? null);
    setHydratedForBrand(selectedBrandId);
  }, [approvedDrafts, hydratedForBrand, ready, searchParams, selectedBrandId]);

  // ---------------------------------------------------------------------------
  // Effects: reset state on draft change

  useEffect(() => {
    setEstimate(null);
    setIsEditingScript(false);
    setEditText("");
    setEditSaved(false);
    setVoiceError("");
    setVideoError("");
    setLiveAudioUrl(null);
    lastFetchedAudioKey.current = null;
    setVideoKind("production");
    setVoiceSource("elevenlabs");
    setTestScript(TEST_VIDEO_SAMPLE_SCRIPT);
    // productionTtsScript initialized lazily from spokenText on first use
    setProductionTtsScript("");
    // Auto-select "create" mode when draft has an in-progress twin creation
    {
      const ACTIVE_TWIN_STAGES: TwinCreationStage[] = [
        "uploading", "upload_complete", "creating", "awaiting_consent", "training",
      ];
      const draftTc = store.drafts.find((d) => d.id === selectedDraftId)?.avatar?.twinCreation;
      setLookMode(draftTc && ACTIVE_TWIN_STAGES.includes(draftTc.stage) ? "create" : "existing");
    }
    setAddLookForGroupId(null);
    setTwinFile(null);
    setTwinName("");
    setTwinFileError("");
    setTwinResolutionWarning("");
    setTwinVideoMeta(null);
    setTwinError("");
    setTwinProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftId]);

  // Sync lookOverrides from workspace when draft changes
  useEffect(() => {
    const draftData = store.drafts.find((d) => d.id === selectedDraftId);
    setLookOverrides(draftData?.avatar?.lookOverrides ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftId]);

  // ---------------------------------------------------------------------------
  // Effects: estimate fetch

  useEffect(() => {
    if (!selectedDraftId) return;
    let cancelled = false;
    setEstimateLoading(true);
    fetch("/api/ad-lab/avatar/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: selectedDraftId }),
    })
      .then((res) => res.json())
      .then((data: EstimateResult & { error?: string }) => {
        if (!cancelled) {
          if (data.error) setEstimate(null);
          else setEstimate(data);
        }
      })
      .catch(() => { if (!cancelled) setEstimate(null); })
      .finally(() => { if (!cancelled) setEstimateLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftId, estimateKey]);

  // ---------------------------------------------------------------------------
  // Effects: twin status polling

  useEffect(() => {
    const POLL_STAGES: TwinCreationStage[] = ["awaiting_consent", "training"];
    if (
      !selectedDraftId ||
      !twinCreation ||
      !POLL_STAGES.includes(twinCreation.stage) ||
      (!twinCreation.lookId && !twinCreation.groupId)
    ) {
      if (twinPollingRef.current) {
        clearInterval(twinPollingRef.current);
        twinPollingRef.current = null;
      }
      return;
    }

    const draftId = selectedDraftId;

    async function pollOnce() {
      if (!twinCreation) return;
      const qs = new URLSearchParams();
      if (twinCreation.lookId) qs.set("lookId", twinCreation.lookId);
      if (twinCreation.groupId) qs.set("groupId", twinCreation.groupId);
      try {
        const res = await fetch(`/api/ad-lab/avatar/twins/status?${qs.toString()}`);
        const data = (await res.json()) as {
          lookStatus?: string;
          avatarV?: boolean;
          consentStatus?: string;
          error?: string;
        };

        const isCompleted =
          data.lookStatus === "completed" &&
          data.avatarV === true &&
          data.consentStatus === "accepted";
        const isFailed =
          data.lookStatus === "failed" ||
          data.consentStatus === "rejected" ||
          (!!data.error && data.lookStatus !== "processing" && data.lookStatus !== undefined);

        if (isCompleted || isFailed) {
          if (twinPollingRef.current) {
            clearInterval(twinPollingRef.current);
            twinPollingRef.current = null;
          }
        }

        const newStage: TwinCreationStage = isCompleted
          ? "completed"
          : isFailed
          ? "failed"
          : data.lookStatus === "processing"
          ? "training"
          : twinCreation.stage;

        if (newStage !== twinCreation.stage || isFailed) {
          await update((current) => ({
            ...current,
            drafts: current.drafts.map((d) => {
              if (d.id !== draftId || !d.avatar?.twinCreation) return d;
              return {
                ...d,
                avatar: {
                  ...d.avatar,
                  twinCreation: {
                    ...d.avatar.twinCreation,
                    stage: newStage,
                    ...(data.error ? { error: data.error } : {}),
                  },
                  updatedAt: new Date().toISOString(),
                },
              };
            }),
          }));
        }

        // On completion: refresh the looks list so the new twin appears in the picker
        if (isCompleted) {
          const looksRes = await fetch("/api/ad-lab/avatar/looks");
          const looksData = (await looksRes.json()) as LooksResponse & { error?: string };
          if (!looksData.error) {
            setLooksConfigured(looksData.configured);
            const newLooks = looksData.looks ?? [];
            setLooks(newLooks);
            if (twinCreation.lookId) {
              const newLook = newLooks.find((l) => l.id === twinCreation.lookId);
              if (newLook) {
                setSelectedLookId(newLook.id);
                setManualLookId("");
              }
            }
          }
          setLookMode("existing");
        }
      } catch {
        // Silently skip failed polls; next interval will retry
      }
    }

    void pollOnce();
    twinPollingRef.current = setInterval(() => void pollOnce(), 15_000);
    return () => {
      if (twinPollingRef.current) {
        clearInterval(twinPollingRef.current);
        twinPollingRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftId, twinCreation?.stage, twinCreation?.lookId, twinCreation?.groupId]);

  // ---------------------------------------------------------------------------
  // Effects: auto-pick look by aspect ratio within the selected look's group

  useEffect(() => {
    if (!selectedLookId || manualLookId.trim()) return;
    const currentLook = looks.find((l) => l.id === selectedLookId);
    const groupId = currentLook?.groupId;
    if (!groupId) return;
    const picked = autoPickLook(looks, groupId, aspectRatio, lookOverrides);
    if (picked && picked !== selectedLookId) {
      setSelectedLookId(picked);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio, selectedLookId, looks, lookOverrides]);

  // ---------------------------------------------------------------------------
  // Effects: fetch saved media URLs

  useEffect(() => {
    if (!voice?.audioKey || !selectedDraftId) return;
    const cacheKey = `${selectedDraftId}:${voice.audioKey}`;
    if (lastFetchedAudioKey.current === cacheKey) return;
    lastFetchedAudioKey.current = cacheKey;
    let cancelled = false;
    fetch(
      `/api/ad-lab/avatar/media?key=${encodeURIComponent(voice.audioKey)}&draftId=${encodeURIComponent(selectedDraftId)}`
    )
      .then((res) => res.json())
      .then((data: { url?: string }) => { if (!cancelled && data.url) setLiveAudioUrl(data.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [voice?.audioKey, selectedDraftId]);

  // ---------------------------------------------------------------------------
  // Polling

  const handlePollingUpdate = useCallback(
    (u: AvatarPollingUpdate) => {
      const draftId = selectedDraftIdRef.current;
      if (!draftId) return;
      void update((current) => {
        const d = current.drafts.find((item) => item.id === draftId);
        const curVid = d?.avatar?.video;
        if (
          curVid &&
          curVid.status === u.status &&
          curVid.error === u.error &&
          curVid.videoKey === u.videoKey &&
          curVid.durationSec === u.durationSec
        ) {
          return current;
        }
        return {
          ...current,
          drafts: current.drafts.map((item) => {
            if (item.id !== draftId || !item.avatar?.video) return item;
            return {
              ...item,
              avatar: {
                ...item.avatar,
                video: {
                  ...item.avatar.video,
                  status: u.status,
                  ...(u.error !== undefined ? { error: u.error } : {}),
                  ...(u.videoKey ? { videoKey: u.videoKey } : {}),
                  ...(u.completedAt ? { completedAt: u.completedAt } : {}),
                  ...(u.durationSec !== undefined ? { durationSec: u.durationSec } : {}),
                },
                updatedAt: new Date().toISOString(),
              },
            };
          }),
        };
      });
    },
    [update]
  );

  // Top-level polling for the legacy avatar.video field (migrated entries).
  // New videos use per-card polling in VideoManagerSection.
  useAvatarJobPolling({
    draftId: selectedDraftId,
    heygenVideoId: video?.heygenVideoId ?? null,
    jobToken: video?.jobToken ?? null,
    status: video?.status ?? null,
    onUpdate: handlePollingUpdate,
  });

  // ---------------------------------------------------------------------------
  // Script edit

  async function handleSaveScriptEdit() {
    if (!selectedDraft || !selectedDraftId || editCharError) return;
    if (editTextNormalized === buildSpokenText(selectedDraft)) {
      setIsEditingScript(false);
      return;
    }
    setEditSaving(true);
    setEditSaveError(null);
    try {
      const updated = { ...applySpokenTextEdit(selectedDraft, editText), updatedAt: new Date().toISOString() };
      const persisted = await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => (d.id !== selectedDraftId ? d : updated)),
      }));
      if (persisted === "browser") {
        setEditSaveError("บันทึกลงฐานข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง");
        return;
      }
      setIsEditingScript(false);
      setEditSaved(true);
      setEstimateKey((k) => k + 1);
      setTimeout(() => setEditSaved(false), 3000);
    } finally {
      setEditSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Twin creation handlers

  const TWIN_MAX_BYTES = 209_715_200;
  const TWIN_MIN_SEC = 15;
  const TWIN_MAX_SEC = 600;
  const TWIN_LONG_EDGE_MIN = 640;
  const TWIN_LONG_EDGE_MAX = 4096;

  function handleTwinFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setTwinFile(file);
    setTwinFileError("");
    setTwinResolutionWarning("");
    setTwinVideoMeta(null);
    if (!file) return;

    const ct = file.type.toLowerCase();
    if (ct !== "video/mp4" && ct !== "video/webm") {
      setTwinFileError("รองรับเฉพาะ MP4 และ WebM");
      return;
    }
    if (file.size > TWIN_MAX_BYTES) {
      setTwinFileError(`ไฟล์ใหญ่เกิน ${Math.round(TWIN_MAX_BYTES / 1024 / 1024)} MB`);
      return;
    }

    // Read duration and resolution via a hidden <video> element's loadedmetadata
    const url = URL.createObjectURL(file);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.onloadedmetadata = () => {
      const dur = vid.duration;
      const w = vid.videoWidth;
      const h = vid.videoHeight;
      URL.revokeObjectURL(url);
      setTwinVideoMeta({ duration: dur, width: w, height: h });
      if (dur < TWIN_MIN_SEC || dur > TWIN_MAX_SEC) {
        setTwinFileError(`ความยาวคลิปต้องอยู่ระหว่าง ${TWIN_MIN_SEC}–${TWIN_MAX_SEC} วินาที (คลิปนี้ ~${Math.round(dur)} วิ)`);
        return;
      }
      const longEdge = Math.max(w, h);
      if (longEdge < TWIN_LONG_EDGE_MIN || longEdge > TWIN_LONG_EDGE_MAX) {
        setTwinResolutionWarning(
          `⚠ ความละเอียด ${w}×${h} (long edge ${longEdge}px) อาจไม่เหมาะสม — แนะนำ 640–4096px (1080p ดีที่สุด)`
        );
      }
    };
    vid.onerror = () => {
      URL.revokeObjectURL(url);
      setTwinFileError("ไม่สามารถอ่านข้อมูลวิดีโอได้");
    };
    vid.src = url;
  }

  async function handleTwinCreate() {
    if (!twinFile || !twinName.trim() || twinFileError || !selectedDraftId) return;
    setTwinError("");
    setTwinProgress(0);

    const idempotencyKey = crypto.randomUUID();
    const now = new Date().toISOString();

    // Persist stage=uploading with idempotency key so reload survives
    const initTwin: AdLabTwinCreation = {
      idempotencyKey,
      name: twinName.trim(),
      stage: "uploading",
      createdAt: now,
    };
    await update((current) => ({
      ...current,
      drafts: current.drafts.map((d) => {
        if (d.id !== selectedDraftId) return d;
        return {
          ...d,
          avatar: {
            ...(d.avatar ?? { scriptHash: "", updatedAt: now }),
            twinCreation: initTwin,
            updatedAt: now,
          },
        };
      }),
    }));

    try {
      // Step 1: get pre-signed upload URL
      const initRes = await fetch("/api/ad-lab/avatar/twins/upload-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: twinFile.name,
          contentType: twinFile.type,
          sizeBytes: twinFile.size,
          durationSec: twinVideoMeta?.duration,
        }),
      });
      const initData = (await initRes.json()) as {
        assetId?: string;
        uploadUrl?: string;
        uploadHeaders?: Record<string, string>;
        error?: string;
        reason?: string;
      };
      if (!initRes.ok || !initData.assetId || !initData.uploadUrl) {
        setTwinError(initData.error ?? initData.reason ?? "เริ่มต้นอัปโหลดไม่สำเร็จ");
        await updateTwinStage(selectedDraftId, "failed", initData.error ?? "upload init failed");
        return;
      }

      let currentAssetId = initData.assetId;
      const { uploadUrl, uploadHeaders = {} } = initData;

      // Persist assetId from upload-init
      await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId || !d.avatar?.twinCreation) return d;
          return {
            ...d,
            avatar: {
              ...d.avatar,
              twinCreation: { ...d.avatar.twinCreation, assetId: currentAssetId },
              updatedAt: new Date().toISOString(),
            },
          };
        }),
      }));

      // Step 2: browser PUT directly to pre-signed URL (XHR for progress).
      // Falls back to server-side streaming proxy on network/CORS error or HTTP failure.
      const directPutOutcome = await new Promise<"ok" | string>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setTwinProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve("ok");
          else resolve(`http:${xhr.status}`);
        };
        xhr.onerror = () => resolve("network_error");
        xhr.open("PUT", uploadUrl);
        Object.entries(uploadHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.send(twinFile);
      });

      if (directPutOutcome !== "ok") {
        // Proxy fallback: show Thai notice before attempting
        setTwinError("ไม่สามารถอัปโหลดโดยตรงได้ กำลังใช้เส้นทางสำรอง (proxy)… กรุณารอสักครู่");
        const qs = new URLSearchParams({
          fileName: twinFile.name,
          contentType: twinFile.type,
          sizeBytes: String(twinFile.size),
          ...(twinVideoMeta?.duration != null ? { durationSec: String(Math.round(twinVideoMeta.duration)) } : {}),
        });
        const proxyRes = await fetch(`/api/ad-lab/avatar/twins/upload-proxy?${qs.toString()}`, {
          method: "POST",
          body: twinFile,
        });
        const proxyData = (await proxyRes.json().catch(() => ({}))) as { assetId?: string; error?: string; reason?: string };
        if (!proxyRes.ok || !proxyData.assetId) {
          throw new Error(proxyData.error ?? proxyData.reason ?? "อัปโหลดผ่าน proxy ไม่สำเร็จ");
        }
        currentAssetId = proxyData.assetId;
        setTwinError("");
        // Update draft with new assetId returned by proxy (may differ from upload-init)
        await update((current) => ({
          ...current,
          drafts: current.drafts.map((d) => {
            if (d.id !== selectedDraftId || !d.avatar?.twinCreation) return d;
            return {
              ...d,
              avatar: {
                ...d.avatar,
                twinCreation: { ...d.avatar.twinCreation, assetId: currentAssetId },
                updatedAt: new Date().toISOString(),
              },
            };
          }),
        }));
      }

      setTwinProgress(100);

      // Step 3: mark upload complete
      const completeRes = await fetch("/api/ad-lab/avatar/twins/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: currentAssetId }),
      });
      if (!completeRes.ok) {
        const cd = (await completeRes.json()) as { error?: string };
        setTwinError(cd.error ?? "ยืนยันการอัปโหลดไม่สำเร็จ");
        await updateTwinStage(selectedDraftId, "failed", cd.error ?? "upload complete failed");
        return;
      }
      await updateTwinStage(selectedDraftId, "upload_complete");

      // Step 4: create the Digital Twin
      await updateTwinStage(selectedDraftId, "creating");
      const createRes = await fetch("/api/ad-lab/avatar/twins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: twinName.trim(),
          assetId: currentAssetId,
          idempotencyKey,
          confirmCost: true,
        }),
      });
      const createData = (await createRes.json()) as {
        lookId?: string;
        groupId?: string;
        defaultVoiceId?: string;
        error?: string;
        reason?: string;
      };
      if (!createRes.ok || !createData.lookId || !createData.groupId) {
        setTwinError(createData.error ?? createData.reason ?? "สร้าง Digital Twin ไม่สำเร็จ");
        await updateTwinStage(selectedDraftId, "failed", createData.error ?? "create twin failed");
        return;
      }

      const { lookId, groupId } = createData;
      await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId || !d.avatar?.twinCreation) return d;
          return {
            ...d,
            avatar: {
              ...d.avatar,
              twinCreation: { ...d.avatar.twinCreation, stage: "awaiting_consent", lookId, groupId },
              updatedAt: new Date().toISOString(),
            },
          };
        }),
      }));

      // Step 5: request consent URL
      const consentRes = await fetch(`/api/ad-lab/avatar/twins/${encodeURIComponent(groupId)}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const consentData = (await consentRes.json()) as {
        url?: string;
        consentStatus?: string;
        error?: string;
        reason?: string;
      };

      // 409 = already accepted/under review — still move to awaiting_consent
      const consentUrl = consentData.url;
      const consentUrlAt = consentUrl ? new Date().toISOString() : undefined;
      await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId || !d.avatar?.twinCreation) return d;
          return {
            ...d,
            avatar: {
              ...d.avatar,
              twinCreation: {
                ...d.avatar.twinCreation,
                stage: "awaiting_consent",
                ...(consentUrl ? { consentUrl, consentUrlAt } : {}),
              },
              updatedAt: new Date().toISOString(),
            },
          };
        }),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTwinError(msg);
      await updateTwinStage(selectedDraftId, "failed", msg);
    }
  }

  async function handleTwinRefreshConsent() {
    if (!twinCreation?.groupId || !selectedDraftId) return;
    setTwinError("");
    const res = await fetch(
      `/api/ad-lab/avatar/twins/${encodeURIComponent(twinCreation.groupId)}/consent`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
    );
    const data = (await res.json()) as { url?: string; error?: string; reason?: string };
    if (res.ok && data.url) {
      const consentUrlAt = new Date().toISOString();
      await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId || !d.avatar?.twinCreation) return d;
          return {
            ...d,
            avatar: {
              ...d.avatar,
              twinCreation: { ...d.avatar.twinCreation, consentUrl: data.url!, consentUrlAt },
              updatedAt: new Date().toISOString(),
            },
          };
        }),
      }));
    } else {
      setTwinError(data.error ?? data.reason ?? "ขอลิงก์ใหม่ไม่สำเร็จ");
    }
  }

  async function updateLookCreation(lc: AdLabLookCreation | null) {
    if (!selectedDraftId) return;
    const draftId = selectedDraftId;
    await update((current) => ({
      ...current,
      drafts: current.drafts.map((d) => {
        if (d.id !== draftId || !d.avatar) return d;
        if (lc) return { ...d, avatar: { ...d.avatar, lookCreation: lc, updatedAt: new Date().toISOString() } };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lookCreation: _removed, ...rest } = d.avatar;
        return { ...d, avatar: { ...rest, updatedAt: new Date().toISOString() } };
      }),
    }));
  }

  async function handleNewLookComplete(lookId: string) {
    await loadLooks();
    setSelectedLookId(lookId);
    setManualLookId("");
  }

  /** Manual pick: remember it per twin group + current ratio so auto-pick respects it. */
  function selectLookManually(look: { id: string; groupId?: string }) {
    setSelectedLookId(look.id);
    setManualLookId("");
    if (!look.groupId || !selectedDraftId) return;
    const next = { ...lookOverrides, [`${look.groupId}:${aspectRatio}`]: look.id };
    setLookOverrides(next);
    const draftId = selectedDraftId;
    void update((current) => ({
      ...current,
      drafts: current.drafts.map((d) =>
        d.id !== draftId || !d.avatar ? d : { ...d, avatar: { ...d.avatar, lookOverrides: next } }
      ),
    }));
  }

  async function updateTwinStage(
    draftId: string,
    stage: TwinCreationStage,
    error?: string
  ) {
    await update((current) => ({
      ...current,
      drafts: current.drafts.map((d) => {
        if (d.id !== draftId || !d.avatar?.twinCreation) return d;
        return {
          ...d,
          avatar: {
            ...d.avatar,
            twinCreation: {
              ...d.avatar.twinCreation,
              stage,
              ...(error ? { error } : {}),
            },
            updatedAt: new Date().toISOString(),
          },
        };
      }),
    }));
  }

  async function handleTwinDismiss() {
    if (!selectedDraftId) return;
    await update((current) => ({
      ...current,
      drafts: current.drafts.map((d) => {
        if (d.id !== selectedDraftId || !d.avatar) return d;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { twinCreation: _removed, ...avatarWithout } = d.avatar;
        return { ...d, avatar: { ...avatarWithout, updatedAt: new Date().toISOString() } };
      }),
    }));
    setLookMode("existing");
    setTwinFile(null);
    setTwinName("");
    setTwinFileError("");
    setTwinError("");
    setTwinProgress(0);
  }

  // ---------------------------------------------------------------------------
  // Skip handler

  function handleSkip() {
    const draftId = selectedDraftIdRef.current;
    if (draftId) {
      const now = new Date().toISOString();
      void update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== draftId) return d;
          return {
            ...d,
            avatar: d.avatar
              ? { ...d.avatar, skippedAt: now, updatedAt: now }
              : { scriptHash: "", skippedAt: now, updatedAt: now },
          };
        }),
      }));
    }
    router.push(ROUTES.AD_LAB_PUBLISHING);
  }

  // ---------------------------------------------------------------------------
  // Voice generation

  async function handleGenerateVoice() {
    if (!selectedDraftId || !selectedVoiceId || !estimate) return;
    setVoiceLoading(true);
    setVoiceError("");
    try {
      const res = await fetch("/api/ad-lab/avatar/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraftId,
          voiceId: selectedVoiceId,
          speedId: selectedSpeedId,
          toneId: selectedToneId,
          confirmCost: true,
        }),
      });
      const data = (await res.json()) as {
        voice?: AdLabAvatarVoice;
        audioUrl?: string;
        scriptHash?: string;
        error?: string;
        reason?: string;
      };
      if (!res.ok || !data.voice || !data.audioUrl) {
        setVoiceError(data.error ?? data.reason ?? "สร้างเสียงไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setLiveAudioUrl(data.audioUrl);
      lastFetchedAudioKey.current = `${selectedDraftId}:${data.voice.audioKey}`;
      const hash = data.scriptHash ?? estimate.scriptHash;
      const now = new Date().toISOString();
      await update((current) => ({
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId) return d;
          return {
            ...d,
            avatar: {
              ...(d.avatar ?? { scriptHash: hash, updatedAt: now }),
              voice: data.voice!,
              scriptHash: hash,
              updatedAt: now,
            },
          };
        }),
      }));
    } catch {
      setVoiceError("เกิดข้อผิดพลาดเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setVoiceLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Video submission helpers

  /** Upsert a video entry in avatar.videos and keep legacy avatar.video in sync with primary. */
  async function upsertVideoEntry(entry: AdLabAvatarVideoEntry) {
    if (!selectedDraftId || !estimate) return;
    await update((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== selectedDraftId) return d;
          const existingVideos = d.avatar?.videos ?? [];
          const idx = existingVideos.findIndex(v => v.id === entry.id);
          const newVideos = idx >= 0
            ? existingVideos.map((v, i) => i === idx ? entry : v)
            : [...existingVideos, entry];
          const newPrimaryId = d.avatar?.primaryVideoId ?? (newVideos.find(v => v.status === "ready")?.id);
          const primaryEntry = newVideos.find(v => v.id === newPrimaryId) ?? newVideos[0];
          // Keep legacy video field in sync with the primary/latest entry
          const legacyVideo = primaryEntry ? {
            provider: "heygen" as const,
            engine: primaryEntry.engine,
            lookId: primaryEntry.lookId,
            idempotencyKey: primaryEntry.idempotencyKey,
            heygenVideoId: primaryEntry.heygenVideoId,
            jobToken: primaryEntry.jobToken,
            aspectRatio: primaryEntry.aspectRatio ?? DEFAULT_HEYGEN_ASPECT_RATIO,
            resolution: "1080p" as const,
            status: primaryEntry.status,
            error: primaryEntry.error,
            attempts: primaryEntry.attempts,
            requestedAt: primaryEntry.createdAt,
            completedAt: primaryEntry.status === "ready" ? primaryEntry.updatedAt : undefined,
            durationSec: primaryEntry.durationSec,
            videoKey: primaryEntry.videoKey,
            estCostUsd: primaryEntry.estCostUsd,
            audioAssetId: primaryEntry.audioAssetId,
            assetToken: primaryEntry.assetToken,
            sourceAudioKey: primaryEntry.sourceAudioKey,
          } : d.avatar?.video;
          return {
            ...d,
            avatar: {
              ...(d.avatar ?? { scriptHash: estimate.scriptHash, updatedAt: now }),
              videos: newVideos,
              primaryVideoId: newPrimaryId,
              video: legacyVideo,
              updatedAt: now,
            },
          };
        }),
      };
    });
  }

  async function submitVideo(
    idempotencyKey: string,
    options: { forceNewAssets?: boolean; entryId?: string; aspectRatio?: HeyGenAspectRatio; settings?: AvatarVideoSettings } = {}
  ) {
    if (!selectedDraftId || !voice?.audioKey || !effectiveLookId || !estimate) return;
    const useAspect = options.aspectRatio ?? aspectRatio;
    const useSettings = withDefaultFit(
      applicableSettings(options.settings ?? advSettings, { engine: selectedEngine, avatarType: selectedAvatarType, mode: "audio" }),
      useAspect,
      selectedLookFrame()
    );
    setVideoLoading(true);
    setVideoError("");

    const now = new Date().toISOString();
    const entryId = options.entryId ?? idempotencyKey;

    // Look up existing entry for asset reuse
    const existingEntry = videos.find(v => v.id === entryId);
    const assetsMatch =
      !options.forceNewAssets &&
      !!existingEntry?.audioAssetId &&
      !!existingEntry?.assetToken &&
      voice?.audioKey === existingEntry?.sourceAudioKey &&
      effectiveLookId === existingEntry?.lookId;
    const savedAudioAssetId = assetsMatch ? existingEntry?.audioAssetId : undefined;
    const savedAssetToken = assetsMatch ? existingEntry?.assetToken : undefined;

    const selectedLookName = looks.find(l => l.id === effectiveLookId)?.name;
    const prevAttempts = existingEntry?.attempts ?? 0;

    // Step 1: persist "submitting" entry
    const submittingEntry: AdLabAvatarVideoEntry = {
      id: entryId,
      kind: "production",
      voiceSource: "elevenlabs",
      lookId: effectiveLookId,
      lookName: selectedLookName,
      engine: selectedEngine,
      idempotencyKey,
      status: "submitting",
      attempts: prevAttempts + 1,
      estCostUsd: adjustedVideoCostUsd,
      aspectRatio: useAspect,
      ...(Object.keys(useSettings).length ? { settings: useSettings } : {}),
      createdAt: existingEntry?.createdAt ?? now,
      updatedAt: now,
      ...(assetsMatch ? {
        audioAssetId: savedAudioAssetId,
        assetToken: savedAssetToken,
        sourceAudioKey: existingEntry?.sourceAudioKey,
      } : {}),
    };
    await upsertVideoEntry(submittingEntry);

    try {
      // Step 2: upload audio asset (skip when saved ID is still valid)
      let audioAssetId = savedAudioAssetId;
      let assetToken = savedAssetToken;

      if (!audioAssetId || !assetToken) {
        const assetsRes = await fetch("/api/ad-lab/avatar/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: selectedDraftId,
            audioKey: voice.audioKey,
            confirmCost: true,
          }),
        });
        const assetsData = (await assetsRes.json()) as {
          audioAssetId?: string;
          assetToken?: string;
          error?: string;
          reason?: string;
        };
        if (!assetsRes.ok || !assetsData.audioAssetId || !assetsData.assetToken) {
          setVideoError(assetsData.error ?? assetsData.reason ?? "เตรียม asset สำหรับ HeyGen ไม่สำเร็จ");
          await upsertVideoEntry({ ...submittingEntry, status: "failed", error: assetsData.error ?? "asset prep failed", updatedAt: new Date().toISOString() });
          return;
        }
        audioAssetId = assetsData.audioAssetId;
        assetToken = assetsData.assetToken;
        await upsertVideoEntry({ ...submittingEntry, audioAssetId, assetToken, sourceAudioKey: voice?.audioKey });
      }

      // Step 3: create the HeyGen Avatar V video job
      const videoRes = await fetch("/api/ad-lab/avatar/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "audio",
          draftId: selectedDraftId,
          audioAssetId,
          assetToken,
          lookId: effectiveLookId,
          idempotencyKey,
          voiceChars: voice.chars,
          aspectRatio: useAspect,
          ...(Object.keys(useSettings).length ? { settings: useSettings } : {}),
          confirmCost: true,
        }),
      });
      const videoData = (await videoRes.json()) as {
        heygenVideoId?: string;
        jobToken?: string;
        status?: string;
        estCostUsd?: number;
        appliedSettings?: AvatarVideoSettings;
        lookId?: string;
        engine?: "avatar_v" | "avatar_iv";
        error?: string;
        reason?: string;
      };
      if (!videoRes.ok || !videoData.heygenVideoId || !videoData.jobToken) {
        setVideoError(videoData.error ?? videoData.reason ?? "ส่งงานไปยัง HeyGen ไม่สำเร็จ กรุณาลองใหม่");
        await upsertVideoEntry({ ...submittingEntry, status: "failed", error: videoData.error ?? "submission failed", updatedAt: new Date().toISOString() });
        return;
      }
      const mappedStatus: AdLabAvatarVideoStatus =
        videoData.status === "queued" ? "queued"
        : videoData.status === "processing" ? "processing"
        : "queued";

      await upsertVideoEntry({
        ...submittingEntry,
        heygenVideoId: videoData.heygenVideoId,
        jobToken: videoData.jobToken,
        status: mappedStatus,
        lookId: videoData.lookId ?? effectiveLookId,
        engine: videoData.engine ?? selectedEngine,
        estCostUsd: videoData.estCostUsd ?? submittingEntry.estCostUsd,
        audioAssetId,
        assetToken,
        sourceAudioKey: voice?.audioKey,
        ...(videoData.appliedSettings && Object.keys(videoData.appliedSettings).length ? { settings: videoData.appliedSettings } : {}),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setVideoError("เกิดข้อผิดพลาดเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setVideoLoading(false);
    }
  }

  async function submitTtsVideo(
    idempotencyKey: string,
    kind: AdLabVideoKind,
    script: string,
    existingEntryId?: string,
    overrides: { aspectRatio?: HeyGenAspectRatio; settings?: AvatarVideoSettings } = {}
  ) {
    if (!selectedDraftId || !effectiveLookId) return;
    const useAspect = overrides.aspectRatio ?? aspectRatio;
    const useSettings = withDefaultFit(
      applicableSettings(overrides.settings ?? advSettings, { engine: selectedEngine, avatarType: selectedAvatarType, mode: "tts" }),
      useAspect,
      selectedLookFrame()
    );
    setVideoLoading(true);
    setVideoError("");

    const now = new Date().toISOString();
    const entryId = existingEntryId ?? idempotencyKey;
    const selectedLookName = looks.find(l => l.id === effectiveLookId)?.name;
    const existingEntry = videos.find(v => v.id === entryId);
    const prevAttempts = existingEntry?.attempts ?? 0;

    const submittingEntry: AdLabAvatarVideoEntry = {
      id: entryId,
      kind,
      voiceSource: "twin_tts",
      lookId: effectiveLookId,
      lookName: selectedLookName,
      engine: selectedEngine,
      idempotencyKey,
      status: "submitting",
      attempts: prevAttempts + 1,
      estCostUsd: ttsVideoCostUsd,
      aspectRatio: useAspect,
      ...(Object.keys(useSettings).length ? { settings: useSettings } : {}),
      createdAt: existingEntry?.createdAt ?? now,
      updatedAt: now,
    };
    await upsertVideoEntry(submittingEntry);

    try {
      const videoRes = await fetch("/api/ad-lab/avatar/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "tts",
          kind,
          draftId: selectedDraftId,
          script: script.trim(),
          lookId: effectiveLookId,
          idempotencyKey,
          aspectRatio: useAspect,
          ...(Object.keys(useSettings).length ? { settings: useSettings } : {}),
          confirmCost: true,
        }),
      });
      const videoData = (await videoRes.json()) as {
        heygenVideoId?: string;
        jobToken?: string;
        status?: string;
        estCostUsd?: number;
        appliedSettings?: AvatarVideoSettings;
        lookId?: string;
        engine?: "avatar_v" | "avatar_iv";
        defaultVoiceId?: string;
        error?: string;
        reason?: string;
      };
      if (!videoRes.ok || !videoData.heygenVideoId || !videoData.jobToken) {
        setVideoError(videoData.error ?? videoData.reason ?? "ส่งงาน TTS ไปยัง HeyGen ไม่สำเร็จ กรุณาลองใหม่");
        await upsertVideoEntry({ ...submittingEntry, status: "failed", error: videoData.error ?? "tts submission failed", updatedAt: new Date().toISOString() });
        return;
      }
      const mappedStatus: AdLabAvatarVideoStatus =
        videoData.status === "queued" ? "queued"
        : videoData.status === "processing" ? "processing"
        : "queued";
      await upsertVideoEntry({
        ...submittingEntry,
        heygenVideoId: videoData.heygenVideoId,
        jobToken: videoData.jobToken,
        status: mappedStatus,
        lookId: videoData.lookId ?? effectiveLookId,
        engine: videoData.engine ?? selectedEngine,
        estCostUsd: videoData.estCostUsd ?? submittingEntry.estCostUsd,
        ...(videoData.appliedSettings && Object.keys(videoData.appliedSettings).length ? { settings: videoData.appliedSettings } : {}),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setVideoError("เกิดข้อผิดพลาดเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setVideoLoading(false);
    }
  }

  async function handleResendVideo() {
    if (!video?.idempotencyKey) return;
    setResendConfirmOpen(false);
    await submitVideo(video.idempotencyKey, { entryId: video.idempotencyKey });
  }

  const [retryEntryPending, setRetryEntryPending] = useState<AdLabAvatarVideoEntry | null>(null);

  async function handleRetryEntry(entry: AdLabAvatarVideoEntry) {
    const newKey = crypto.randomUUID();
    if (entry.voiceSource === "twin_tts") {
      const script = entry.kind === "test"
        ? testScript
        : (productionTtsScript || (selectedDraft ? buildSpokenText(selectedDraft) : ""));
      await submitTtsVideo(newKey, entry.kind, script, undefined, { aspectRatio: entry.aspectRatio, settings: entry.settings ?? {} });
    } else {
      await submitVideo(newKey, { forceNewAssets: true, entryId: entry.id, aspectRatio: entry.aspectRatio, settings: entry.settings ?? {} });
    }
  }

  // ---------------------------------------------------------------------------
  // Video manager callbacks

  const handleVideoManagerUpdate = useCallback((id: string, patch: Partial<AdLabAvatarVideoEntry>) => {
    const draftId = selectedDraftIdRef.current;
    if (!draftId) return;
    void update((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== draftId || !d.avatar) return d;
          const newVideos = (d.avatar.videos ?? []).map(v =>
            v.id === id ? { ...v, ...patch, updatedAt: now } : v
          );
          return { ...d, avatar: { ...d.avatar, videos: newVideos, updatedAt: now } };
        }),
      };
    });
  }, [update]);

  const handleVideoManagerDelete = useCallback((id: string) => {
    const draftId = selectedDraftIdRef.current;
    if (!draftId) return;
    void update((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== draftId || !d.avatar) return d;
          return { ...d, avatar: removeAvatarVideo(d.avatar, id, now) };
        }),
      };
    });
  }, [update]);

  const handleVideoManagerRename = useCallback((id: string, title: string) => {
    const draftId = selectedDraftIdRef.current;
    if (!draftId) return;
    void update((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== draftId || !d.avatar) return d;
          const newVideos = (d.avatar.videos ?? []).map(v =>
            v.id === id ? { ...v, title, updatedAt: now } : v
          );
          return { ...d, avatar: { ...d.avatar, videos: newVideos, updatedAt: now } };
        }),
      };
    });
  }, [update]);

  const handleSetPrimary = useCallback((id: string) => {
    const draftId = selectedDraftIdRef.current;
    if (!draftId) return;
    void update((current) => {
      const now = new Date().toISOString();
      return {
        ...current,
        drafts: current.drafts.map((d) => {
          if (d.id !== draftId || !d.avatar) return d;
          const primaryEntry = (d.avatar.videos ?? []).find(v => v.id === id);
          if (!primaryEntry || primaryEntry.status !== "ready") return d;
          const legacyVideo = legacyVideoFromEntry(primaryEntry);
          return { ...d, avatar: { ...d.avatar, primaryVideoId: id, video: legacyVideo, updatedAt: now } };
        }),
      };
    });
  }, [update]);

  // ---------------------------------------------------------------------------
  // Early returns

  if (!ready) {
    return <Card><p className="text-sm text-slate-500">กำลังโหลดข้อมูล…</p></Card>;
  }

  // ---------------------------------------------------------------------------
  // Render

  const elevenLabsBanner = config && !config.elevenLabsConfigured ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      ยังไม่ได้ตั้งค่า ElevenLabs (<code className="font-mono">ELEVENLABS_API_KEY</code>) — ยังไม่สามารถสร้างเสียงได้
    </div>
  ) : null;

  const heygenBanner = config && !config.heygenConfigured ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      ยังไม่ได้ตั้งค่า HeyGen (<code className="font-mono">HEYGEN_API_KEY</code>) — สร้างเสียงได้ แต่ยังสร้างวิดีโออวตาร์ไม่ได้
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">AI Avatar (ไม่บังคับ)</h2>
            <p className="mt-1 text-sm text-slate-600">
              แปลงสคริปต์ที่อนุมัติแล้วเป็นวิดีโออวตาร์พูดด้วย HeyGen Avatar V Digital Twin:{" "}
              <span className="text-slate-500">
                สร้างเสียงด้วย ElevenLabs → เลือก Digital Twin → ให้ HeyGen สร้างวิดีโออวตาร์ (9:16, 1080p) →
                ดาวน์โหลด → ตัดต่อเพิ่มเติมในโปรแกรมที่ต้องการ → อัปโหลดวิดีโอสุดท้ายในหน้า Publishing
              </span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSkip}>
            ข้ามไปหน้า Publishing →
          </Button>
        </div>
      </Card>

      {/* ── Config banners ─────────────────────────────────────────────────── */}
      {configLoading && <p className="text-sm text-slate-500">กำลังโหลดการตั้งค่า…</p>}
      {configError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {configError}
        </div>
      )}
      {elevenLabsBanner}
      {heygenBanner}

      {/* ── Script picker ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>เลือกสคริปต์</CardTitle>
          <CardDescription>
            สคริปต์ที่อนุมัติแล้วของแบรนด์{brand ? ` "${brand.name}"` : ""}
          </CardDescription>
        </CardHeader>

        {approvedDrafts.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-500">ยังไม่มีสคริปต์ที่อนุมัติ</p>
            <Link
              href={ROUTES.AD_LAB_CREATE}
              className="mt-2 inline-block text-sm text-blue-700 hover:underline"
            >
              ไปหน้า Create เพื่อสร้างและอนุมัติสคริปต์
            </Link>
          </div>
        ) : (
          <Select
            label="สคริปต์"
            value={selectedDraftId ?? ""}
            onChange={(e) => setSelectedDraftId(e.target.value || null)}
            options={approvedDrafts.map((d) => ({
              value: d.id,
              label: `${d.title || "(ไม่มีชื่อ)"} — ${d.updatedAt.slice(0, 10)}`,
            }))}
          />
        )}

        {selectedDraft && (
          <div className="mt-4 space-y-2">
            {isStale && (
              <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                สคริปต์ถูกแก้ไขหลังสร้างเสียง/วิดีโอ — ควรสร้างใหม่
              </div>
            )}
            {estimateLoading && <p className="text-sm text-slate-500">กำลังประมาณค่าใช้จ่าย…</p>}
            {estimate && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-end mb-1">
                  {!isEditingScript && (
                    <button
                      type="button"
                      onClick={() => { setEditText(spokenText); setIsEditingScript(true); setEditSaved(false); setEditSaveError(null); }}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      แก้ไข
                    </button>
                  )}
                </div>
                {isEditingScript ? (
                  <div className="space-y-2">
                    <textarea
                      aria-label="ข้อความสำหรับพูด"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={6}
                      className="w-full rounded border border-slate-300 bg-white p-2 text-xs font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={editSaving}
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={editTextNormalized.length > ELEVENLABS_V3_MAX_CHARS ? "text-red-600 font-medium" : "text-slate-500"}>
                        {editTextNormalized.length.toLocaleString()} / {ELEVENLABS_V3_MAX_CHARS.toLocaleString()} ตัวอักษร
                      </span>
                      {editCharError && <span role="alert" className="text-red-600">{editCharError}</span>}
                      {!editCharError && editSaveError && <span role="alert" className="text-red-600">{editSaveError}</span>}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void handleSaveScriptEdit()} disabled={!!editCharError || editSaving} loading={editSaving}>
                        บันทึก
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setIsEditingScript(false)} disabled={editSaving}>
                        ยกเลิก
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <pre aria-label="ข้อความสำหรับพูด" className="whitespace-pre-wrap text-xs text-slate-600 font-sans leading-relaxed max-h-40 overflow-y-auto">
                      {spokenText}
                    </pre>
                    {editSaved && <p className="mt-1 text-xs font-medium text-emerald-700">บันทึกแล้ว</p>}
                  </>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>{estimate.chars.toLocaleString()} ตัวอักษร</span>
                  <span>{fmtSec(adjustedEstSeconds)}</span>
                  <span>เสียง: {fmtUsd(estimate.voiceCostUsd)}</span>
                  <span>วิดีโอ (ประมาณ): {fmtUsd(adjustedVideoCostUsd)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  ราคาวิดีโอเป็นค่าประมาณ (self-serve rate จาก HeyGen; อาจแตกต่างตามแผนบัญชีของคุณ)
                </p>
                {isTooLong && (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    สคริปต์ยาวเกินกำหนด (สูงสุด {fmtSec(config?.maxSeconds ?? 180)}) —
                    กรุณาย่อสคริปต์ก่อนสร้างเสียงหรือวิดีโอ
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {selectedDraft && (
        <>
          {/* ── Voice step ───────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>1. สร้างเสียงพูด</CardTitle>
              <CardDescription>ElevenLabs แปลงข้อความสคริปต์เป็นเสียงพูด</CardDescription>
            </CardHeader>

            <div className="space-y-4">
              {config && config.voices.length > 0 && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select
                      label="เสียงพูด"
                      value={selectedVoiceId}
                      onChange={(e) => setSelectedVoiceId(e.target.value)}
                      options={config.voices.map((v) => ({
                        value: v.id,
                        label: v.gender === "female" ? `${v.label} (หญิง)` : v.gender === "male" ? `${v.label} (ชาย)` : v.label,
                      }))}
                      disabled={!config.elevenLabsConfigured || voiceLoading}
                    />
                  </div>
                  {selectedPreviewUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={togglePreview}
                      aria-label={previewPlaying ? "หยุดตัวอย่างเสียง" : "ฟังตัวอย่างเสียง"}
                    >
                      {previewPlaying ? "⏸ หยุด" : "▶ ฟังตัวอย่าง"}
                    </Button>
                  )}
                </div>
              )}

              {/* Speed segmented control */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-slate-700">ความเร็ว</p>
                <div
                  role="radiogroup"
                  aria-label="ความเร็วในการพูด"
                  className="flex rounded-lg border border-slate-200 overflow-hidden"
                  onKeyDown={(e) => {
                    const ids = AD_LAB_VOICE_SPEEDS.map((s) => s.id);
                    const idx = ids.indexOf(selectedSpeedId);
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSelectedSpeedId(ids[(idx + 1) % ids.length]); }
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setSelectedSpeedId(ids[(idx - 1 + ids.length) % ids.length]); }
                  }}
                >
                  {AD_LAB_VOICE_SPEEDS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedSpeedId === option.id}
                      tabIndex={selectedSpeedId === option.id ? 0 : -1}
                      onClick={() => setSelectedSpeedId(option.id)}
                      disabled={voiceLoading}
                      className={`flex-1 px-2 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-slate-200 ${
                        selectedSpeedId === option.id
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {estimate && <p className="text-xs text-slate-500">ความยาวโดยประมาณ: {fmtSec(adjustedEstSeconds)}</p>}
              </div>

              {/* Tone segmented control */}
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-slate-700">โทนเสียง</p>
                <div
                  role="radiogroup"
                  aria-label="โทนเสียงพูด"
                  className="flex rounded-lg border border-slate-200 overflow-hidden"
                  onKeyDown={(e) => {
                    const ids = AD_LAB_VOICE_TONES.map((t) => t.id);
                    const idx = ids.indexOf(selectedToneId);
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSelectedToneId(ids[(idx + 1) % ids.length] as AdLabVoiceToneId); }
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setSelectedToneId(ids[(idx - 1 + ids.length) % ids.length] as AdLabVoiceToneId); }
                  }}
                >
                  {AD_LAB_VOICE_TONES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedToneId === option.id}
                      tabIndex={selectedToneId === option.id ? 0 : -1}
                      onClick={() => setSelectedToneId(option.id)}
                      disabled={voiceLoading}
                      className={`flex-1 px-2 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-slate-200 ${
                        selectedToneId === option.id
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {isVoiceSettingsStale && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  การตั้งค่าเสียงเปลี่ยนไปจากที่ใช้สร้างครั้งล่าสุด — สร้างใหม่เพื่อใช้การตั้งค่าปัจจุบัน
                </div>
              )}

              <Button
                onClick={() => setVoiceConfirmOpen(true)}
                loading={voiceLoading}
                disabled={!config?.elevenLabsConfigured || !estimate || isTooLong || !selectedVoiceId || voiceLoading}
                variant={voice ? "outline" : "primary"}
              >
                {voice ? "สร้างเสียงใหม่" : "สร้างเสียงพูด"}
              </Button>

              {voiceError && <p role="alert" className="text-sm text-red-600">{voiceError}</p>}

              {liveAudioUrl && (
                <div className="space-y-1">
                  {voice && (
                    <p className="text-xs text-slate-500">
                      {voice.chars.toLocaleString()} ตัวอักษร ·{" "}
                      {voice.durationSec ? fmtSec(voice.durationSec) : fmtSec(estimate?.estSeconds ?? 0)} ·{" "}
                      ค่าใช้จ่ายโดยประมาณ {fmtUsd(voice.estCostUsd)}
                    </p>
                  )}
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls src={liveAudioUrl} className="w-full" />
                </div>
              )}

              {voice && !liveAudioUrl && <p className="text-xs text-slate-400">กำลังโหลด URL เสียง…</p>}
            </div>
          </Card>

          {/* ── Digital Twin step ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>2. เลือก / สร้าง Digital Twin</CardTitle>
              <CardDescription>
                HeyGen Avatar V จะใช้ Digital Twin ของคุณพูดสคริปต์นี้
              </CardDescription>
            </CardHeader>

            <div className="space-y-4">
              {/* ── Mode radio cards ──────────────────────────────────────────── */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setLookMode("existing")}
                  className={`rounded-lg border-2 p-4 text-left transition-colors ${
                    lookMode === "existing"
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${lookMode === "existing" ? "border-blue-500 bg-blue-500" : "border-slate-300 bg-white"}`} />
                    <span className="text-sm font-medium text-slate-800">ใช้ Digital Twin ที่มีอยู่</span>
                    <span className="ml-auto rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">ค่าเริ่มต้น</span>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-slate-500">เลือกจาก Digital Twin ที่มีในบัญชี HeyGen ของคุณ</p>
                </button>
                <button
                  type="button"
                  onClick={() => setLookMode("create")}
                  className={`rounded-lg border-2 p-4 text-left transition-colors ${
                    lookMode === "create"
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${lookMode === "create" ? "border-blue-500 bg-blue-500" : "border-slate-300 bg-white"}`} />
                    <span className="text-sm font-medium text-slate-800">สร้าง Digital Twin ใหม่</span>
                    <span className="ml-auto rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">~$1 USD</span>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-slate-500">อัปโหลดคลิปวิดีโอเพื่อสร้าง Digital Twin ใหม่ใน HeyGen</p>
                </button>
              </div>

              {/* ── (a) Existing Digital Twin panel ───────────────────────────── */}
              {lookMode === "existing" && <div className="space-y-4">
              {looksLoading && <p className="text-sm text-slate-500">กำลังโหลดรายการ Digital Twin…</p>}

              {!looksLoading && !looksConfigured && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  ยังไม่ได้ตั้งค่า HeyGen (<code className="font-mono">HEYGEN_API_KEY</code>) — ไม่สามารถโหลดรายการ Digital Twin ได้
                </div>
              )}

              {!looksLoading && looksConfigured && looks.length === 0 && !looksError && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  ยังไม่มี Digital Twin — สร้างใน HeyGen หรือใช้ตัวเลือก &quot;สร้าง Digital Twin ใหม่&quot; ด้านบน{" "}
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => void loadLooks()}
                  >
                    รีเฟรช
                  </button>
                </div>
              )}

              {looksError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {looksError}{" "}
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => void loadLooks()}
                  >
                    ลองใหม่
                  </button>
                </div>
              )}

              {!looksLoading && looksConfigured && looks.length > 0 && (
                <>
                  {/* Look cards — Task A: object-contain with natural aspect ratio */}
                  {(() => {
                    const groups: Array<{ key: string; looks: typeof looks }> = [];
                    for (const l of looks) {
                      const key = l.groupId ?? "__nogroup";
                      const g = groups.find((x) => x.key === key);
                      if (g) g.looks.push(l); else groups.push({ key, looks: [l] });
                    }
                    return groups;
                  })().map((group) => (
                  <div key={group.key} className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600">
                      {group.key === "__nogroup" ? "Twin (ไม่ทราบกลุ่ม)" : `Twin ${group.key.slice(0, 8)}…`} · {group.looks.length} look
                    </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {group.looks.map((look) => {
                      const isSelectable = look.selectable !== false;
                      const isSelected = selectedLookId === look.id && !manualLookId.trim();
                      const dims = lookImageDims[look.id];
                      const aspectRatio = dims ? `${dims.w} / ${dims.h}` : "9 / 16";
                      return (
                        <button
                          key={look.id}
                          type="button"
                          disabled={!isSelectable}
                          onClick={() => { if (isSelectable) selectLookManually(look); }}
                          className={`relative rounded-lg border-2 p-2 text-left transition-colors ${
                            !isSelectable
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-50"
                              : isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          {look.previewImageUrl ? (
                            <div
                              className="mb-2 w-full rounded overflow-hidden bg-slate-100"
                              style={{ aspectRatio }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={look.previewImageUrl}
                                alt={look.name}
                                className="h-full w-full object-contain"
                                onLoad={(e) => {
                                  const img = e.currentTarget;
                                  if (img.naturalWidth && img.naturalHeight) {
                                    setLookImageDims(prev => ({
                                      ...prev,
                                      [look.id]: { w: img.naturalWidth, h: img.naturalHeight },
                                    }));
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="mb-2 flex w-full items-center justify-center rounded bg-slate-100 text-slate-400 text-xs" style={{ aspectRatio: "9 / 16" }}>
                              ไม่มีรูปตัวอย่าง
                            </div>
                          )}
                          <p className="text-xs font-medium text-slate-800 truncate">{look.name}</p>
                          <p className="text-xs text-slate-400 truncate">{look.id}</p>
                          {(() => {
                            const o = getLookOrientation(look);
                            if (!o) return null;
                            const label = o === "portrait" ? "แนวตั้ง" : o === "landscape" ? "แนวนอน" : "สี่เหลี่ยม";
                            const wh = look.imageWidth && look.imageHeight ? ` ${look.imageWidth}×${look.imageHeight}` : "";
                            return <p className="mt-0.5 inline-block rounded bg-slate-100 px-1 text-xs text-slate-600">{label}{wh}</p>;
                          })()}
                          <p className="mt-0.5 text-xs text-slate-500 truncate">
                            {look.avatarType ?? "?"}
                            {look.engine ? ` \u00B7 ${look.engine === "avatar_v" ? "Avatar V" : "Avatar IV"}` : ""}
                          </p>
                          {!isSelectable && look.status && (
                            <p className="mt-0.5 text-xs text-amber-600">
                              {look.status === "processing" ? "กำลัง Training…" : look.status}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  </div>
                  ))}

                  {selectedLookId && !manualLookId.trim() && (
                    <p className="text-xs text-slate-500">
                      เลือกแล้ว: <span className="font-mono">{selectedLookId}</span>
                      {" · "}{looks.find((l) => l.id === selectedLookId)?.name}
                    </p>
                  )}

                  {(() => {
                    const selLook = looks.find((l) => l.id === selectedLookId);
                    const gid = lookCreation?.groupId ?? addLookForGroupId ?? undefined;
                    if (lookCreation || addLookForGroupId) {
                      return (
                        <AddTwinLookPanel
                          groupId={gid ?? selLook?.groupId ?? ""}
                          groupName={selLook?.name ?? "Twin"}
                          lookCreation={lookCreation ?? undefined}
                          onUpdateLookCreation={updateLookCreation}
                          onLookComplete={(id) => void handleNewLookComplete(id)}
                          onDismiss={() => { setAddLookForGroupId(null); void updateLookCreation(null); }}
                        />
                      );
                    }
                    if (!selLook || manualLookId.trim()) return null;
                    return (
                      <button
                        type="button"
                        disabled={!selLook.groupId}
                        title={selLook.groupId ? undefined : "Look นี้ไม่มี group id จึงเพิ่ม Look ไม่ได้"}
                        onClick={() => selLook.groupId && setAddLookForGroupId(selLook.groupId)}
                        className="rounded-lg border border-dashed border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + เพิ่ม Look แนวตั้งให้ Twin นี้ (Add portrait look)
                      </button>
                    );
                  })()}
                </>
              )}

              {/* Manual look ID override */}
              {looksConfigured && (
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700">
                    หรือระบุ Look ID เอง (ไม่บังคับ)
                  </label>
                  <input
                    type="text"
                    value={manualLookId}
                    onChange={(e) => setManualLookId(e.target.value)}
                    placeholder="เช่น digital_twin_abc123"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {manualLookId.trim() && (
                    <p className="text-xs text-slate-500">
                      จะใช้ ID นี้แทนการเลือกจากรายการ (เซิร์ฟเวอร์จะตรวจสอบสิทธิ์ก่อนสร้างวิดีโอ)
                    </p>
                  )}
                </div>
              )}

              {lookIdChanged && video?.status !== "submitting" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  วิดีโอนี้สร้างจาก Digital Twin เดิม — สร้างใหม่เพื่อใช้ twin ที่เลือกปัจจุบัน
                </div>
              )}

              {/* ── Task B: Video kind / voice source options ─────────────────── */}
              {looksConfigured && effectiveLookId && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <p className="text-sm font-semibold text-slate-800">ตัวเลือกวิดีโอ</p>

                  {/* Test / Production radio */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-600">ประเภทวิดีโอ</p>
                    <div className="flex gap-3">
                      {(["test", "production"] as AdLabVideoKind[]).map(k => (
                        <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="videoKind"
                            value={k}
                            checked={videoKind === k}
                            onChange={() => setVideoKind(k)}
                            className="accent-blue-600"
                          />
                          <span className="text-sm text-slate-700">
                            {k === "test" ? "Test video (~10 วิ)" : "Production video (เต็มสคริปต์)"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Test: sample script + cost */}
                  {videoKind === "test" && (
                    <div className="space-y-2">
                      {!selectedLookDefaultVoiceId && manualLookId.trim() && (
                        <p className="text-xs text-amber-700">
                          ไม่ทราบ defaultVoiceId ของ Look ID ที่ระบุเอง — ไม่สามารถใช้ HeyGen TTS ได้
                        </p>
                      )}
                      {!selectedLookDefaultVoiceId && !manualLookId.trim() && (
                        <p className="text-xs text-amber-700">
                          Look นี้ไม่มี default voice — ไม่สามารถสร้าง Test video แบบ TTS ได้
                        </p>
                      )}
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-600">สคริปต์ทดสอบ (แก้ไขได้)</label>
                        <textarea
                          value={testScript}
                          onChange={e => setTestScript(e.target.value)}
                          rows={4}
                          maxLength={500}
                          className="w-full rounded border border-slate-300 bg-white p-2 text-xs font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{testScript.trim().length} ตัวอักษร</span>
                          {ttsEstSeconds > 0 && <span>~{Math.round(ttsEstSeconds)} วิ · ประมาณ {fmtUsd(ttsVideoCostUsd)} (HeyGen {engineLabel})</span>}
                        </div>
                        {ttsTooLong && <p className="text-xs text-red-600">สคริปต์ยาวเกิน</p>}
                      </div>
                    </div>
                  )}

                  {/* Production: voice source radio */}
                  {videoKind === "production" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-600">แหล่งเสียง</p>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="voiceSource"
                              value="elevenlabs"
                              checked={voiceSource === "elevenlabs"}
                              onChange={() => setVoiceSource("elevenlabs")}
                              className="accent-blue-600"
                            />
                            <span className="text-sm text-slate-700">ใช้เสียงที่สร้างจาก ElevenLabs (ขั้นตอน 1)</span>
                          </label>
                          <label className={`flex items-center gap-1.5 ${(!selectedLookDefaultVoiceId || manualLookId.trim()) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                            <input
                              type="radio"
                              name="voiceSource"
                              value="twin_tts"
                              checked={voiceSource === "twin_tts"}
                              onChange={() => setVoiceSource("twin_tts")}
                              disabled={!selectedLookDefaultVoiceId || !!manualLookId.trim()}
                              className="accent-blue-600"
                            />
                            <span className="text-sm text-slate-700">ใช้เสียง Digital Twin (HeyGen TTS)</span>
                          </label>
                          {(!selectedLookDefaultVoiceId || manualLookId.trim()) && (
                            <p className="pl-6 text-xs text-amber-700">
                              {manualLookId.trim()
                                ? "ไม่ทราบ defaultVoiceId ของ Look ID ที่ระบุเอง — ไม่สามารถใช้ HeyGen TTS ได้"
                                : "Look นี้ไม่มี default voice — ตัวเลือก Digital Twin TTS ไม่พร้อมใช้งาน"}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Production TTS: editable script */}
                      {voiceSource === "twin_tts" && selectedLookDefaultVoiceId && (
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">สคริปต์ (แก้ไขได้)</label>
                          <textarea
                            value={productionTtsScript || spokenText}
                            onChange={e => setProductionTtsScript(e.target.value)}
                            rows={6}
                            maxLength={ELEVENLABS_V3_MAX_CHARS}
                            className="w-full rounded border border-slate-300 bg-white p-2 text-xs font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>{(productionTtsScript || spokenText).trim().length} / {ELEVENLABS_V3_MAX_CHARS} ตัวอักษร</span>
                            {ttsEstSeconds > 0 && <span>~{Math.round(ttsEstSeconds)} วิ · ประมาณ {fmtUsd(ttsVideoCostUsd)} (HeyGen {engineLabel})</span>}
                          </div>
                          {ttsTooLong && <p className="text-xs text-red-600">สคริปต์ยาวเกิน</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── สร้างวิดีโอ button ── */}
                  <AvatarAdvancedSettings
                    value={advSettings}
                    onChange={setAdvSettings}
                    engine={selectedEngine}
                    avatarType={selectedAvatarType}
                    ttsMode={videoKind === "test" || voiceSource === "twin_tts"}
                  />

                  {/* Aspect ratio selector (HeyGen-supported values only) */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">สัดส่วนวิดีโอ (Aspect ratio)</p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Aspect ratio">
                      {HEYGEN_ASPECT_RATIO_OPTIONS.map((opt) => {
                        const active = aspectRatio === opt.value;
                        const iconW = opt.w ? Math.round(18 * Math.min(1, opt.w / opt.h)) : 14;
                        const iconH = opt.w ? Math.round(18 * Math.min(1, opt.h / opt.w)) : 14;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setAspectRatio(opt.value)}
                            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${active ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}
                          >
                            <span className="flex h-5 w-5 items-center justify-center">
                              <span
                                className={`block border-2 ${active ? "border-blue-600" : "border-slate-500"} ${opt.w ? "rounded-[2px]" : "rounded-full border-dashed"}`}
                                style={{ width: iconW, height: iconH }}
                              />
                            </span>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const dims = lookImageDims[effectiveLookId];
                      const note = aspectFramingNote(aspectRatio, dims?.w, dims?.h);
                      return note ? <p className="text-xs text-amber-700">{note}</p> : null;
                    })()}
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={() => setVideoConfirmOpen(true)}
                      disabled={!videoStepEnabled || videoLoading}
                      loading={videoLoading}
                    >
                      สร้างวิดีโอ
                    </Button>
                    {videoError && <p role="alert" className="mt-2 text-sm text-red-600">{videoError}</p>}
                    {!videoStepEnabled && videoKind === "production" && voiceSource === "elevenlabs" && !voice && (
                      <p className="mt-1 text-xs text-slate-500">ต้องสร้างเสียงจาก ElevenLabs ก่อน (ขั้นตอน 1)</p>
                    )}
                  </div>
                </div>
              )}

              </div>}

              {/* ── (b) Create new Digital Twin panel ────────────────────────── */}
              {lookMode === "create" && <div className="space-y-4">
                {!looksConfigured && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    ยังไม่ได้ตั้งค่า HeyGen (<code className="font-mono">HEYGEN_API_KEY</code>) — ไม่สามารถสร้าง Digital Twin ได้
                  </div>
                )}

                {looksConfigured && !twinCreation && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 mb-2">ข้อกำหนดวิดีโอ</p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
                        <li>ฟอร์แมต: MP4 หรือ WebM</li>
                        <li>ความยาว: 15–600 วินาที (แนะนำ ~2 นาที)</li>
                        <li>ความละเอียด: long edge 640–4096 px (แนะนำ 1080p)</li>
                        <li>ขนาดสูงสุด: 200 MB</li>
                        <li>ใบหน้าเดียว หันหน้าเข้ากล้องตลอดคลิป</li>
                        <li>พูดอย่างชัดเจน บรรยากาศเงียบ</li>
                        <li>ค่าใช้จ่าย: ประมาณ $1 (อ้างอิงจาก HeyGen — กรุณาตรวจสอบราคา HeyGen ก่อนยืนยัน)</li>
                      </ul>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-slate-700">
                        ชื่อ Digital Twin
                      </label>
                      <input
                        type="text"
                        value={twinName}
                        onChange={(e) => setTwinName(e.target.value)}
                        placeholder="เช่น My Twin 2026"
                        maxLength={200}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-slate-700">
                        ไฟล์วิดีโอ
                      </label>
                      <input
                        type="file"
                        accept="video/mp4,video/webm"
                        onChange={handleTwinFileChange}
                        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                      />
                      {twinFile && !twinFileError && twinVideoMeta && (
                        <p className="text-xs text-slate-500">
                          {twinFile.name} · {Math.round(twinFile.size / 1024 / 1024 * 10) / 10} MB
                          {" · "}~{Math.round(twinVideoMeta.duration)} วิ
                          {" · "}{twinVideoMeta.width}×{twinVideoMeta.height}
                        </p>
                      )}
                      {twinFileError && (
                        <p role="alert" className="text-xs font-medium text-red-600">{twinFileError}</p>
                      )}
                      {twinResolutionWarning && !twinFileError && (
                        <p className="text-xs text-amber-700">{twinResolutionWarning}</p>
                      )}
                    </div>

                    <Button
                      type="button"
                      onClick={() => setTwinCostConfirmOpen(true)}
                      disabled={!twinFile || !twinName.trim() || !!twinFileError || !twinVideoMeta}
                    >
                      สร้าง Digital Twin
                    </Button>
                  </div>
                )}

                {/* Active creation status */}
                {twinCreation && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">
                        สร้าง Digital Twin: {twinCreation.name}
                      </p>
                      {(twinCreation.stage === "completed" || twinCreation.stage === "failed") && (
                        <button
                          type="button"
                          onClick={() => void handleTwinDismiss()}
                          className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                          ปิด
                        </button>
                      )}
                    </div>

                    {/* Stage indicator */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(
                        [
                          ["uploading", "อัปโหลด"],
                          ["upload_complete", "อัปโหลดสำเร็จ"],
                          ["creating", "สร้าง Twin"],
                          ["awaiting_consent", "รอยืนยันตัวตน"],
                          ["training", "กำลัง Training"],
                          ["completed", "พร้อมใช้งาน"],
                        ] as [TwinCreationStage, string][]
                      ).map(([s, label]) => {
                        const stageOrder: TwinCreationStage[] = [
                          "uploading", "upload_complete", "creating",
                          "awaiting_consent", "training", "completed",
                        ];
                        const currentIdx = stageOrder.indexOf(twinCreation.stage);
                        const thisIdx = stageOrder.indexOf(s);
                        const isDone = thisIdx < currentIdx ||
                          (twinCreation.stage === "completed" && s === "completed");
                        const isCurrent = twinCreation.stage === s;
                        const isFailed = twinCreation.stage === "failed";
                        return (
                          <span
                            key={s}
                            className={`rounded-full px-2 py-0.5 ${
                              isCurrent && !isFailed
                                ? "bg-blue-100 text-blue-800 font-semibold"
                                : isDone
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-400"
                            }`}
                          >
                            {isDone ? "✓ " : ""}{label}
                          </span>
                        );
                      })}
                      {twinCreation.stage === "failed" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          ล้มเหลว
                        </span>
                      )}
                    </div>

                    {/* Upload progress bar */}
                    {twinCreation.stage === "uploading" && twinProgress > 0 && twinProgress < 100 && (
                      <div className="space-y-1">
                        <div className="h-2 w-full rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-blue-500 transition-all"
                            style={{ width: `${twinProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-slate-500">{twinProgress}%</p>
                      </div>
                    )}

                    {/* Consent link */}
                    {(twinCreation.stage === "awaiting_consent" || twinCreation.stage === "training") &&
                      twinCreation.consentUrl && (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-600">
                            กรุณาเปิดลิงก์ด้านล่างเพื่อยืนยันตัวตน (ลิงก์ใช้ได้ 24 ชม.)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={twinCreation.consentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
                            >
                              เปิดลิงก์ยืนยันตัวตน ↗
                            </a>
                            {twinCreation.consentUrlAt &&
                              Date.now() - new Date(twinCreation.consentUrlAt).getTime() > 23 * 60 * 60 * 1000 && (
                                <button
                                  type="button"
                                  onClick={() => void handleTwinRefreshConsent()}
                                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                  ขอลิงก์ใหม่
                                </button>
                              )}
                          </div>
                          <p className="text-xs text-slate-400">
                            หลังยืนยันตัวตน ระบบจะ Training ต่อโดยอัตโนมัติ (ตรวจสอบทุก 15 วินาที)
                          </p>
                        </div>
                      )}

                    {/* Completed */}
                    {twinCreation.stage === "completed" && (
                      <p className="text-sm font-medium text-emerald-700">
                        ✓ Digital Twin พร้อมใช้งานแล้ว — เลือก &quot;ใช้ Digital Twin ที่มีอยู่&quot; ด้านบนเพื่อดำเนินการต่อ
                      </p>
                    )}

                    {/* Error */}
                    {(twinCreation.stage === "failed" || twinError) && (
                      <p role="alert" className="text-sm text-red-600">
                        {twinCreation.error ?? twinError}
                      </p>
                    )}
                  </div>
                )}
              </div>}
            </div>
          </Card>

          {/* ── Section 3: AI Avatar Video Manager (Task C) ─────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>3. จัดการ AI Avatar Videos</CardTitle>
              <CardDescription>
                รายการวิดีโออวตาร์ที่สร้างทั้งหมด — เลือกวิดีโอสำหรับ Publishing ได้จากที่นี่
                {!config?.heygenConfigured && " (ยังไม่ได้ตั้งค่า HeyGen)"}
              </CardDescription>
            </CardHeader>

            <div className="space-y-4">
              {selectedDraftId && (
                <VideoManagerSection
                  key={selectedDraftId}
                  videos={videos}
                  primaryVideoId={primaryVideoId}
                  draftId={selectedDraftId}
                  onUpdateEntry={handleVideoManagerUpdate}
                  onDeleteEntry={handleVideoManagerDelete}
                  onRenameEntry={handleVideoManagerRename}
                  onSetPrimary={handleSetPrimary}
                  onRetry={entry => setRetryEntryPending(entry)}
                />
              )}

              {/* Outdated voice warning (legacy compat) */}
              {voiceOrLookNewerThanVideo && video?.status !== "submitting" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  เสียงหรือ Digital Twin มีการอัปเดต — สร้างวิดีโอใหม่เพื่อใช้ข้อมูลล่าสุด
                </div>
              )}

              {videos.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <Link
                    href={ROUTES.AD_LAB_PUBLISHING}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
                  >
                    ไปหน้า Publishing →
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    แก้ไขวิดีโอในโปรแกรมตัดต่อ แล้วอัปโหลดไฟล์สุดท้ายในหน้า Publishing
                  </p>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ── Confirm dialogs ─────────────────────────────────────────────────── */}
      <CostConfirmDialog
        open={retryEntryPending !== null}
        title="สร้างวิดีโอใหม่ (Regenerate)"
        lines={[
          `ค่าใช้จ่ายโดยประมาณ (HeyGen): ${fmtUsd(retryEntryPending?.estCostUsd ?? adjustedVideoCostUsd)}`,
          "จะสร้างงานใหม่ด้วย idempotency key ใหม่ และเสียค่าใช้จ่ายจริง",
        ]}
        onConfirm={() => { const e = retryEntryPending; setRetryEntryPending(null); if (e) void handleRetryEntry(e); }}
        onCancel={() => setRetryEntryPending(null)}
      />
      <CostConfirmDialog
        open={voiceConfirmOpen}
        title="ยืนยันการสร้างเสียงพูด"
        lines={[
          `จำนวนตัวอักษร: ${(estimate?.chars ?? 0).toLocaleString()} ตัวอักษร`,
          `ความยาวโดยประมาณ: ${fmtSec(adjustedEstSeconds)}`,
          `ค่าใช้จ่ายโดยประมาณ (ElevenLabs): ${fmtUsd(estimate?.voiceCostUsd ?? 0)}`,
          "การดำเนินการนี้ใช้เครดิต ElevenLabs จริง",
          ...(voice ? ["หากมีเสียงเดิมอยู่แล้ว จะถูกแทนที่ด้วยเสียงใหม่"] : []),
        ]}
        onConfirm={() => { setVoiceConfirmOpen(false); void handleGenerateVoice(); }}
        onCancel={() => setVoiceConfirmOpen(false)}
      />

      <CostConfirmDialog
        open={videoConfirmOpen}
        title={videoKind === "test" ? "ยืนยันการสร้าง Test Video (HeyGen TTS)" : "ยืนยันการสร้างวิดีโออวตาร์ (Avatar V Digital Twin)"}
        lines={[
          `Aspect ratio: ${aspectRatio}`,
          ...(() => {
            const s = settingsSummary(withDefaultFit(
              applicableSettings(advSettings, { engine: selectedEngine, avatarType: selectedAvatarType, mode: videoKind === "test" || voiceSource === "twin_tts" ? "tts" : "audio" }),
              aspectRatio,
              selectedLookFrame()
            ));
            return s ? [`ตั้งค่าขั้นสูง: ${s}`] : [];
          })(),
          videoKind === "test"
            ? `ความยาวโดยประมาณ: ${fmtSec(ttsEstSeconds)}`
            : voiceSource === "elevenlabs"
            ? `ความยาววิดีโอโดยประมาณ: ${fmtSec(adjustedEstSeconds)}`
            : `ความยาวโดยประมาณ: ${fmtSec(ttsEstSeconds)}`,
          `ค่าใช้จ่ายโดยประมาณ (HeyGen ${engineLabel}): ${fmtUsd(
            videoKind === "test" || voiceSource === "twin_tts" ? ttsVideoCostUsd : adjustedVideoCostUsd
          )}`,
          "ราคาเป็นค่าประมาณ (self-serve rate) — อาจแตกต่างตามแผนบัญชีของคุณ",
          "การดำเนินการนี้ใช้เครดิต HeyGen จริง",
          "การสร้างวิดีโออาจใช้เวลาหลายนาที",
        ]}
        confirmLabel="ยืนยันและส่งงาน"
        onConfirm={() => {
          setVideoConfirmOpen(false);
          const newKey = crypto.randomUUID();
          if (videoKind === "test") {
            void submitTtsVideo(newKey, "test", testScript);
          } else if (voiceSource === "twin_tts") {
            void submitTtsVideo(newKey, "production", productionTtsScript || spokenText);
          } else {
            void submitVideo(newKey, { forceNewAssets: true });
          }
        }}
        onCancel={() => setVideoConfirmOpen(false)}
      />

      <CostConfirmDialog
        open={resendConfirmOpen}
        title="ส่งงานอีกครั้ง (idempotency key เดิม)"
        lines={[
          "จะใช้ idempotency key เดิม — HeyGen จะตรวจสอบว่างานถูกสร้างไปแล้วหรือยัง",
          "ไม่มีค่าใช้จ่ายซ้ำหากงานถูกสร้างแล้ว (ภายใน 24 ชั่วโมง)",
        ]}
        confirmLabel="ส่งงานอีกครั้ง"
        onConfirm={() => void handleResendVideo()}
        onCancel={() => setResendConfirmOpen(false)}
      />

      {/* ── Twin cost confirm dialog ────────────────────────────────────────── */}
      <CostConfirmDialog
        open={twinCostConfirmOpen}
        title="ยืนยันการสร้าง Digital Twin"
        lines={[
          "การสร้าง Digital Twin ใช้เครดิต HeyGen จริง",
          "ค่าใช้จ่ายโดยประมาณ: ~$1 USD (ราคาอาจแตกต่างตามแผน HeyGen ของคุณ — กรุณาตรวจสอบก่อนยืนยัน)",
          "กระบวนการจะใช้เวลาหลายนาที และต้องยืนยันตัวตนผ่าน HeyGen",
          twinFile ? `ไฟล์: ${twinFile.name} (${Math.round(twinFile.size / 1024 / 1024 * 10) / 10} MB)` : "",
          twinVideoMeta ? `ความยาว: ~${Math.round(twinVideoMeta.duration)} วินาที` : "",
        ].filter(Boolean)}
        confirmLabel="ยืนยันและเริ่มอัปโหลด"
        onConfirm={() => { setTwinCostConfirmOpen(false); void handleTwinCreate(); }}
        onCancel={() => setTwinCostConfirmOpen(false)}
      />

      {/* ── Bottom skip link ────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSkip}
          className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
        >
          ข้ามไปหน้า Publishing →
        </button>
      </div>
    </div>
  );
}
