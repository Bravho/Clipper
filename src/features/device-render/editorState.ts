"use client";

import { PIPELINE_STEP_COSTS, STUDIO_MAX_DURATION_SECONDS } from "@/config/credits";
import {
  ACCEPTED_MIME_TYPES,
  MAX_CLIP_DURATION_SECONDS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_UPLOAD_COUNT,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from "@/domain/enums/AssetType";
import type { MontageTransition, MotionPreset } from "@/config/montage";
import { Platform } from "@/domain/enums/Platform";
import { studioEnglish, type StudioT } from "./studioText";
import type { CaptionLanguage } from "@/lib/mobile/deviceRenderCaptions";
import {
  aspectOfRatio,
  suggestFrameZoom,
  type SubjectBox,
} from "@/lib/mobile/shotFraming";

/**
 * The editor's working document.
 *
 * A deliberately small, serialisable shape. It is NOT the job — the job lives on
 * the server and is the only thing that can approve, charge or publish anything.
 * This is what the person is arranging on the phone before any of that happens,
 * and what a local draft render is built from.
 */

export type EditorRatio = "9:16" | "16:9" | "1:1" | "4:5";

export interface EditorSource {
  /** Stable within this editing session. */
  id: string;
  kind: "image" | "clip";
  /** The picked file, held in memory for the session. */
  file: File;
  /** Object URL for the file itself. Revoked on removal. */
  previewUrl: string;
  /**
   * A real still to show in the grid, the timeline and the storyboard.
   *
   * For a photo this is the file. For a clip it is a frame captured out of the
   * video, because a `<video>` element pointed at a blob URL paints the
   * WebView's grey play-button placeholder rather than the footage — which is
   * how three different clips ended up looking identical on the phone. Null
   * only when the capture failed; the UI then shows the file name, never a
   * placeholder that pretends to be a picture.
   */
  posterUrl: string | null;
  /** Real length for a clip; null for a still. */
  durationSeconds: number | null;
  fileName: string;
  /**
   * Key of the app's private copy of the picked file (see pickedFile.ts), to
   * delete it with the source. Absent when no copy could be made.
   */
  snapshotKey?: string | null;
  /** Width ÷ height as shown (rotation applied); unknown until measured. */
  aspect?: number | null;
  /** Where the AI found the main subject, 0..1 across the picture. */
  subject?: SubjectBox | null;
}

export interface EditorShot {
  id: string;
  sourceId: string;
  /** How long this shot is on screen. */
  durationSeconds: number;
  motion: MotionPreset;
  /** Clips only. */
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  focusX: number;
  focusY: number;
  /**
   * How much of the picture shows when its shape is not the video's: 0 = all
   * of it, 1 = fill the frame. Null or absent = decided automatically from the
   * picture's shape and, when known, where the AI found the subject.
   */
  frameZoom?: number | null;
}

/**
 * The zoom a shot is rendered with: the person's choice, or the automatic one.
 * Without a measured shape it fills the frame, exactly as before.
 */
export function shotFrameZoom(
  shot: Pick<EditorShot, "frameZoom">,
  source: Pick<EditorSource, "aspect" | "subject"> | null | undefined,
  ratio: string
): number {
  if (shot.frameZoom != null && Number.isFinite(shot.frameZoom)) {
    return Math.min(1, Math.max(0, shot.frameZoom));
  }
  if (!source?.aspect) return 1;
  return suggestFrameZoom(source.aspect, aspectOfRatio(ratio), source.subject ?? null);
}

/** Read a picture's shape from its poster. Null when it will not load. */
export function measurePictureAspect(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export interface EditorScene {
  id: string;
  transitionIn: MontageTransition;
  /**
   * What this scene is meant to show, in words.
   *
   * Written by the storyboard step and editable afterwards. It is not consumed
   * by the renderer — the picture comes from the shots — but it is what makes a
   * timeline reviewable by someone who did not build it, and it is what the
   * speaking script is eventually written against.
   */
  summary: string;
  shots: EditorShot[];
}

/**
 * What this video is FOR, in the requester's own words.
 *
 * The renderer does not read any of this. Three other things do: the storyboard
 * model, which cannot plan a video it knows nothing about; the shot lengths,
 * which are divided out of `targetSeconds`; and a real clip request, which needs
 * exactly these fields before it can be created. Collecting them once, here,
 * is what stops the same facts being typed twice.
 */
export interface EditorBrief {
  /** ชื่อคลิป — the clip's own name. */
  clipName: string;
  /** ชื่อสถานที่ — the place or business, exactly as the requester writes it. */
  placeName: string;
  latitude: number | null;
  longitude: number | null;
  /** รายละเอียดคลิป — what to promote and the message to carry. */
  details: string;
  /** ความยาววิดีโอ — the finished length being aimed at, in seconds. */
  targetSeconds: number;
  /** Where it is going. The first channel's shape is the main video's. */
  platforms: Platform[];
}

export interface EditorDocument {
  brief: EditorBrief;
  ratio: EditorRatio;
  sources: EditorSource[];
  scenes: EditorScene[];
  captionLanguages: CaptionLanguage[];
  templateId: string;
  /** Id of a track in `public/music`, or null for no bed. */
  musicTrackId: string | null;
  /** A locally chosen voice file, for a draft before the approved voice exists. */
  voiceFile: File | null;
  musicFile: File | null;
}

export const DEFAULT_SHOT_SECONDS = 3;

/** The shortest a shot may be and still read as a shot rather than a flicker. */
export const MIN_SHOT_SECONDS = 0.6;

export function emptyBrief(): EditorBrief {
  return {
    clipName: "",
    placeName: "",
    latitude: null,
    longitude: null,
    details: "",
    targetSeconds: PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
    // The request endpoint needs at least one channel. Travy is not offered in
    // the studio for now (its export is made from server-held masters, which a
    // phone-rendered request does not have), so the brief starts on TikTok.
    platforms: [Platform.TikTok],
  };
}

export function emptyDocument(): EditorDocument {
  return {
    brief: emptyBrief(),
    ratio: "9:16",
    sources: [],
    scenes: [],
    captionLanguages: ["en", "zh"],
    templateId: "none",
    musicTrackId: null,
    voiceFile: null,
    musicFile: null,
  };
}

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/** How wide a captured poster frame is. Enough for a retina tile, no more. */
const POSTER_WIDTH = 480;

/**
 * Read a clip's length AND pull a frame out of it, in one decode.
 *
 * WHY A CANVAS AND NOT A `<video>` TAG. A `<video src=blob:…>` in the Android
 * WebView shows a grey play button until it is played, so a grid of clips is a
 * grid of identical grey squares — you cannot tell which clip is which, which
 * is the whole job of a thumbnail. Drawing one decoded frame onto a canvas
 * gives a real picture that behaves like any other image.
 *
 * The seek is deliberately a fraction of a second in rather than 0: the first
 * frame of a phone recording is very often black or half-exposed.
 *
 * A failure here is not fatal. The duration is what the editor cannot work
 * without; the poster is a nicety, so it resolves null and the caller falls
 * back to naming the file.
 */
export function probeVideo(
  file: File
): Promise<{ durationSeconds: number; posterUrl: string | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = window.document.createElement("video");
    element.preload = "auto";
    element.muted = true;
    element.playsInline = true;
    // Same-origin blob, so the canvas is never tainted — but be explicit, since
    // a tainted canvas fails at `toBlob` with a security error rather than a
    // decoding one, and that is a confusing thing to debug.
    element.crossOrigin = "anonymous";

    let settled = false;
    const cleanup = () => {
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
    };
    const succeed = (durationSeconds: number, posterUrl: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve({ durationSeconds, posterUrl });
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error(message));
    };

    const timeout = window.setTimeout(() => fail(`Could not read ${file.name}`), 20_000);

    const capture = (durationSeconds: number) => {
      try {
        const width = element.videoWidth;
        const height = element.videoHeight;
        if (!width || !height) return succeed(durationSeconds, null);

        const scale = Math.min(1, POSTER_WIDTH / width);
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) return succeed(durationSeconds, null);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) =>
            succeed(durationSeconds, blob ? URL.createObjectURL(blob) : null),
          "image/jpeg",
          0.82
        );
      } catch {
        // A frame that will not draw is a thumbnail we do not get, not a clip
        // the person cannot use.
        succeed(durationSeconds, null);
      }
    };

    const seekForPoster = (duration: number) => {
      const target = Math.min(0.25, duration / 2);
      // Ignore a seek still landing from the length scan below.
      element.onseeked = () => {
        if (element.currentTime <= target + 0.5) capture(duration);
      };
      try {
        element.currentTime = target;
      } catch {
        capture(duration);
      }
    };

    element.onloadedmetadata = () => {
      const duration = element.duration;
      if (duration === Infinity) {
        // Some recorders write the length only at the end of the file (or not
        // at all), and the browser reports Infinity until it has looked.
        // Seeking far past the end makes it scan and settle the real length.
        element.ondurationchange = () => {
          const settledDuration = element.duration;
          if (Number.isFinite(settledDuration) && settledDuration > 0) {
            element.ondurationchange = null;
            seekForPoster(settledDuration);
          }
        };
        try {
          element.currentTime = 1e7;
        } catch {
          fail(`Invalid duration: ${file.name}`);
        }
        return;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        fail(`Invalid duration: ${file.name}`);
        return;
      }
      seekForPoster(duration);
    };
    element.onerror = () => fail(`Cannot decode ${file.name}`);
    element.src = url;
  });
}

