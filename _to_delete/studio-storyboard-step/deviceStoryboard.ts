"use client";

import {
  MAX_LOCAL_ANALYSIS_BYTES,
  decodedBase64Bytes,
  type LocalAnalysisFrame,
} from "@/lib/mobile/localMediaContract";

/**
 * Asking the server for a storyboard, without sending anyone's footage.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP. The originals stay on the phone. What
 * crosses the network is the small poster frame the editor already generated for
 * its own thumbnails — a few tens of kilobytes of JPEG per item — plus the words
 * the requester typed. That is the same bargain the local-first submission path
 * strikes (`localMediaContract`), and it is the reason a storyboard can be asked
 * for at all without turning the phone editor into an uploader.
 *
 * WHY THE SERVER AT ALL. Reading a plate of food and deciding it should open the
 * video is a judgement, and the model that makes it needs an API key that has no
 * business being in an app bundle. So the phone sends frames and the brief, and
 * the server answers with scenes.
 */

/** One scene as the model planned it. Mirrors the server's `StoryboardScene`. */
export interface StoryboardPlanScene {
  sceneNumber: number;
  summary: string;
  /** Zero-based positions in the material list that was sent. */
  assetIndexes: number[];
}

export interface StoryboardPlan {
  scenes: StoryboardPlanScene[];
  /** The spoken script the same pass produced, in the account's language. */
  script: string;
  /** A ready-made post caption. */
  caption: string;
  theme: string;
}

export interface StoryboardMaterial {
  localId: string;
  fileName: string;
  mimeType: string;
  kind: "image" | "clip";
  durationSeconds: number | null;
  /** Object URL of the small poster the editor captured. */
  posterUrl: string | null;
}

export interface StoryboardBrief {
  clipName: string;
  placeName: string;
  details: string;
  targetSeconds: number;
  platforms: string[];
}

/** The model is sent at most this many frames; the schema caps it at 30. */
const MAX_FRAMES = 20;

/**
 * Read one poster back out of its object URL as base64.
 *
 * The poster is already a small JPEG — it was made for a thumbnail — so this is
 * a read, not a re-encode. Returning null rather than throwing keeps one
 * unreadable item from costing the whole storyboard.
 */
async function frameFor(
  material: StoryboardMaterial,
  assetIndex: number
): Promise<LocalAnalysisFrame | null> {
  if (!material.posterUrl) return null;
  try {
    const response = await fetch(material.posterUrl);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    // A chunked loop rather than spreading the array: `String.fromCharCode(...)`
    // on a few hundred thousand arguments overflows the call stack on exactly
    // the mid-range phones this app is for.
    const CHUNK = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    }
    const mimeType = blob.type === "image/png" || blob.type === "image/webp"
      ? blob.type
      : "image/jpeg";
    return {
      localId: material.localId,
      assetIndex,
      mimeType,
      dataBase64: window.btoa(binary),
    };
  } catch {
    return null;
  }
}

/**
 * Turn the editor's material into the frames the server may look at.
 *
 * Stops at the byte budget rather than at the item count alone, because twenty
 * frames off a 4K phone camera and twenty off a screenshot are not the same
 * request, and a body the server rejects for size is a worse outcome than a
 * storyboard planned from the first twelve items.
 */
export async function buildAnalysisFrames(
  materials: StoryboardMaterial[]
): Promise<LocalAnalysisFrame[]> {
  const frames: LocalAnalysisFrame[] = [];
  let bytes = 0;

  for (const [index, material] of materials.entries()) {
    if (frames.length >= MAX_FRAMES) break;
    const frame = await frameFor(material, index);
    if (!frame) continue;
    const size = decodedBase64Bytes(frame.dataBase64);
    if (bytes + size > MAX_LOCAL_ANALYSIS_BYTES) break;
    bytes += size;
    frames.push(frame);
  }

  return frames;
}

export class StoryboardError extends Error {}

/**
 * Ask for a storyboard.
 *
 * Every failure mode here is a sentence someone can act on, because the one
 * thing this must never do is leave a person staring at a spinner that stopped:
 * no frames means "the posters did not come out", a 404 means the tester gate,
 * and anything else is reported as the server described it.
 */
export async function requestStoryboard(input: {
  brief: StoryboardBrief;
  materials: StoryboardMaterial[];
  signal?: AbortSignal;
}): Promise<StoryboardPlan> {
  const frames = await buildAnalysisFrames(input.materials);
  if (frames.length === 0) {
    throw new StoryboardError(
      "No preview frames could be read from your material, so there is nothing to plan from."
    );
  }

  const response = await fetch("/api/device-render/storyboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      brief: input.brief,
      materials: input.materials.map((material) => ({
        localId: material.localId,
        fileName: material.fileName,
        mimeType: material.mimeType,
        kind: material.kind,
        durationSeconds: material.durationSeconds,
      })),
      frames,
    }),
  });

  if (response.status === 404) {
    throw new StoryboardError(
      "Storyboard planning is not switched on for this account yet."
    );
  }

  const body = (await response.json().catch(() => null)) as
    | (StoryboardPlan & { error?: string })
    | null;

  if (!response.ok || !body) {
    throw new StoryboardError(
      body?.error ?? "The storyboard could not be planned just now. Try again in a moment."
    );
  }

  return {
    scenes: Array.isArray(body.scenes) ? body.scenes : [],
    script: body.script ?? "",
    caption: body.caption ?? "",
    theme: body.theme ?? "",
  };
}
