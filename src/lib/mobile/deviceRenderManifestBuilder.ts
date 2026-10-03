import {
  DEVICE_RENDER_CONTRACT_VERSION,
  DEVICE_RENDER_DIMENSIONS,
  TRAVY_CAPTION_LANGUAGES,
  validateDeviceRenderManifest,
  type DeviceRenderManifest,
  type DeviceRenderRatio,
  type DeviceRenderScene,
  type DeviceRenderSource,
  type DeviceRenderStage,
  type DeviceRenderUpload,
} from "@/lib/mobile/deviceRenderContract";
import {
  DEVICE_MIX_LIMIT,
  DEVICE_MIX_SAMPLE_RATE,
  DEVICE_MUSIC_BED_VOLUME,
  DEVICE_MUSIC_DUCK_ATTACK_MS,
  DEVICE_MUSIC_DUCK_RATIO,
  DEVICE_MUSIC_DUCK_RELEASE_MS,
  DEVICE_MUSIC_DUCK_THRESHOLD,
  DEVICE_MUSIC_LEAD_IN_SECONDS,
  DEVICE_VOICE_MAX_GAIN_DB,
  DEVICE_VOICE_TARGET_LUFS,
  DEVICE_VOICE_TRUE_PEAK_DB,
} from "@/lib/mobile/deviceRenderAudio";
import {
  DEVICE_SCENE_CROSSFADE_SECONDS,
  DEVICE_TRANSITION_SECONDS,
  devicePlaybackRate,
  type CaptionLanguage,
} from "@/lib/mobile/deviceRenderCaptions";
import { MONTAGE_FPS, type MontageTransition, type MotionPreset } from "@/config/montage";

/**
 * Build a device render manifest from APPROVED job data.
 *
 * Deliberately pure and repository-free. `DeviceRenderService` does the
 * loading, the signing and the lease; this function does the translation, which
 * is the part that has to be right and the only part worth testing
 * exhaustively. Anything it cannot derive from its input is a thrown error,
 * never a default — a manifest that quietly invents a duration or a focus point
 * produces a video nobody approved.
 */

/** One source asset as the caller already has it, in canonical index order. */
export interface ManifestSourceInput {
  assetId: string;
  kind: "image" | "clip";
  /** A short-lived, object-scoped URL. Mutually exclusive with `localId`. */
  url?: string;
  /** A handle into the device's private storage, for local-first material. */
  localId?: string;
  mimeType: string;
  durationSeconds: number | null;
}

/** One scene of the approved plan, already resolved to concrete asset ids. */
export interface ManifestSceneInput {
  sceneNumber: number;
  transitionIn?: MontageTransition | null;
  assets: {
    sourceAssetId: string;
    durationSeconds: number;
    motion: MotionPreset;
    trimStartSeconds?: number | null;
    trimEndSeconds?: number | null;
    focusX?: number | null;
    focusY?: number | null;
    /** 0 = whole picture, 1 = fill the frame (default). */
    frameZoom?: number | null;
  }[];
}

/** A caption cue in VOICE time — the builder applies the lead-in shift. */
export interface ManifestCaptionInput {
  startSecond: number;
  endSecond: number;
  textThai?: string | null;
  textEnglish?: string | null;
  textChinese?: string | null;
}

export interface ManifestTemplateInput {
  id: string;
  frame: "full_bleed" | "corner_bracket" | "polaroid" | "rounded_inset";
  canvas: "none" | "black" | "palette_light" | "palette_dark";
  decor: string[];
  palette: { primary: string; secondary: string; accent: string; neutral: string };
}

export interface BuildDeviceRenderManifestInput {
  attemptId: string;
  taskId: string;
  jobId: string;
  requestId: string;
  step: string;
  stage: DeviceRenderStage;
  ratio: DeviceRenderRatio;
  travy?: boolean;
  sources: ManifestSourceInput[];
  scenes: ManifestSceneInput[];
  /**
   * The input this stage builds on: the silent montage for `master`, the merged
   * master for `final`.
   */
  inputVideoUrl?: string | null;
  voiceUrl?: string | null;
  musicUrl?: string | null;
  voiceDurationSeconds?: number | null;
  /** Cues in voice time; the builder shifts them by the music lead-in. */
  captions?: ManifestCaptionInput[];
  captionLanguages?: CaptionLanguage[];
  /**
   * Whether the requester selected background music for this job. Needed at the
   * `final` stage too, where no music URL is sent but the caption shift still
   * has to match the master that was actually mixed.
   */
  musicSelected?: boolean;
  template: ManifestTemplateInput;
  upload?: DeviceRenderUpload | null;
  leaseExpiresAt: Date;
  maxOutputBytes: number;
  fps?: number;
  /**
   * Compose this master or final from the originals in one encode (plugin
   * version 6+) instead of from `inputVideoUrl`. Ignored for a montage.
   */
  buildFromSources?: boolean;
}

