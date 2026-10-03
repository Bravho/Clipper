"use client";

import {
  createLocalAnalysisFrame,
  readLocalMaterial,
  restoreLocalMaterial,
  retainLocalFile,
} from "@/features/requests/localMediaStore";
import type { ElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import type { Platform } from "@/domain/enums/Platform";
import { describeDeviceRenderCapability } from "@/lib/mobile/deviceRenderBridge";
import type { LocalAnalysisFrame, LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";
import type { SubjectBox } from "@/lib/mobile/shotFraming";
import { isUnreadableFileError } from "@/features/requests/uploadDiagnostics";
import { supportsManifestRender } from "@/lib/mobile/deviceRenderBridge";
import { prepareClip } from "./clipPreview";
import { studioEnglish, type StudioT } from "./studioText";
import { FREE_REQUESTS_PER_WINDOW, FREE_WINDOW_DAYS } from "@/config/videoPackages";
import {
  readImagePoster,
  type EditorSource,
  type StoryboardPlanScene,
  type StudioScenePlan,
} from "./editorState";

/**
 * The studio's side of the real pipeline.
 *
 * Three calls, and every one of them goes through an endpoint the web flow
 * already uses, so the studio adds a second SCREEN onto the pipeline and never
 * a second pipeline:
 *
 *   submit   → `POST /api/requests/[id]/submit` with `localMedia` — the same
 *              local-first body the request form sends. Originals are copied
 *              into the app's private storage and stay there; the server gets
 *              descriptors and one small JPEG per item.
 *   content  → `GET /api/device-render/content` — the storyboard and speaking
 *              script the pipeline wrote, and the step it is on.
 *   approve  → `POST /api/requests/[id]/start-production` — the request page's
 *              own approval call, carrying the storyboard as edited here.
 */

export interface StudioScript {
  text: string;
  english: string;
  caption: string;
  captionEnglish: string;
  captionChinese: string;
}

/** A finished, captioned video of one channel shape. */
export interface StudioOutput {
  ratio: string;
  assetId: string;
  url: string;
  /**
   * Who made it: this phone, or the server's worker. A server-made video of a
   * request whose clips stayed on the phone can only have used their poster
   * frames, so the studio says so. Absent from an older server.
   */
  madeOn?: "phone" | "server";
  platform?: "ios" | "android" | null;
}

/** Which extra channel shape the phone is rendering, and what is left. */
export interface StudioChain {
  ratio: string;
  stage: "montage" | "master" | "final";
  queue: string[];
}

export interface StudioContent {
  submitted: boolean;
  jobId: string | null;
  currentStep: string | null;
  failedAtStep: string | null;
  contentApproved: boolean;
  storyboard: StoryboardPlanScene[] | null;
  script: StudioScript | null;
  voice: { assetId: string; url: string; durationSeconds: number | null } | null;
  /** The device-held originals, in the order the storyboard indexes them. */
  localMedia: LocalMediaDescriptor[];
  /** Captioned videos rendered so far, one per shape. */
  outputs: StudioOutput[];
  /** The extra-shape render in progress, if any. */
  chain: StudioChain | null;
  /** The request has been delivered at least once (its videos can go to Channel Management). */
  delivered?: boolean;
  /**
   * Voice makes used and allowed for this request (config/requestLimits.ts).
   * Absent from an older server.
   */
  voiceMakes?: { used: number; limit: number };
  /** Approved steps can no longer be reopened or remade (2026-09-27). */
  lockedAfterApproval?: boolean;
  /** Why the phone's latest part stopped with an error, if it did. */
  lastPhoneError?: {
    stage: string;
    ratio: string;
    reason: string;
    at: string;
    /** Every step of the failed attempt, phone and app together. */
    log?: string[];
  } | null;
  /** What production was last started with; null before the first start. */
  production?: {
    scenePlan: StudioScenePlan[] | null;
    musicTrackId: string | null;
    subtitleLanguages: string[];
    templateId: string | null;
  } | null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** A poster object URL as a data URL, which is what the analysis-frame builder takes. */
async function posterDataUrl(posterUrl: string | null): Promise<string | undefined> {
  if (!posterUrl) return undefined;
  try {
    const blob = await (await fetch(posterUrl)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * Submit the request with the media on this phone.
 *
 * ORDER MATTERS. The originals are retained BEFORE the server is told about
 * them: a submission the server accepted for files the phone then failed to
 * keep would leave a job no renderer can ever finish. The other way round, a
 * failure leaves some copies in private storage and a Draft that can simply be
 * submitted again.
 *
 * The material order sent here IS the storyboard's asset index order, so it
 * follows `sources` exactly and nothing may be skipped silently: an item with
 * no analysis frame would shift every index after it.
 */
export async function submitStudioRequest(input: {
  requestId: string;
  sources: EditorSource[];
  onProgress?: (done: number, total: number) => void;
  /** The studio's language for the sentences this can fail with. */
  t?: StudioT;
}): Promise<void> {
  const { requestId, sources } = input;
  const t = input.t ?? studioEnglish;

  if (sources.some((source) => source.kind === "clip") && !(await supportsManifestRender())) {
    throw new Error(t("studio.pipe.noClipSupport"));
  }

  const materials: LocalMediaDescriptor[] = [];
  const analysisFrames: LocalAnalysisFrame[] = [];
  for (const [index, source] of sources.entries()) {
    let descriptor: LocalMediaDescriptor;
    try {
      descriptor = await retainLocalFile(
        requestId,
        source.id,
        source.file,
        source.durationSeconds
      );
    } catch (error) {
      // Name the file and say what to do, instead of Chrome's bare
      // "could not be read, typically due to permission problems…".
      if (isUnreadableFileError(error)) {
        throw new Error(t("studio.pipe.unreadable", { name: source.fileName }));
      }
      throw error;
    }
    materials.push(descriptor);
    const frame = await createLocalAnalysisFrame(
      descriptor,
      index,
      source.kind === "clip" ? await posterDataUrl(source.posterUrl) : undefined
    );
    if (!frame) {
      throw new Error(t("studio.pipe.noPreview", { name: source.fileName }));
    }
    analysisFrames.push(frame);
    input.onProgress?.(index + 1, sources.length);
  }

  const response = await fetch(`/api/requests/${requestId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creditConfirmed: true,
      rightsConfirmed: true,
      aiProcessingConfirmed: true,
      localMedia: {
        mode: "local-first",
        materials,
        analysisFrames,
        deviceRender: await describeDeviceRenderCapability(),
        // Every render of a studio request happens on this phone — photos
        // included — so the server queues its steps for the phone alone.
        renderOnDevice: true,
      },
    }),
  });
  if (!response.ok) {
    if (response.status === 402) {
      const body = (await response.json().catch(() => null)) as
        | { code?: string; nextFreeSlotAt?: string | null; error?: string }
        | null;
      if (body?.code === "quota_exhausted") {
        throw new StudioQuotaError(
          quotaMessage(t, body.nextFreeSlotAt ?? null),
          body.nextFreeSlotAt ?? null
        );
      }
      throw new Error(body?.error ?? t("studio.pipe.submitFailed"));
    }
    throw new Error(await readError(response, t("studio.pipe.submitFailed")));
  }
}

/** Submit was refused because the account has no videos left this period. */
export class StudioQuotaError extends Error {
  constructor(
    message: string,
    /** ISO date the next free video opens, when the server knows it. */
    readonly nextFreeSlotAt: string | null
  ) {
    super(message);
    this.name = "StudioQuotaError";
  }
}

/**
 * "You have used your free videos" in the studio's language, with the date
 * the next free one opens (in the phone's own date format) when the server
 * knows it.
 */
export function quotaMessage(t: StudioT, nextFreeSlotAt: string | null): string {
  const values = { count: FREE_REQUESTS_PER_WINDOW, days: FREE_WINDOW_DAYS };
  const when = nextFreeSlotAt ? new Date(nextFreeSlotAt) : null;
  if (!when || Number.isNaN(when.getTime())) return t("studio.pipe.quotaNoDate", values);
  return t("studio.pipe.quota", {
    ...values,
    date: when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
  });
}

/**
 * Where the AI found the main subject in each submitted photo and clip, in the
 * storyboard's asset-index order. Never throws: framing falls back to the
 * picture's shape alone.
 */
export async function fetchStudioFraming(requestId: string): Promise<(SubjectBox | null)[]> {
  try {
    const response = await fetch("/api/device-render/framing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { subjects?: (SubjectBox | null)[] };
    return Array.isArray(body.subjects) ? body.subjects : [];
  } catch {
    return [];
  }
}

export async function fetchStudioContent(requestId: string): Promise<StudioContent> {
  const response = await fetch(
    `/api/device-render/content?requestId=${encodeURIComponent(requestId)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(await readError(response, "The request's progress could not be read."));
  }
  const content = (await response.json()) as StudioContent;
  // A server that predates these fields answers without them.
  return { ...content, outputs: content.outputs ?? [], chain: content.chain ?? null };
}

/**
 * Approve the speaking script — and with it, the storyboard as edited here.
 *
 * This is the request page's own approval call. It moves the job on to voice
 * generation, and the storyboard sent with it is the one that seeds the scene
 * design, so the arrangement made in the studio is the arrangement produced.
 */
export async function approveStudioContent(input: {
  requestId: string;
  script: StudioScript;
  storyboard: StoryboardPlanScene[];
  voiceId: ElevenLabsVoiceId;
  t?: StudioT;
}): Promise<void> {
  const response = await fetch(`/api/requests/${input.requestId}/start-production`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scriptThai: input.script.text,
      scriptEnglish: input.script.english,
      hookEnglish: null,
      captionThai: input.script.caption,
      captionEnglish: input.script.captionEnglish,
      captionChinese: input.script.captionChinese,
      storyboard: input.storyboard,
      voiceId: input.voiceId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await readError(response, (input.t ?? studioEnglish)("studio.pipe.scriptFailed"))
    );
  }
}

/**
 * Rebuild the editor's sources from the originals this phone kept.
 *
 * A studio reopened after submission has no picked files in memory, but it
 * does have the copies `submitStudioRequest` retained, and the server's list
 * says which ones and in what order. Returns the sources it could find and the
 * names of any it could not — a phone whose storage was cleared cannot render
 * this request, and the person needs to be told rather than shown a blank.
 */
export async function restoreStudioSources(
  localMedia: LocalMediaDescriptor[]
): Promise<{ sources: EditorSource[]; missing: string[]; missingMedia: LocalMediaDescriptor[] }> {
  const sources: EditorSource[] = [];
  const missing: string[] = [];
  const missingMedia: LocalMediaDescriptor[] = [];

  for (const descriptor of localMedia) {
    try {
      const file = await readLocalMaterial(descriptor);
      const isClip = descriptor.mimeType.startsWith("video/");
      // The same preparation as when the clip was first added, including the
      // phone-made preview copy for a clip the in-app browser cannot play.
      const probed = isClip
        ? await prepareClip(file)
        : {
            durationSeconds: null,
            posterUrl: await readImagePoster(file),
            previewUrl: URL.createObjectURL(file),
          };
      sources.push({
        id: descriptor.localId,
        kind: isClip ? "clip" : "image",
        file,
        previewUrl: probed.previewUrl,
        posterUrl: probed.posterUrl,
        durationSeconds: probed.durationSeconds ?? descriptor.durationSeconds,
        fileName: descriptor.fileName,
      });
    } catch {
      missing.push(descriptor.fileName);
      missingMedia.push(descriptor);
    }
  }

  return { sources, missing, missingMedia };
}

/**
 * Which picked file is which lost original: same name and size first, then
 * the same name, then the same size (a gallery can rename on export, but it
 * rarely changes the bytes). Each file and each original is used once.
 */
export function matchOriginals(
  missing: readonly LocalMediaDescriptor[],
  files: readonly File[]
): { pairs: { descriptor: LocalMediaDescriptor; file: File }[]; unused: File[] } {
  const left = [...missing];
  const pool = [...files];
  const pairs: { descriptor: LocalMediaDescriptor; file: File }[] = [];
  const passes: ((descriptor: LocalMediaDescriptor, file: File) => boolean)[] = [
    (d, f) => f.name === d.fileName && f.size === d.fileSizeBytes,
    (d, f) => f.name === d.fileName,
    (d, f) => f.size === d.fileSizeBytes,
  ];
  for (const same of passes) {
    for (let i = 0; i < left.length; ) {
      const at = pool.findIndex((file) => same(left[i], file));
      if (at >= 0) {
        pairs.push({ descriptor: left[i], file: pool[at] });
        pool.splice(at, 1);
        left.splice(i, 1);
      } else {
        i += 1;
      }
    }
  }
  return { pairs, unused: pool };
}

/**
 * Put back originals this phone lost, from files the person picked again.
 * Returns the originals still missing afterwards.
 */
export async function relinkStudioOriginals(
  missing: readonly LocalMediaDescriptor[],
  files: readonly File[],
  onProgress?: (done: number, total: number) => void
): Promise<{ restored: number; stillMissing: LocalMediaDescriptor[]; unused: string[] }> {
  const { pairs, unused } = matchOriginals(missing, files);
  let done = 0;
  const failed = new Set<string>();
  for (const { descriptor, file } of pairs) {
    onProgress?.(done + 1, pairs.length);
    try {
      await restoreLocalMaterial(descriptor, file);
    } catch {
      failed.add(descriptor.localId);
    }
    done += 1;
  }
  const restoredIds = new Set(
    pairs.map((pair) => pair.descriptor.localId).filter((id) => !failed.has(id))
  );
  return {
    restored: restoredIds.size,
    stillMissing: missing.filter((descriptor) => !restoredIds.has(descriptor.localId)),
    unused: unused.map((file) => file.name),
  };
}

async function postJson(url: string, body: unknown, fallback: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response, fallback));
}

/**
 * Approve the generated voice — the request page's own call.
 *
 * The channel order goes with it because the FIRST channel decides the base
 * video's shape on the server; the studio puts first the channel whose shape
 * matches the one chosen in Media, so the render is the shape that was edited.
 */
export function approveStudioVoice(input: {
  requestId: string;
  jobId: string;
  platforms: Platform[];
  t?: StudioT;
}): Promise<void> {
  const t = input.t ?? studioEnglish;
  return (async () => {
    const response = await fetch(`/api/requests/${input.requestId}/approve-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: input.jobId, targetPlatforms: input.platforms }),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      voiceSeconds?: number;
      materialSeconds?: number;
      maxVoiceSeconds?: number;
    } | null;
    // The server's own length check: say it in the studio's language.
    if (
      body?.code === "voice_too_long_for_material" &&
      typeof body.voiceSeconds === "number" &&
      typeof body.materialSeconds === "number" &&
      typeof body.maxVoiceSeconds === "number"
    ) {
      throw new Error(
        t("studio.audio.voiceTooLong", {
          voice: body.voiceSeconds.toFixed(1),
          material: body.materialSeconds.toFixed(1),
          max: body.maxVoiceSeconds.toFixed(1),
        })
      );
    }
    throw new Error(body?.error ?? t("studio.pipe.voiceFailed"));
  })();
}

/** Make the voice again, optionally with the other speaker. */
export function regenerateStudioVoice(input: {
  requestId: string;
  jobId: string;
  voiceId: ElevenLabsVoiceId;
  /** The script as edited here; the server replaces the approved one when it differs. */
  scriptText?: string | null;
  t?: StudioT;
}): Promise<void> {
  const scriptText = input.scriptText?.trim();
  return postJson(
    `/api/requests/${input.requestId}/voice/regenerate`,
    { jobId: input.jobId, voiceId: input.voiceId, ...(scriptText ? { scriptText } : {}) },
    (input.t ?? studioEnglish)("studio.pipe.voiceAgainFailed")
  );
}

/**
 * Send the studio's edit as the production plan.
 *
 * This is the scene-design approval the request page makes — but carrying the
 * studio's shots, trims, camera moves, focus points and transitions, plus the
 * music, caption languages and template chosen here. With `autoApproveRemaining`
 * the pipeline's later gates (per-scene script, per-scene video, overlays)
 * clear themselves: in the studio the edit IS the approval, and asking again
 * scene by scene would only repeat it.
 */
export function approveStudioProduction(input: {
  requestId: string;
  jobId: string;
  scenePlan: StudioScenePlan[];
  durationSeconds: number;
  musicTrackId: string | null;
  subtitleLanguages: string[];
  templateId: string;
  t?: StudioT;
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/scene-design/approve`,
    {
      jobId: input.jobId,
      scenePlan: input.scenePlan,
      durationSeconds: input.durationSeconds,
      selectedMusicTrack: input.musicTrackId ?? "none",
      subtitleLanguages: input.subtitleLanguages.slice(0, 2),
      selectedMotionTemplate: input.templateId,
      autoApproveRemaining: true,
    },
    (input.t ?? studioEnglish)("studio.pipe.productionFailed")
  );
}

/**
 * Approve the rendered main video — the request page's own overlay approval.
 * The server then waits for the channel choice (or finishes, when the brief's
 * channels need no other shape).
 */
export function approveStudioVideo(input: {
  requestId: string;
  jobId: string;
  t?: StudioT;
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/approve-overlay`,
    { jobId: input.jobId },
    (input.t ?? studioEnglish)("studio.pipe.videoFailed")
  );
}

/**
 * Put the finished (not yet approved) main video back at the scene-design
 * gate, so the current storyboard, sound and look can be sent again and the
 * phone makes the video anew.
 */
export function reopenStudioProduction(input: {
  requestId: string;
  jobId: string;
  t?: StudioT;
}): Promise<void> {
  return postJson(
    "/api/device-render/regenerate",
    { requestId: input.requestId, jobId: input.jobId },
    (input.t ?? studioEnglish)("studio.pipe.remakeFailed")
  );
}

/**
 * Render the chosen extra channel shapes on this phone. An empty list finishes
 * the request with the main video alone.
 */
export function generateStudioChannels(input: {
  requestId: string;
  jobId: string;
  ratios: string[];
  t?: StudioT;
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/generate-additional-ratios`,
    { jobId: input.jobId, ratios: input.ratios },
    (input.t ?? studioEnglish)("studio.pipe.channelsFailed")
  );
}
