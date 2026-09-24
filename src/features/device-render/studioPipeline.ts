"use client";

import {
  createLocalAnalysisFrame,
  readLocalMaterial,
  retainLocalFile,
} from "@/features/requests/localMediaStore";
import type { ElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import type { Platform } from "@/domain/enums/Platform";
import { describeDeviceRenderCapability } from "@/lib/mobile/deviceRenderBridge";
import type { LocalAnalysisFrame, LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";
import type { SubjectBox } from "@/lib/mobile/shotFraming";
import { supportsManifestRender } from "@/lib/mobile/deviceRenderBridge";
import { prepareClip } from "./clipPreview";
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
}): Promise<void> {
  const { requestId, sources } = input;

  if (sources.some((source) => source.kind === "clip") && !(await supportsManifestRender())) {
    throw new Error(
      "This app version cannot edit video on the phone, so a clip cannot be kept here. Update the app, or use photos only."
    );
  }

  const materials: LocalMediaDescriptor[] = [];
  const analysisFrames: LocalAnalysisFrame[] = [];
  for (const [index, source] of sources.entries()) {
    const descriptor = await retainLocalFile(
      requestId,
      source.id,
      source.file,
      source.durationSeconds
    );
    materials.push(descriptor);
    const frame = await createLocalAnalysisFrame(
      descriptor,
      index,
      source.kind === "clip" ? await posterDataUrl(source.posterUrl) : undefined
    );
    if (!frame) {
      throw new Error(
        `A preview of ${source.fileName} could not be made, so the storyboard would not see it. Remove it or add it again.`
      );
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
    throw new Error(await readError(response, "The request could not be submitted."));
  }
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
    throw new Error(await readError(response, "The script could not be approved."));
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
): Promise<{ sources: EditorSource[]; missing: string[] }> {
  const sources: EditorSource[] = [];
  const missing: string[] = [];

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
    }
  }

  return { sources, missing };
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
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/approve-voice`,
    { jobId: input.jobId, targetPlatforms: input.platforms },
    "The voice could not be approved."
  );
}

/** Make the voice again, optionally with the other speaker. */
export function regenerateStudioVoice(input: {
  requestId: string;
  jobId: string;
  voiceId: ElevenLabsVoiceId;
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/voice/regenerate`,
    { jobId: input.jobId, voiceId: input.voiceId },
    "The voice could not be made again."
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
    "The storyboard could not be sent for production."
  );
}

/**
 * Approve the rendered main video — the request page's own overlay approval.
 * The server then waits for the channel choice (or finishes, when the brief's
 * channels need no other shape).
 */
export function approveStudioVideo(input: { requestId: string; jobId: string }): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/approve-overlay`,
    { jobId: input.jobId },
    "The video could not be approved."
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
}): Promise<void> {
  return postJson(
    `/api/requests/${input.requestId}/generate-additional-ratios`,
    { jobId: input.jobId, ratios: input.ratios },
    "The channel shapes could not be started."
  );
}