/**
 * A downscaled still for a photo.
 *
 * A photo could of course be shown at its own object URL, but then the tile
 * holds a 6MB original and the storyboard step has a 6MB frame to send. One
 * small JPEG serves both, so a photo and a clip end up with the same kind of
 * poster and the rest of the editor never has to care which it is looking at.
 */
export function readImagePoster(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = (poster: string | null) => {
      URL.revokeObjectURL(url);
      resolve(poster);
    };
    const timeout = window.setTimeout(() => finish(null), 15_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      try {
        const scale = Math.min(1, POSTER_WIDTH / (image.naturalWidth || POSTER_WIDTH));
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.naturalWidth || POSTER_WIDTH) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || POSTER_WIDTH) * scale));
        const context = canvas.getContext("2d");
        if (!context) return finish(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => finish(blob ? URL.createObjectURL(blob) : null),
          "image/jpeg",
          0.82
        );
      } catch {
        finish(null);
      }
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };
    image.src = url;
  });
}

/** Total on-screen length: shots are contiguous, so a dissolve adds nothing. */
export function documentDurationSeconds(document: EditorDocument): number {
  return document.scenes.reduce(
    (total, scene) => total + scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    0
  );
}

export function findSource(document: EditorDocument, sourceId: string): EditorSource | undefined {
  return document.sources.find((source) => source.id === sourceId);
}

