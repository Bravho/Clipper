import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import type { TimedSegment } from "@/lib/ai/geminiSubtitlesService";
import type { AnimationSpec } from "@/lib/ai/animationService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { VideoRatio } from "@/lib/ai/ffmpegService";
import { getRemotionBundle } from "@/lib/ai/remotionBundle";

/**
 * Phase 4 — Remotion-based motion-graphics/caption overlay rendering.
 *
 * Renders one transparent (alpha-channel, VP8/yuva420p WebM) overlay clip
 * per required aspect ratio, using the `remotion/` project at the repo
 * root (composition id "Overlay" — see `remotion/Root.tsx`). The overlay
 * contains kinetic captions (from `voiceTimestamps`/`subtitleTimeline`) and
 * scene motion-graphics (from `animationSpecs`, produced by
 * `animationService.generateAnimationSpec`).
 *
 * `_runAnimationGeneration` (VideoGenerationService) calls `renderOverlay`
 * once per ratio returned by `ffmpegService.getRequiredRatiosForPlatforms`
 * and stores the resulting asset IDs on `job.animatedOverlayAssetIds`.
 * `_runFFmpegComposition` later composites each overlay onto the
 * corresponding cropped/scaled base video via `ffmpegService.overlayVideo`
 * / `composeSingleRatio`.
 *
 * Render failures should be treated like other AI-step failures: caught by
 * the caller, recorded via `failedAtStep = GeneratingAnimations`, and
 * retryable via `retryPipeline()` / `regenerateAnimationByRequester()`.
 */

const RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per ratio — generous for headless Chromium cold starts

export interface RenderOverlayParams {
  ratio: VideoRatio;
  /** Real voice/video duration in seconds (from `job.voiceDurationSeconds`). */
  durationSeconds: number;
  /** Per-sentence timing for kinetic captions (`job.voiceTimestamps`/`subtitleTimeline`, parsed). */
  subtitleTimeline: TimedSegment[];
  /** Languages to render as burned-in captions on this overlay. */
  subtitleLanguages: ("th" | "en" | "zh")[];
  /** Approved scene plan — passed through for future scene-transition templates. */
  scenePlan: ScenePlan[];
  /** Motion-graphics overlay specs from `animationService.generateAnimationSpec`. */
  animationSpecs: AnimationSpec[];
  /** DO Spaces key the rendered `.webm` overlay clip will be uploaded to. */
  outputStorageKey: string;
}

/**
 * Renders one transparent overlay clip and uploads it to DO Spaces.
 * Returns the asset's public URL (caller is responsible for creating the
 * corresponding `UploadedAsset` record).
 */
export async function renderOverlay(params: RenderOverlayParams): Promise<string> {
  const {
    ratio,
    durationSeconds,
    subtitleTimeline,
    subtitleLanguages,
    scenePlan,
    animationSpecs,
    outputStorageKey,
  } = params;

  const inputProps = {
    ratio,
    durationSeconds,
    subtitleTimeline,
    subtitleLanguages,
    scenePlan: scenePlan.map((s) => ({
      sceneNumber: s.sceneNumber,
      durationSeconds: s.durationSeconds,
      visualDescriptionThai: s.visualDescriptionThai,
      imageIndexes: s.imageIndexes,
    })),
    animationSpecs,
  };

  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getRemotionBundle();

  const composition = await selectComposition({
    serveUrl,
    id: "Overlay",
    inputProps,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-remotion-"));
  const outputPath = path.join(tmpDir, "overlay.webm");

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "vp8",
      pixelFormat: "yuva420p",
      outputLocation: outputPath,
      inputProps,
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    });

    const data = await fs.readFile(outputPath);
    const bucket = process.env.DO_SPACES_BUCKET!;
    await spacesClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputStorageKey,
        Body: data,
        ContentType: "video/webm",
        ACL: "public-read",
      })
    );
    return spacesPublicUrl(outputStorageKey);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
