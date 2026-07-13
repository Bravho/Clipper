import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spacesPublicUrl, spacesUpload } from "@/lib/spaces";
import { getRemotionBundle } from "@/lib/ai/remotionBundle";
import type { VideoRatio } from "@/lib/ai/ffmpegService";
import {
  DEFAULT_MONTAGE_TRANSITION,
  DEFAULT_MOTION_PRESET,
  isMontageTransition,
  isMotionPreset,
  type MontageAssetSpec,
  type MontageTransition,
} from "@/config/montage";

/**
 * Phase 1 — real-media montage scene renderer.
 *
 * Renders ONE montage scene segment (the client's actual photos/clips with
 * Ken Burns motion + transitions) to an H.264 MP4 at the given aspect ratio,
 * using the `remotion/` project's "MontageScene" composition, and stores it in
 * DO Spaces. Segments are silent — voice, music, captions, and the multi-ratio
 * crop are added downstream at the FFmpeg compose step.
 *
 * The pipeline renders one scene per requester approval, then concatenates the
 * approved segments (ffmpegService.concatVideos) into the single base video the
 * rest of the pipeline already consumes (`baseVideoAssetId`). This is wired in
 * Phase 3; Phase 1 ships the engine in isolation.
 *
 * Render failures are treated like other AI-step failures: the caller catches
 * them and records `failedAtStep = GeneratingBaseVideo` for retry.
 */

const RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — generous for headless Chromium cold starts

/** Normalized asset shape passed to the Remotion MontageScene composition. */
interface MontageInputAsset {
  url: string;
  kind: "image" | "clip";
  motion: MontageAssetSpec["motion"];
  durationSeconds: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  focusX?: number;
  focusY?: number;
}

export interface MontageSceneProps {
  ratio: VideoRatio;
  durationSeconds: number;
  assets: MontageInputAsset[];
  transition: MontageTransition;
}

export interface RenderSceneParams {
  ratio: VideoRatio;
  /** Scene total in seconds (sum of asset on-screen durations). */
  durationSeconds: number;
  assets: MontageAssetSpec[];
  transition?: MontageTransition;
  /** DO Spaces key the rendered .mp4 scene segment will be uploaded to. */
  outputStorageKey: string;
}

function clamp01(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/**
 * Pure: normalize render params into the Remotion composition's input props.
 * Defaults motion/transition, drops invalid focus/trim values, and guarantees
 * a positive scene duration. Unit-tested without touching Remotion or Spaces.
 */
export function buildSceneInputProps(params: RenderSceneParams): MontageSceneProps {
  const durationSeconds =
    Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
      ? params.durationSeconds
      : Math.max(1, params.assets.length);

  const transition = isMontageTransition(params.transition)
    ? params.transition
    : DEFAULT_MONTAGE_TRANSITION;

  const assets: MontageInputAsset[] = params.assets.map((a) => {
    const kind: "image" | "clip" = a.kind === "clip" ? "clip" : "image";
    const motion = isMotionPreset(a.motion) ? a.motion : DEFAULT_MOTION_PRESET;
    const dur =
      Number.isFinite(a.durationSeconds) && a.durationSeconds > 0 ? a.durationSeconds : 0;

    const asset: MontageInputAsset = { url: a.url, kind, motion, durationSeconds: dur };

    if (kind === "clip") {
      const start = Number.isFinite(a.trimStartSeconds) ? Math.max(0, a.trimStartSeconds!) : undefined;
      const end = Number.isFinite(a.trimEndSeconds) ? Math.max(0, a.trimEndSeconds!) : undefined;
      if (start != null) asset.trimStartSeconds = start;
      // Only keep a valid trim window (end strictly after start).
      if (end != null && (start == null || end > start)) asset.trimEndSeconds = end;
    }

    const fx = clamp01(a.focusX);
    const fy = clamp01(a.focusY);
    if (fx != null) asset.focusX = fx;
    if (fy != null) asset.focusY = fy;

    return asset;
  });

  return { ratio: params.ratio, durationSeconds, assets, transition };
}

/**
 * Render a single montage scene segment and upload it to DO Spaces.
 * Returns the stored object's key, public URL, and byte size (the caller
 * creates the corresponding UploadedAsset record).
 */
export async function renderScene(
  params: RenderSceneParams
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  const inputProps = buildSceneInputProps(params);

  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getRemotionBundle();

  const composition = await selectComposition({
    serveUrl,
    id: "MontageScene",
    inputProps: inputProps as unknown as Record<string, unknown>,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-montage-"));
  const outputPath = path.join(tmpDir, "scene.mp4");

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      pixelFormat: "yuv420p",
      outputLocation: outputPath,
      inputProps: inputProps as unknown as Record<string, unknown>,
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    });

    const data = await fs.readFile(outputPath);
    // Multipart: the montage base video is large; a single PutObject times out
    // (~50s window) and DO Spaces returns an opaque 400. Split into parts.
    await spacesUpload({ key: params.outputStorageKey, body: data, contentType: "video/mp4" });

    return {
      storageKey: params.outputStorageKey,
      storageUrl: spacesPublicUrl(params.outputStorageKey),
      fileSizeBytes: data.length,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