/**
 * Everything wrong with the document, as sentences.
 *
 * Returned rather than thrown so the editor can disable the render button AND
 * say why — "Render" greyed out with no explanation is the thing people file
 * bugs about.
 */
export function validateDocument(document: EditorDocument, t: StudioT = studioEnglish): string[] {
  const problems: string[] = [];

  if (document.sources.length === 0) {
    problems.push(t("studio.validate.noSource"));
  }
  if (document.scenes.length === 0 || document.scenes.every((s) => s.shots.length === 0)) {
    problems.push(t("studio.validate.noShot"));
  }

  for (const [sceneIndex, scene] of document.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const label = t("studio.validate.shotLabel", { scene: sceneIndex + 1, shot: shotIndex + 1 });
      const source = findSource(document, shot.sourceId);
      if (!source) {
        problems.push(t("studio.validate.missing", { label }));
        continue;
      }
      if (!(shot.durationSeconds > 0)) {
        problems.push(t("studio.validate.zero", { label }));
      }
      if (source.kind === "clip") {
        const available = source.durationSeconds ?? 0;
        if (shot.trimStartSeconds < 0) {
          problems.push(t("studio.validate.beforeStart", { label }));
        }
        if (shot.trimEndSeconds != null && shot.trimEndSeconds <= shot.trimStartSeconds) {
          problems.push(t("studio.validate.endsBefore", { label }));
        }
        if (
          shot.trimEndSeconds != null &&
          available > 0 &&
          shot.trimEndSeconds > available + 0.05
        ) {
          problems.push(
            t("studio.validate.pastEnd", { label, seconds: available.toFixed(1) })
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Put every source into one scene, one shot each, with sensible defaults.
 *
 * Stills alternate zoom in and out, which is what the scene designer does when
 * it has no reason to prefer one; clips play their first few seconds. It is a
 * starting point to edit, not a decision.
 */
export function autoArrange(sources: EditorSource[]): EditorScene[] {
  if (sources.length === 0) return [];
  // One scene per photo or clip: a scene is ONE piece of material.
  return sources.map((source, index) => ({
    id: nextId("scene"),
    transitionIn: index === 0 ? "cut" : "fade",
    summary: "",
    shots: [shotFor(source, index % 2 === 0 ? "ken_burns_in" : "ken_burns_out")],
  }));
}

/** A fresh shot of one source, with the defaults every new shot starts from. */
export function shotFor(
  source: EditorSource,
  photoMotion: MotionPreset = "ken_burns_in",
  seconds: number = DEFAULT_SHOT_SECONDS
): EditorShot {
  const clipLength = source.durationSeconds ?? 0;
  const duration =
    source.kind === "clip" && clipLength > 0 ? Math.min(seconds, Math.max(0.5, clipLength)) : seconds;
  return {
    id: nextId("shot"),
    sourceId: source.id,
    durationSeconds: Math.round(duration * 10) / 10,
    motion: source.kind === "clip" ? "static" : photoMotion,
    trimStartSeconds: 0,
    trimEndSeconds:
      source.kind === "clip" && clipLength > 0
        ? Math.round(Math.min(clipLength, duration) * 10) / 10
        : null,
    focusX: 0.5,
    focusY: 0.5,
  };
}

/**
 * ONE SCENE, ONE PIECE OF MATERIAL.
 *
 * A scene is a single photo or a single clip. The storyboard model (and older
 * plans) sometimes put several in one scene; each extra one becomes its own
 * scene right after, carrying the same description and entering with a
 * dissolve, so nothing the plan chose is lost and the order is unchanged.
 */
export function oneMaterialPerScene(scenes: EditorScene[]): EditorScene[] {
  const out: EditorScene[] = [];
  for (const scene of scenes) {
    if (scene.shots.length <= 1) {
      out.push(scene);
      continue;
    }
    scene.shots.forEach((shot, index) => {
      out.push(
        index === 0
          ? { ...scene, shots: [shot] }
          : { id: nextId("scene"), transitionIn: "fade", summary: scene.summary, shots: [shot] }
      );
    });
  }
  return out;
}

// ── the brief, the storyboard and the clock ─────────────────────────────────

/**
 * Everything the brief is missing before a real clip request can be created.
 *
 * The thresholds are not invented here: they are the ones
 * `clipRequestFormSchema` already enforces on the server, restated so the phone
 * can say what is wrong while the person is still looking at the field, instead
 * of after a round trip that returns a 422.
 */
export function briefProblems(brief: EditorBrief, t: StudioT = studioEnglish): string[] {
  const problems: string[] = [];
  if (brief.clipName.trim().length < 3) {
    problems.push(t("studio.brief.problem.name"));
  }
  if (brief.placeName.trim().length === 0) {
    problems.push(t("studio.brief.problem.place"));
  }
  if (brief.details.trim().length < 20) {
    problems.push(t("studio.brief.problem.details"));
  }
  if (
    brief.targetSeconds < PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS ||
    brief.targetSeconds > STUDIO_MAX_DURATION_SECONDS
  ) {
    problems.push(
      t("studio.brief.problem.length", {
        min: PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS,
        max: STUDIO_MAX_DURATION_SECONDS,
      })
    );
  }
  if (brief.platforms.length === 0) {
    problems.push(t("studio.brief.problem.platform"));
  }
  return problems;
}

/**
 * Enough of a brief to ask the model for a storyboard.
 *
 * Deliberately weaker than {@link briefProblems}: a storyboard is a draft, and
 * refusing to draft one because the map pin is missing would be pedantry. What
 * it genuinely cannot work without is some material and some words.
 */
export function canRequestStoryboard(document: EditorDocument): boolean {
  return (
    document.sources.length > 0 &&
    document.brief.placeName.trim().length > 0 &&
    document.brief.details.trim().length >= 10
  );
}

/**
 * Spread a target length across the shots that exist.
 *
 * WHY EVENLY, AND WHY NOT CLEVERLY. A scene the model called important is not
 * necessarily a scene with more to look at, and a weighting nobody can predict
 * is worse than one everybody can: every shot gets the same slice, and the
 * person lengthens the ones that deserve it. What this DOES guarantee is that
 * the finished video is the length that was asked for, which an ad slot or a
 * feed cares about and a pile of three-second defaults does not.
 */
export function retimeScenes(
  scenes: EditorScene[],
  targetSeconds: number,
  /** A clip's real length, so a widened window never runs past its footage. */
  availableFor?: (sourceId: string) => number | null
): EditorScene[] {
  const shotCount = scenes.reduce((count, scene) => count + scene.shots.length, 0);
  if (shotCount === 0 || !(targetSeconds > 0)) return scenes;

  const each = Math.max(MIN_SHOT_SECONDS, Math.round((targetSeconds / shotCount) * 10) / 10);
  return scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      if (shot.trimEndSeconds == null) return { ...shot, durationSeconds: each };

      // A clip's window follows its slot, but only as far as the footage goes.
      // Past that the renderer slows the clip to fill the slot — which is a
      // deliberate effect — whereas a window that runs off the end of the file
      // is simply a trim the editor will refuse to render.
      const available = availableFor?.(shot.sourceId) ?? null;
      const wanted = shot.trimStartSeconds + each;
      const end = available != null && available > 0 ? Math.min(wanted, available) : wanted;
      return {
        ...shot,
        durationSeconds: each,
        trimEndSeconds: Math.round(end * 10) / 10,
      };
    }),
  }));
}