/** Captions and graphics start `leadIn` later because the master opens on music. */
export function captionShiftSeconds(musicSelected: boolean): number {
  return musicSelected ? DEVICE_MUSIC_LEAD_IN_SECONDS : 0;
}

function clamp01(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * The window of footage a clip shot actually plays.
 *
 * A shot with no explicit window plays from its start for as long as its slot,
 * bounded by the source duration when one is known. This mirrors the pinning
 * `_buildSceneRenderSpec` does with ffprobe before a server render, so a device
 * blacks out at the same point the Mac does instead of freezing a frame.
 */
function resolveTrim(
  shot: ManifestSceneInput["assets"][number],
  source: ManifestSourceInput
): { start: number; end: number | null } {
  const start = Number.isFinite(shot.trimStartSeconds) ? Number(shot.trimStartSeconds) : 0;
  if (Number.isFinite(shot.trimEndSeconds) && Number(shot.trimEndSeconds) > start) {
    return { start, end: Number(shot.trimEndSeconds) };
  }
  if (source.durationSeconds != null && source.durationSeconds > start) {
    return { start, end: Math.min(source.durationSeconds, start + shot.durationSeconds) };
  }
  return { start, end: null };
}

function toManifestSource(source: ManifestSourceInput): DeviceRenderSource {
  return {
    assetId: source.assetId,
    kind: source.kind,
    ...(source.url ? { url: source.url } : {}),
    ...(source.localId ? { localId: source.localId } : {}),
    mimeType: source.mimeType,
    durationSeconds: source.durationSeconds,
  } as DeviceRenderSource;
}

export function buildDeviceRenderManifest(
  input: BuildDeviceRenderManifestInput
): DeviceRenderManifest {
  const dimensions = DEVICE_RENDER_DIMENSIONS[input.ratio];
  if (!dimensions) throw new Error(`Unsupported render ratio: ${input.ratio}`);

  const sourcesById = new Map<string, ManifestSourceInput>();
  for (const source of input.sources) {
    if (sourcesById.has(source.assetId)) {
      throw new Error(`Duplicate source asset in the approved plan: ${source.assetId}`);
    }
    sourcesById.set(source.assetId, source);
  }

  // A stage that builds from an existing render does not need the scene plan or
  // the source material at all — sending either would mean a phone downloading
  // photos it will not draw. A master or final composed from the originals
  // needs both, and no intermediate.
  const fromSourcesFlag = input.stage !== "montage" && Boolean(input.buildFromSources);
  const buildsFromSources = input.stage === "montage" || fromSourcesFlag;

  const usedSourceIds = new Set<string>();
  const scenes: DeviceRenderScene[] = !buildsFromSources
    ? []
    : input.scenes.map((scene) => {
        if (scene.assets.length === 0) {
          throw new Error(`Approved scene ${scene.sceneNumber} has no assets`);
        }
        return {
          sceneNumber: scene.sceneNumber,
          transitionIn: scene.transitionIn ?? "fade",
          shotTransitionSeconds: DEVICE_TRANSITION_SECONDS,
          assets: scene.assets.map((shot) => {
            const source = sourcesById.get(shot.sourceAssetId);
            if (!source) {
              throw new Error(
                `Approved scene ${scene.sceneNumber} refers to unknown source ${shot.sourceAssetId}`
              );
            }
            if (!(shot.durationSeconds > 0)) {
              throw new Error(`Approved scene ${scene.sceneNumber} has a shot with no duration`);
            }
            usedSourceIds.add(source.assetId);

            const focusX = clamp01(shot.focusX, 0.5);
            const focusY = clamp01(shot.focusY, 0.5);
            const frameZoom = clamp01(shot.frameZoom, 1);

            if (source.kind === "image") {
              return {
                sourceAssetId: source.assetId,
                durationSeconds: shot.durationSeconds,
                motion: shot.motion,
                focusX,
                focusY,
                frameZoom,
                playbackRate: 1,
              };
            }

            const { start, end } = resolveTrim(shot, source);
            const footage = end != null ? end - start : shot.durationSeconds;
            return {
              sourceAssetId: source.assetId,
              durationSeconds: shot.durationSeconds,
              // A clip always plays as shot; a stale plan that stored a Ken
              // Burns preset on a clip is normalised here rather than rejected,
              // matching `toRenderAssetSpecs`.
              motion: "static" as MotionPreset,
              trimStartSeconds: start,
              ...(end != null ? { trimEndSeconds: end } : {}),
              focusX,
              focusY,
              frameZoom,
              playbackRate: devicePlaybackRate(footage, shot.durationSeconds),
            };
          }),
        };
      });

  // Ship only the sources the approved scenes actually use. An unused source is
  // one more signed URL and one more file a phone would download for nothing.
  const sources = buildsFromSources
    ? input.sources.filter((s) => usedSourceIds.has(s.assetId)).map(toManifestSource)
    : [];

  if (buildsFromSources && sources.length === 0) {
    throw new Error("A montage manifest needs at least one approved source");
  }

  const isFinal = input.stage === "final";
  const isMaster = input.stage === "master";
  // Who mixes the audio: the master always; a final only when it is composed
  // from the originals (otherwise it carries the master's mix through).
  const mixesAudio = isMaster || (isFinal && fromSourcesFlag);
  const musicSelected =
    input.musicSelected ?? (mixesAudio ? Boolean(input.musicUrl) : false);
  const shift = captionShiftSeconds(musicSelected);

  const captionLanguages: CaptionLanguage[] = !isFinal
    ? []
    : input.travy
      ? [...TRAVY_CAPTION_LANGUAGES]
      : input.captionLanguages && input.captionLanguages.length > 0
        ? input.captionLanguages
        : (["en", "zh"] as CaptionLanguage[]);

  const captions = isFinal
    ? (input.captions ?? [])
        .filter((cue) => cue.endSecond > cue.startSecond)
        .map((cue) => ({
          startSeconds: Math.max(0, cue.startSecond + shift),
          endSeconds: cue.endSecond + shift,
          textThai: cue.textThai ?? "",
          textEnglish: cue.textEnglish ?? "",
          textChinese: cue.textChinese ?? "",
        }))
        .filter((cue) => Boolean(cue.textThai || cue.textEnglish || cue.textChinese))
        .sort((a, b) => a.startSeconds - b.startSeconds)
    : [];

  const manifest = {
    version: DEVICE_RENDER_CONTRACT_VERSION as typeof DEVICE_RENDER_CONTRACT_VERSION,
    attemptId: input.attemptId,
    taskId: input.taskId,
    jobId: input.jobId,
    requestId: input.requestId,
    step: input.step,
    stage: input.stage,
    travy: Boolean(input.travy),
    ratio: input.ratio,
    width: dimensions.width,
    height: dimensions.height,
    fps: input.fps ?? MONTAGE_FPS,
    sceneTransitionSeconds: DEVICE_SCENE_CROSSFADE_SECONDS,
    sources,
    scenes,
    masterUrl: buildsFromSources ? null : (input.inputVideoUrl ?? null),
    voiceUrl: mixesAudio ? (input.voiceUrl ?? null) : null,
    musicUrl: mixesAudio ? (input.musicUrl ?? null) : null,
    audio: {
      sourceClipAudio: false as const,
      musicSelected: mixesAudio ? musicSelected : false,
      sampleRate: DEVICE_MIX_SAMPLE_RATE as typeof DEVICE_MIX_SAMPLE_RATE,
      voiceLeadInSeconds: mixesAudio ? shift : 0,
      musicBedVolume: DEVICE_MUSIC_BED_VOLUME as typeof DEVICE_MUSIC_BED_VOLUME,
      musicDuckRatio: DEVICE_MUSIC_DUCK_RATIO as typeof DEVICE_MUSIC_DUCK_RATIO,
      musicDuckThreshold: DEVICE_MUSIC_DUCK_THRESHOLD as typeof DEVICE_MUSIC_DUCK_THRESHOLD,
      musicDuckAttackMs: DEVICE_MUSIC_DUCK_ATTACK_MS as typeof DEVICE_MUSIC_DUCK_ATTACK_MS,
      musicDuckReleaseMs: DEVICE_MUSIC_DUCK_RELEASE_MS as typeof DEVICE_MUSIC_DUCK_RELEASE_MS,
      voiceTargetLufs: DEVICE_VOICE_TARGET_LUFS as typeof DEVICE_VOICE_TARGET_LUFS,
      voiceTruePeakDb: DEVICE_VOICE_TRUE_PEAK_DB as typeof DEVICE_VOICE_TRUE_PEAK_DB,
      voiceMaxGainDb: DEVICE_VOICE_MAX_GAIN_DB as typeof DEVICE_VOICE_MAX_GAIN_DB,
      mixLimit: DEVICE_MIX_LIMIT as typeof DEVICE_MIX_LIMIT,
      voiceDurationSeconds: input.voiceDurationSeconds ?? null,
    },
    captions,
    captionLanguages,
    template: {
      id: input.template.id,
      frame: input.template.frame,
      canvas: input.template.canvas,
      decor: input.template.decor,
      palette: input.template.palette,
    },
    output: {
      mimeType: "video/mp4" as const,
      videoCodec: "h264" as const,
      audioCodec: input.stage === "montage" ? null : ("aac" as const),
      maxBytes: input.maxOutputBytes,
      coverRequired: isFinal,
      coverAtSeconds: 1,
    },
    upload: input.upload ?? null,
    leaseExpiresAt: input.leaseExpiresAt.toISOString(),
    buildFromSources: fromSourcesFlag,
  };

  // Validate what we just built rather than trusting it: the builder and the
  // contract are edited by different changes, and the device is not the place
  // to discover they disagree.
  return validateDeviceRenderManifest(manifest);
}
