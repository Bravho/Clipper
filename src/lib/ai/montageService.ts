import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spacesPublicUrl, spacesUpload } from "@/lib/spaces";
import { getRemotionBundle } from "@/lib/ai/remotionBundle";
import { RENDER_TUNING } from "@/config/renderTuning";
import type { HeadlessBrowser } from "@remotion/renderer";
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
  /**
   * Optional render-progress callback (0..1), forwarded from Remotion's
   * `renderMedia` overall progress. Used for the requester-facing % bar; must
   * never throw (callers wrap their own persistence in try/catch or
   * fire-and-forget).
   */
  onProgress?: (fraction: number) => void;
  /**
   * Optional shared Chromium (see `@/lib/ai/remotionBrowser`). When omitted,
   * Remotion launches and tears down its own for this one render — which is
   * what made the per-scene, per-ratio montage loop pay for dozens of cold
   * starts.
   */
  browser?: HeadlessBrowser;
}

/**
 * Everything needed to render a scene EXCEPT where to store it — the shape
 * `renderSceneToFile` takes, since it writes to a caller-supplied path instead
 * of uploading. `RenderSceneParams` is assignable to it.
 */
export type RenderSceneSpec = Omit<RenderSceneParams, "outputStorageKey">;

function clamp01(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/**
 * Pure: normalize render params into the Remotion composition's input props.
 * Defaults motion/transition, drops invalid focus/trim values, and guarantees
 * a positive scene duration. Unit-tested without touching Remotion or Spaces.
 */
export function buildSceneInputProps(params: RenderSceneSpec): MontageSceneProps {
  const durationSeconds =
    Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
      ? params.durationSeconds
      : Math.max(1, params.assets.length);

  const transition = isMontageTransition(params.transition)
    ? params.transition
    : DEFAULT_MONTAGE_TRANSITION;

  const assets: MontageInputAsset[] = params.assets.map((a) => {
    const kind: "image" | "clip" = a.kind === "clip" ? "clip" : "image";
    const motion =
      kind === "clip"
        ? "static"
        : isMotionPreset(a.motion)
          ? a.motion
          : DEFAULT_MOTION_PRESET;
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-montage-"));
  const outputPath = path.join(tmpDir, "scene.mp4");
  try {
    await renderSceneToFile(params, outputPath);

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

/**
 * Render a single montage scene segment straight to a local path, with NO
 * upload. The caller owns `destPath`.
 *
 * Used for the non-primary aspect ratios, whose segments are pure
 * intermediates: `_renderMontageBaseAtRatio` creates no `UploadedAsset` for
 * them and nothing ever surfaces them, yet every one used to be uploaded to
 * Spaces and then downloaded straight back by the crossfade concat. The
 * primary ratio still goes through `renderScene` — those segments ARE stored,
 * because the requester reviews them scene by scene.
 */
export async function renderSceneToFile(
  params: RenderSceneSpec,
  destPath: string
): Promise<{ path: string; fileSizeBytes: number }> {
  const inputProps = buildSceneInputProps(params);

  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getRemotionBundle();

  const composition = await selectComposition({
    serveUrl,
    id: "MontageScene",
    inputProps: inputProps as unknown as Record<string, unknown>,
    puppeteerInstance: params.browser,
  });

  await fs.mkdir(path.dirname(destPath), { recursive: true });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    pixelFormat: "yuv420p",
    // Same performance settings as the styled per-ratio render — this is the
    // other half of the render cost (`montage_all_segments`, and the montage
    // re-render each extra ratio triggers). See `@/config/renderTuning`.
    concurrency: RENDER_TUNING.concurrency,
    x264Preset: RENDER_TUNING.x264Preset,
    hardwareAcceleration: RENDER_TUNING.hardwareAcceleration,
    puppeteerInstance: params.browser,
    outputLocation: destPath,
    inputProps: inputProps as unknown as Record<string, unknown>,
    timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    onProgress: ({ progress }) => params.onProgress?.(progress),
  });

  const { size } = await fs.stat(destPath);
  return { path: destPath, fileSizeBytes: size };
}