/** One scene as the storyboard model describes it: a sentence and some material. */
export interface StoryboardPlanScene {
  sceneNumber: number;
  summary: string;
  /** Zero-based positions in `document.sources`, in canonical order. */
  assetIndexes: number[];
}

/**
 * Turn an approved storyboard into a timeline.
 *
 * Scenes with no material left in them are dropped rather than kept as empty
 * rows: the renderer has nothing to show for them, and an empty scene in the
 * timeline is a thing the person then has to tidy up by hand.
 *
 * Existing shot settings are NOT preserved. A new storyboard is a new plan, and
 * silently carrying a focus point from the shot that used to be in slot three
 * would be worse than starting clean.
 */
export function scenesFromStoryboard(
  document: EditorDocument,
  plan: StoryboardPlanScene[],
  /**
   * Which source an asset index means. Defaults to position in
   * `document.sources`; the studio passes the server's material order instead
   * once a request is submitted, because that order — not the grid's — is what
   * the pipeline's indexes count.
   */
  sourceAt: (assetIndex: number) => EditorSource | undefined = (assetIndex) =>
    document.sources[assetIndex]
): EditorScene[] {
  const scenes: EditorScene[] = [];

  for (const [index, entry] of plan.entries()) {
    const shots: EditorShot[] = [];
    for (const assetIndex of entry.assetIndexes) {
      const source = sourceAt(assetIndex);
      if (!source) continue;
      const clipLength = source.durationSeconds ?? 0;
      shots.push({
        id: nextId("shot"),
        sourceId: source.id,
        durationSeconds: DEFAULT_SHOT_SECONDS,
        motion:
          source.kind === "clip" ? "static" : index % 2 === 0 ? "ken_burns_in" : "ken_burns_out",
        trimStartSeconds: 0,
        trimEndSeconds:
          source.kind === "clip" && clipLength > 0
            ? Math.round(Math.min(clipLength, DEFAULT_SHOT_SECONDS) * 10) / 10
            : null,
        focusX: 0.5,
        focusY: 0.5,
      });
    }
    if (shots.length === 0) continue;
    scenes.push({
      id: nextId("scene"),
      // The first scene opens the video and has nothing to dissolve from.
      transitionIn: scenes.length === 0 ? "cut" : "fade",
      summary: entry.summary,
      shots,
    });
  }

  return retimeScenes(
    oneMaterialPerScene(scenes),
    document.brief.targetSeconds,
    (sourceId) => findSource(document, sourceId)?.durationSeconds ?? null
  );
}

