"use client";

import {
  DEVICE_RENDER_CONTRACT_VERSION,
  DEVICE_RENDER_DIMENSIONS,
  validateDeviceRenderManifest,
  type DeviceRenderManifest,
  type DeviceRenderStage,
} from "@/lib/mobile/deviceRenderContract";
import { deviceAudioMixSpec, DEVICE_MUSIC_LEAD_IN_SECONDS } from "@/lib/mobile/deviceRenderAudio";
import { DEVICE_SCENE_CROSSFADE_SECONDS, DEVICE_TRANSITION_SECONDS, devicePlaybackRate } from "@/lib/mobile/deviceRenderCaptions";
import { MONTAGE_FPS } from "@/config/montage";
import { getTemplate } from "@/config/motionTemplates";
import {
  observeManifestProgress,
  releaseRenderedOutput,
  renderManifestOnDevice,
  supportsManifestRender,
  type NativeManifestResult,
  type StagedLocalSource,
} from "@/lib/mobile/deviceRenderBridge";
import { stageLocalSourceForNative, releaseStagedLocalSource } from "@/lib/mobile/deviceVideoRender";
import { documentDurationSeconds, findSource, shotFrameZoom, type EditorDocument } from "./editorState";

/**
 * Local drafts: the same renderer, the same manifest, no server.
 *
 * WHY THIS EXISTS AT ALL. The editor has to be usable before a request has an
 * approved scene plan, an ElevenLabs voice or a queued render step — otherwise
 * there is no way to see what the phone renderer does with your own footage.
 * But a second, simpler "draft mode" renderer would be a second thing to keep in
 * sync, and the old lab's draft was exactly that: it produced a file the real
 * pipeline could never produce.
 *
 * So a draft is a real manifest — same version, same validation, same three
 * stages — built from the editor's document instead of from approved job data,
 * with `localId` sources and locally chosen audio. What comes out is what a
 * production render would produce from the same material, minus the approval,
 * the upload and the job.
 *
 * WHAT A DRAFT IS NOT. It has no attempt, no lease and no completion; nothing
 * it produces reaches a requester, a channel or the job record. The UI says so.
 */

const DRAFT_PREFIX = "draft";

/**
 * The palette a draft decorates with.
 *
 * Production renders derive this per job from the business profile and script
 * (`_deriveOverlayPalette`), but that lives behind a server module and a Gemini
 * call. A draft uses the same fallback the server falls back to, so the colours
 * a tester sees are colours the pipeline really does ship.
 */
const DRAFT_PALETTE = {
  primary: "#FF6B35",
  secondary: "#FFB703",
  accent: "#06D6A0",
  neutral: "#FFFFFF",
} as const;

export interface LocalDraftResult {
  montage: NativeManifestResult;
  master?: NativeManifestResult;
  final?: NativeManifestResult;
  /** The last stage that succeeded, which is what the preview should show. */
  preview: NativeManifestResult;
}

export interface LocalDraftOptions {
  /** Captions to burn in, in voice time. Empty means the draft stops at master. */
  captions?: {
    startSecond: number;
    endSecond: number;
    textThai?: string;
    textEnglish?: string;
    textChinese?: string;
  }[];
  onProgress?: (stage: DeviceRenderStage, percent: number) => void;
  shouldCancel?: () => boolean;
}