/**
 * The timeline as production last received it — the inverse of
 * {@link scenePlanFromScenes}.
 *
 * A reopened studio would otherwise rebuild the timeline from the storyboard
 * alone and lose every trim, focus point, zoom and camera move the video was
 * made with; "Regenerate the video" would then quietly remake a different
 * edit. Assets whose material is no longer on this phone are left out.
 */
export function scenesFromScenePlan(
  plan: StudioScenePlan[],
  sourceAt: (assetIndex: number) => EditorSource | undefined
): EditorScene[] {
  const scenes: EditorScene[] = [];
  for (const entry of plan) {
    const shots: EditorShot[] = [];
    for (const asset of entry.assets ?? []) {
      const source = sourceAt(asset.assetIndex);
      if (!source || !(asset.durationSeconds > 0)) continue;
      const isClip = source.kind === "clip";
      shots.push({
        id: nextId("shot"),
        sourceId: source.id,
        durationSeconds: asset.durationSeconds,
        motion: isClip ? "static" : asset.motion,
        trimStartSeconds: isClip ? asset.trimStartSeconds ?? 0 : 0,
        trimEndSeconds: isClip ? asset.trimEndSeconds ?? null : null,
        focusX: Number.isFinite(asset.focusX) ? asset.focusX : 0.5,
        focusY: Number.isFinite(asset.focusY) ? asset.focusY : 0.5,
        frameZoom: Number.isFinite(asset.frameZoom) ? asset.frameZoom : null,
      });
    }
    if (shots.length === 0) continue;
    scenes.push({
      id: nextId("scene"),
      transitionIn: scenes.length === 0 ? "cut" : entry.transitionIn ?? "fade",
      summary: entry.visualDescriptionThai ?? "",
      shots,
    });
  }
  return oneMaterialPerScene(scenes);
}

/**
 * The timeline, said back to the pipeline as a storyboard.
 *
 * The inverse of {@link scenesFromStoryboard}, used when the script is
 * approved: the server's storyboard seeds its scene design, so what is sent
 * here is what gets produced. Each scene keeps its summary and names the
 * material its shots use, once each, in the order they first appear. Empty
 * scenes are left out — they have nothing for the pipeline to design.
 */
export function storyboardFromScenes(
  scenes: EditorScene[],
  indexOf: (sourceId: string) => number
): StoryboardPlanScene[] {
  const plan: StoryboardPlanScene[] = [];
  for (const scene of scenes) {
    const assetIndexes: number[] = [];
    for (const shot of scene.shots) {
      const assetIndex = indexOf(shot.sourceId);
      if (assetIndex >= 0 && !assetIndexes.includes(assetIndex)) assetIndexes.push(assetIndex);
    }
    if (assetIndexes.length === 0) continue;
    plan.push({ sceneNumber: plan.length + 1, summary: scene.summary, assetIndexes });
  }
  return plan;
}

/**
 * Everything that would make the server refuse this material, before it is
 * copied anywhere.
 *
 * The limits are the server's own (`localMediaSubmissionSchema` and the
 * request form's), imported rather than restated, so the phone refuses exactly
 * what the server would and never a byte more. Checking here matters more than
 * it looks: submission first copies every original into private storage, and
 * finding out about a MOV clip only after copying ten files is a long wait for
 * a "no".
 */
export function submissionProblems(
  sources: EditorSource[],
  t: StudioT = studioEnglish
): string[] {
  const problems: string[] = [];
  if (sources.length === 0) {
    problems.push(t("studio.submit.problem.none"));
    return problems;
  }
  if (sources.length > MAX_UPLOAD_COUNT) {
    problems.push(
      t("studio.submit.problem.tooMany", {
        max: MAX_UPLOAD_COUNT,
        extra: sources.length - MAX_UPLOAD_COUNT,
      })
    );
  }

  const accepted = new Set<string>(ACCEPTED_MIME_TYPES);
  let total = 0;
  for (const source of sources) {
    total += source.file.size;
    const type = source.file.type;
    if (!accepted.has(type)) {
      problems.push(
        source.kind === "clip"
          ? t("studio.submit.problem.mp4", { name: source.fileName })
          : t("studio.submit.problem.photoType", { name: source.fileName })
      );
      continue;
    }
    const cap = source.kind === "clip" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
    if (source.file.size > cap) {
      problems.push(
        t("studio.submit.problem.tooLarge", {
          name: source.fileName,
          mb: Math.round(cap / (1024 * 1024)),
        })
      );
    }
    if (
      source.kind === "clip" &&
      source.durationSeconds != null &&
      source.durationSeconds > MAX_CLIP_DURATION_SECONDS
    ) {
      problems.push(
        t("studio.submit.problem.tooLong", {
          name: source.fileName,
          seconds: MAX_CLIP_DURATION_SECONDS,
        })
      );
    }
  }
  if (total > MAX_UPLOAD_SIZE_BYTES) {
    problems.push(
      t("studio.submit.problem.total", { mb: Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)) })
    );
  }
  return problems;
}