/** A synthetic manifest for one draft stage. Never leaves the device. */
function draftManifest(
  document: EditorDocument,
  stage: DeviceRenderStage,
  options: {
    inputVideoUrl?: string | null;
    voiceUrl?: string | null;
    musicUrl?: string | null;
    captions?: LocalDraftOptions["captions"];
    voiceDurationSeconds?: number | null;
  }
): DeviceRenderManifest {
  const dimensions = DEVICE_RENDER_DIMENSIONS[document.ratio];
  const template = getTemplate(document.templateId);
  const musicSelected = stage === "master" && Boolean(options.musicUrl);
  const mix = deviceAudioMixSpec(musicSelected);
  const shift = musicSelected ? DEVICE_MUSIC_LEAD_IN_SECONDS : 0;

  const buildsFromSources = stage === "montage";

  const usedSourceIds = new Set<string>();
  const scenes = !buildsFromSources
    ? []
    : document.scenes
        .filter((scene) => scene.shots.length > 0)
        .map((scene, index) => ({
          sceneNumber: index,
          transitionIn: scene.transitionIn,
          shotTransitionSeconds: DEVICE_TRANSITION_SECONDS,
          assets: scene.shots.map((shot) => {
            const source = findSource(document, shot.sourceId);
            if (!source) throw new Error("A shot refers to media that is no longer here.");
            usedSourceIds.add(source.id);

            if (source.kind === "image") {
              return {
                sourceAssetId: source.id,
                durationSeconds: shot.durationSeconds,
                motion: shot.motion,
                focusX: shot.focusX,
                focusY: shot.focusY,
                frameZoom: shotFrameZoom(shot, source, document.ratio),
                playbackRate: 1,
              };
            }
            const end =
              shot.trimEndSeconds ??
              (source.durationSeconds != null
                ? Math.min(source.durationSeconds, shot.trimStartSeconds + shot.durationSeconds)
                : null);
            const footage = end != null ? end - shot.trimStartSeconds : shot.durationSeconds;
            return {
              sourceAssetId: source.id,
              durationSeconds: shot.durationSeconds,
              motion: "static" as const,
              trimStartSeconds: shot.trimStartSeconds,
              ...(end != null ? { trimEndSeconds: end } : {}),
              focusX: shot.focusX,
              focusY: shot.focusY,
              frameZoom: shotFrameZoom(shot, source, document.ratio),
              playbackRate: devicePlaybackRate(footage, shot.durationSeconds),
            };
          }),
        }));

  const sources = buildsFromSources
    ? document.sources
        .filter((source) => usedSourceIds.has(source.id))
        .map((source) => ({
          assetId: source.id,
          kind: source.kind,
          // A draft's originals are on this phone and stay there, which is the
          // same promise the local-first submission path makes.
          localId: source.id,
          mimeType: source.file.type || (source.kind === "clip" ? "video/mp4" : "image/jpeg"),
          durationSeconds: source.durationSeconds,
        }))
    : [];

  const isFinal = stage === "final";
  const captions = isFinal
    ? (options.captions ?? [])
        .filter((cue) => cue.endSecond > cue.startSecond)
        .map((cue) => ({
          startSeconds: Math.max(0, cue.startSecond + shift),
          endSeconds: cue.endSecond + shift,
          textThai: cue.textThai ?? "",
          textEnglish: cue.textEnglish ?? "",
          textChinese: cue.textChinese ?? "",
        }))
        .sort((a, b) => a.startSeconds - b.startSeconds)
    : [];

  return validateDeviceRenderManifest({
    version: DEVICE_RENDER_CONTRACT_VERSION,
    attemptId: `${DRAFT_PREFIX}_${stage}`,
    taskId: `${DRAFT_PREFIX}_task`,
    jobId: `${DRAFT_PREFIX}_job`,
    requestId: `${DRAFT_PREFIX}_request`,
    step: `${DRAFT_PREFIX}_${stage}`,
    stage,
    travy: false,
    ratio: document.ratio,
    width: dimensions.width,
    height: dimensions.height,
    fps: MONTAGE_FPS,
    sceneTransitionSeconds: DEVICE_SCENE_CROSSFADE_SECONDS,
    sources,
    scenes,
    masterUrl: buildsFromSources ? null : (options.inputVideoUrl ?? null),
    voiceUrl: stage === "master" ? (options.voiceUrl ?? null) : null,
    musicUrl: stage === "master" ? (options.musicUrl ?? null) : null,
    audio: {
      sourceClipAudio: false,
      musicSelected,
      sampleRate: mix.sampleRate,
      voiceLeadInSeconds: shift,
      musicBedVolume: mix.musicBedVolume,
      musicDuckRatio: mix.duckRatio,
      musicDuckThreshold: mix.duckThreshold,
      musicDuckAttackMs: mix.duckAttackMs,
      musicDuckReleaseMs: mix.duckReleaseMs,
      voiceTargetLufs: mix.voiceTargetLufs,
      voiceTruePeakDb: mix.voiceTruePeakDb,
      voiceMaxGainDb: mix.voiceMaxGainDb,
      mixLimit: mix.limit,
      voiceDurationSeconds: options.voiceDurationSeconds ?? null,
    },
    captions,
    captionLanguages: isFinal ? document.captionLanguages : [],
    template: {
      id: template.id,
      frame: template.frame,
      canvas: template.canvas,
      decor: template.decor,
      palette: DRAFT_PALETTE,
    },
    output: {
      mimeType: "video/mp4",
      videoCodec: "h264",
      audioCodec: buildsFromSources ? null : "aac",
      maxBytes: 400 * 1024 * 1024,
      coverRequired: isFinal,
      coverAtSeconds: 1,
    },
    upload: null,
    // A draft has no lease; the field is required, so it carries a time far
    // enough ahead that nothing treats the draft as expired.
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

/**
 * Render a draft on this phone: montage, then — if a voice was chosen — the
 * mixed master, then — if there are captions — the finished export.
 *
 * Each stage's output is fed to the next as a staged local file, exactly as the
 * production chain does, so a draft exercises the same code the real pipeline
 * will run.
 */
export async function renderLocalDraft(
  document: EditorDocument,
  options: LocalDraftOptions = {}
): Promise<LocalDraftResult> {
  if (!(await supportsManifestRender())) {
    throw new Error("This app build cannot render on the phone yet. Install the current app.");
  }
  if (documentDurationSeconds(document) <= 0) {
    throw new Error("Add some shots before rendering.");
  }

  const staged: string[] = [];
  const produced: NativeManifestResult[] = [];
  let stopProgress: (() => Promise<void>) | null = null;
  let currentStage: DeviceRenderStage = "montage";

  const stageFile = async (file: File): Promise<string> => {
    const result = await stageLocalSourceForNative(file);
    staged.push(result.sourceUrl);
    return result.sourceUrl;
  };

  try {
    stopProgress = await observeManifestProgress({
      onRender: (percent) => options.onProgress?.(currentStage, percent),
    });

    // ── montage ─────────────────────────────────────────────────────────────
    const montageSources: StagedLocalSource[] = [];
    for (const source of document.sources) {
      const result = await stageLocalSourceForNative(source.file);
      staged.push(result.sourceUrl);
      montageSources.push({ key: source.id, sourceUrl: result.sourceUrl });
    }

    const montage = await renderManifestOnDevice(
      draftManifest(document, "montage", {}),
      montageSources
    );
    produced.push(montage);
    if (options.shouldCancel?.()) return { montage, preview: montage };

    // ── master ──────────────────────────────────────────────────────────────
    // Without a voice there is nothing to mix, and a "master" with no narration
    // would be a silent file pretending to be a finished one. The draft stops at
    // the montage and the UI says why.
    if (!document.voiceFile) {
      return { montage, preview: montage };
    }

    currentStage = "master";
    const voiceUrl = await stageFile(document.voiceFile);
    const musicUrl = document.musicFile ? await stageFile(document.musicFile) : null;

    const master = await renderManifestOnDevice(
      draftManifest(document, "master", {
        inputVideoUrl: `file://${montage.path}`,
        voiceUrl: "file://voice",
        musicUrl: musicUrl ? "file://music" : null,
      }),
      [
        { key: "input", sourceUrl: `file://${montage.path}` },
        { key: "voice", sourceUrl: voiceUrl },
        ...(musicUrl ? [{ key: "music", sourceUrl: musicUrl }] : []),
      ]
    );
    produced.push(master);
    if (options.shouldCancel?.()) return { montage, master, preview: master };

    // ── final ───────────────────────────────────────────────────────────────
    // With no cues there is nothing to burn in; the master IS the draft.
    if (!options.captions || options.captions.length === 0) {
      return { montage, master, preview: master };
    }

    currentStage = "final";
    const final = await renderManifestOnDevice(
      draftManifest(document, "final", {
        inputVideoUrl: `file://${master.path}`,
        captions: options.captions,
      }),
      [{ key: "input", sourceUrl: `file://${master.path}` }]
    );
    produced.push(final);
    return { montage, master, final, preview: final };
  } catch (error) {
    // Everything a failed draft produced is scratch; leaving it in the plugin's
    // cache is how a phone with a full disk gets fuller.
    await Promise.allSettled(produced.map((result) => releaseRenderedOutput(result.path)));
    throw error;
  } finally {
    await stopProgress?.();
    await Promise.allSettled(staged.map((url) => releaseStagedLocalSource(url)));
  }
}

/** Free every file a finished draft is holding. */
export async function releaseLocalDraft(result: LocalDraftResult | null): Promise<void> {
  if (!result) return;
  const files = [result.montage, result.master, result.final].filter(Boolean);
  await Promise.allSettled(
    files.flatMap((item) => [
      releaseRenderedOutput(item!.path),
      ...(item!.coverPath ? [releaseRenderedOutput(item!.coverPath)] : []),
    ])
  );
}