/**
 * How long a shot actually holds the screen, by the server's rule.
 *
 * The server measures a clip as the longer of its slot and its trimmed window
 * (`assetPlaySeconds`); a window longer than the slot is never cut short. The
 * studio totals its storyboard the same way so the coverage it shows is the
 * coverage the approval gate will check.
 */
export function shotPlaySeconds(shot: EditorShot): number {
  const slot = shot.durationSeconds > 0 ? shot.durationSeconds : 0;
  const window =
    shot.trimEndSeconds != null ? Math.max(0, shot.trimEndSeconds - shot.trimStartSeconds) : 0;
  return Math.max(slot, window);
}

export function scenesPlaySeconds(scenes: EditorScene[]): number {
  return scenes.reduce(
    (total, scene) => total + scene.shots.reduce((sum, shot) => sum + shotPlaySeconds(shot), 0),
    0
  );
}

/** One montage scene as the pipeline's `ScenePlan` stores it. */
export interface StudioScenePlan {
  sceneNumber: number;
  durationSeconds: number;
  visualDescriptionThai: string;
  imageIndexes: number[];
  transitionIn: MontageTransition;
  assets: {
    assetIndex: number;
    kind: "image" | "clip";
    motion: MotionPreset;
    durationSeconds: number;
    trimStartSeconds?: number;
    trimEndSeconds?: number;
    focusX: number;
    focusY: number;
    frameZoom: number;
  }[];
}

/**
 * The storyboard as the render plan — every shot, with its trim, its camera
 * move, its focus point, and each scene's transition.
 *
 * THIS IS WHAT CLOSES THE GAP between the studio and the renderer. The phone's
 * render manifest is built on the server from the job's approved scene plan;
 * until this existed, only the scene order and material choice reached it, and
 * every trim made here was thrown away. Sending this plan at the scene-design
 * gate makes the studio's edit the edit that is rendered.
 *
 * `visualDescriptionThai` carries the scene's sentence (in whatever language the
 * request was written in — the field name is historical). Scenes with no shots
 * are left out: the pipeline has nothing to render for them.
 */
export function scenePlanFromScenes(
  document: EditorDocument,
  indexOf: (sourceId: string) => number
): StudioScenePlan[] {
  const plan: StudioScenePlan[] = [];
  for (const scene of document.scenes) {
    const assets: StudioScenePlan["assets"] = [];
    for (const shot of scene.shots) {
      const source = findSource(document, shot.sourceId);
      const assetIndex = indexOf(shot.sourceId);
      if (!source || assetIndex < 0) continue;
      const round = (value: number) => Math.round(value * 100) / 100;
      assets.push({
        assetIndex,
        kind: source.kind,
        motion: source.kind === "clip" ? "static" : shot.motion,
        durationSeconds: round(shot.durationSeconds),
        ...(source.kind === "clip"
          ? {
              trimStartSeconds: round(shot.trimStartSeconds),
              ...(shot.trimEndSeconds != null ? { trimEndSeconds: round(shot.trimEndSeconds) } : {}),
            }
          : {}),
        focusX: shot.focusX,
        focusY: shot.focusY,
        frameZoom: round(shotFrameZoom(shot, source, document.ratio)),
      });
    }
    if (assets.length === 0) continue;
    const imageIndexes: number[] = [];
    for (const asset of assets) {
      if (!imageIndexes.includes(asset.assetIndex)) imageIndexes.push(asset.assetIndex);
    }
    plan.push({
      sceneNumber: plan.length + 1,
      durationSeconds:
        Math.round(scene.shots.reduce((sum, shot) => sum + shotPlaySeconds(shot), 0) * 100) / 100,
      visualDescriptionThai: scene.summary,
      imageIndexes,
      transitionIn: scene.transitionIn,
      assets,
    });
  }
  return plan;
}
