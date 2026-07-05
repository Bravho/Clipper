import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { spacesClient } from "@/lib/spaces";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import * as montageService from "@/lib/ai/montageService";
import * as elevenLabsTtsService from "@/lib/ai/elevenLabsTtsService";
import * as ffmpegService from "@/lib/ai/ffmpegService";
import type { VideoRatio } from "@/lib/ai/ffmpegService";
// Phase 7: subtitle + motion-graphic overlay rendering (Remotion) composited on
// top of the merged masters.
import * as remotionService from "@/lib/ai/remotionService";
import { derivePalette, type Palette } from "@/lib/ai/paletteService";
import type { TimedSegment } from "@/lib/ai/geminiSubtitlesService";
import { orderSourceAssets, type OrderedSourceAsset } from "@/lib/sourceAssets";
import { buildSceneMontageAssets, inferMotionFromText, toRenderAssetSpecs } from "@/lib/ai/montagePlan";
import {
  DEFAULT_MONTAGE_TRANSITION,
  isMontageTransition,
  minMontageTotalSeconds,
  sceneMontageSeconds,
} from "@/config/montage";
import { buildAiVideoKey, buildFinalClipKey } from "@/lib/spacesKeys";
import type { VideoGenerationJob, ScenePlan, StoryboardScene, UpdateVideoGenerationJobInput, ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";
import { getPublishFieldConfig, isPublishablePlatform } from "@/config/publishFields";
import type { GenerateContentParams } from "@/lib/ai/chatGptVisionService";
import type { ImageCoordinates } from "@/lib/ai/geminiSubtitlesService";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";
import { sanitizeSceneDescription, sanitizeScenePlanDescriptions } from "@/lib/ai/scenePlanSanitizer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AI_CONFIG } from "@/config/aiTools";
import { PIPELINE_STEP_COSTS } from "@/config/credits";
import { RenderStep, RENDER_STEP_FAILED_AT, isRenderStep } from "@/domain/enums/RenderStep";
import { RENDER_QUEUE } from "@/config/renderQueue";

const execFileAsync = promisify(execFile);

/**
 * Thrown when a request reaches scene design with zero usable uploaded media
 * (no images/clips). The montage engine animates only the client's real
 * uploads, so there is nothing to render — the pipeline fails clearly instead
 * of inventing imagery. Surfaced to the requester as an actionable message.
 */
export class NoUsableMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoUsableMediaError";
  }
}

function sanitizeScenePlanJson(scenePlanJson: string | null | undefined): string | null {
  if (!scenePlanJson) return scenePlanJson ?? null;
  try {
    const scenePlan = JSON.parse(scenePlanJson) as ScenePlan[];
    return JSON.stringify(sanitizeScenePlanDescriptions(scenePlan));
  } catch {
    return scenePlanJson;
  }
}

function clampPipelineDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS;
  return Math.min(
    PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS,
    Math.max(PIPELINE_STEP_COSTS.MIN_DURATION_SECONDS, Math.round(value))
  );
}

function normalizeScenePlanToDuration(scenePlan: ScenePlan[], durationSeconds: number): ScenePlan[] {
  if (scenePlan.length === 0) return scenePlan;

  const fixedIndexes = scenePlan
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => (scene.imageIndexes ?? []).length >= 2)
    .map(({ index }) => index);
  const fixedTotal = fixedIndexes.reduce(
    (sum, index) => sum + (Number(scenePlan[index].durationSeconds) || 0),
    0
  );
  const flexibleIndexes = scenePlan
    .map((scene, index) => ({ scene, index }))
    .filter(({ index }) => !fixedIndexes.includes(index))
    .map(({ index }) => index);

  if (flexibleIndexes.length === 0) return scenePlan;

  const flexibleTarget = Math.max(flexibleIndexes.length, durationSeconds - fixedTotal);
  const flexibleCurrentTotal = flexibleIndexes.reduce(
    (sum, index) => sum + (Number(scenePlan[index].durationSeconds) || 0),
    0
  );
  let remaining = flexibleTarget;

  return scenePlan.map((scene, index) => {
    if (!flexibleIndexes.includes(index)) return scene;
    if (index === flexibleIndexes[flexibleIndexes.length - 1]) {
      return { ...scene, durationSeconds: Math.max(1, remaining) };
    }

    const duration =
      flexibleCurrentTotal > 0
        ? Math.max(1, Math.round(((Number(scene.durationSeconds) || 0) / flexibleCurrentTotal) * flexibleTarget))
        : Math.max(1, Math.round(flexibleTarget / flexibleIndexes.length));
    remaining -= duration;
    return { ...scene, durationSeconds: duration };
  });
}

/**
 * Probe the real duration (seconds) of a stored audio asset using ffprobe.
 * Downloads the asset to a temp file, runs ffprobe, then cleans up.
 *
 * Used after voice generation (step 2) so video generation (step 3) can be
 * sized to the real voice duration instead of the scene-plan estimate.
 */
async function probeAudioDurationSeconds(storageKey: string): Promise<number> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-voice-"));
  const tmpFile = path.join(tmpDir, "voice.mp3");
  try {
    const bucket = process.env.DO_SPACES_BUCKET!;
    const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    await fs.writeFile(tmpFile, Buffer.concat(chunks));

    const ffprobePath = (AI_CONFIG.ffmpeg.path ?? "ffmpeg").replace(/ffmpeg(\.exe)?$/i, (m) =>
      m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"
    );

    const { stdout } = await execFileAsync(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      tmpFile,
    ]);

    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`ffprobe returned invalid duration: "${stdout.trim()}"`);
    }
    return duration;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export class VideoGenerationService {
  /**
   * Start a new pipeline for a request. Triggers ChatGPT Vision analysis.
   */
  async initializePipeline(
    requestId: string,
    staffId: string,
    params: {
      imageUrls: string[];
      description: string;
      targetAudience: string;
      targetPlatforms: Platform[];
      preferredStyle: string;
      rvcVoiceModel?: string;
    }
  ): Promise<VideoGenerationJob> {
    const existing = await videoGenerationJobRepository.findByRequestId(requestId);
    if (existing && existing.status === VideoGenerationJobStatus.Active) {
      throw new Error("An active pipeline already exists for this request");
    }

    const job = await videoGenerationJobRepository.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.AnalyzingContent,
      currentSceneIndex: 0,
      scenePlan: null,
      scriptThai: null,
      scriptEnglish: null,
      scriptChinese: null,
      hookThai: null,
      hookEnglish: null,
      captionThai: null,
      captionEnglish: null,
      captionChinese: null,
      approvedScenePlan: null,
      approvedScriptThai: null,
      approvedScriptEnglish: null,
      approvedScriptChinese: null,
      approvedHookThai: null,
      approvedHookEnglish: null,
      approvedCaptionThai: null,
      approvedCaptionEnglish: null,
      approvedCaptionChinese: null,
      videoGenTaskId: null,
      videoGenTaskIds: null,
      videoGenStatus: null,
      videoGenLastPolledAt: null,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
      ttsTaskId: null,
      rvcVoiceModel: params.rvcVoiceModel ?? "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      selectedMusicTrack: null,
      voiceDurationSeconds: null,
      voiceTimestamps: null,
      subtitleTimeline: null,
      animationSpec: null,
      animatedVideoAssetId: null,
      animatedOverlayAssetIds: null,
      animationApprovedBy: null,
      finalExport_9_16_assetId: null,
      finalExport_16_9_assetId: null,
      finalExport_1_1_assetId: null,
      finalExport_4_5_assetId: null,
      finalExport_tvent_assetId: null,
      subtitleLanguages: ["th", "en"],
      failedAtStep: null,
      contentApprovedBy: null,
      videoApprovedBy: null,
      voiceApprovedBy: null,
      finalApprovedBy: null,
    });

    // Run Gemini analysis and update job when complete
    this._runChatGptAnalysis(job.id, requestId, params).catch(async (err) => {
      console.error("Gemini analysis failed:", err);
      await videoGenerationJobRepository.update(job.id, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.AnalyzingContent,
      });
    });

    return job;
  }

  private async _runChatGptAnalysis(
    jobId: string,
    requestId: string,
    params: Omit<GenerateContentParams, "videoDurationSeconds">
  ): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const { businessProfileService } = await import("@/services/BusinessProfileService");

    const req = await clipRequestRepository.findById(requestId);
    let businessProfileContext = null;

    if (req) {
      try {
        const profile = await businessProfileService.getProfile(req.userId);
        if (profile) {
          businessProfileContext = {
            businessName: profile.businessName,
            category: profile.category,
            location: profile.location,
            description: profile.description,
            menuDetails: profile.menuDetails,
          };
        }
      } catch (err) {
        console.error("Failed to load business profile context:", err);
      }
    }

    const output = await chatGptVisionService.generateSpeakingScript({
      ...params,
      videoDurationSeconds: 15,
      businessProfileContext,
    });

    await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingContentApproval,
      scenePlan: null,
      scriptThai: output.scriptThai,
      hookThai: null,
      captionThai: output.captionThai,
      // Stage-1 rough storyboard, approved with the script and used to seed the
      // Stage-3 montage scene design (and shown read-only at Stage 2).
      storyboard: output.storyboard ? JSON.stringify(output.storyboard) : null,
    });

    // Auto-save/enrich business profile from AI extraction
    if (output.businessProfile) {
      try {
        if (req) {
          await businessProfileService.saveProfile(req.userId, {
            businessName: output.businessProfile.businessName,
            category: output.businessProfile.category,
            location: output.businessProfile.location ?? null,
            description: output.businessProfile.description ?? null,
            menuDetails: output.businessProfile.menuDetails ?? null,
          });
          console.log(`[AI Profile] Auto-saved business profile for user ${req.userId}`);
        }
      } catch (profileErr) {
        console.error("Failed to auto-save business profile from AI output:", profileErr);
      }
    }
  }

  /**
   * Check if ChatGPT analysis is complete (used by status poll endpoint).
   * Returns the updated job.
   */
  async checkContentAnalysisReady(jobId: string): Promise<VideoGenerationJob> {
    return this._getJob(jobId);
  }

  /**
   * Staff approves the speaking script (with optional edits), then starts
   * iAppTTS voice generation.
   */
  async approveContent(
    jobId: string,
    staffId: string,
    approved: {
      scenePlan?: string | null;
      scriptThai: string;
      scriptEnglish: string;
      hookThai?: string | null;
      hookEnglish: string;
      captionThai: string;
      captionEnglish: string;
      captionChinese: string;
      /** Requester-edited storyboard (JSON). Falls back to the generated one. */
      storyboard?: string | null;
    }
  ): Promise<VideoGenerationJob> {
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingContentApproval);
    const scriptThai = sanitizeThaiVoiceScript(approved.scriptThai);
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingVoice,
      approvedScenePlan: sanitizeScenePlanJson(approved.scenePlan),
      approvedScriptThai: scriptThai,
      approvedScriptEnglish: approved.scriptEnglish,
      approvedHookThai: approved.hookThai ?? null,
      approvedHookEnglish: approved.hookEnglish,
      approvedCaptionThai: approved.captionThai,
      approvedCaptionEnglish: approved.captionEnglish,
      approvedCaptionChinese: approved.captionChinese,
      // Carry the storyboard forward (requester edits win; else the generated one).
      approvedStoryboard: approved.storyboard ?? job.storyboard ?? null,
      contentApprovedBy: staffId,
    });

    this._runIAppTtsGeneration(updated).catch(async (err) => {
      console.error("[ElevenLabs] Voice generation failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingVoice,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Allocate `totalSeconds` across `scenePlan` entries proportionally to
   * each scene's original estimated `durationSeconds` (from the ChatGPT
   * scene plan). This is used before the progressive Veo extension stage.
   *
   * Why proportional allocation rather than deriving durations directly from
   * `voiceTimestamps`: `voiceTimestamps` is a flat array of per-SENTENCE
   * `{start, end, text}` segments produced by Gemini alignment, with no
   * `sceneNumber` linking a segment to a specific scene — there is no
   * reliable 1:1 or N:1 mapping from timestamp segments to scenes without
   * re-running alignment per scene (out of scope for this phase). The scene
   * plan's `durationSeconds` estimates, however, DO sum to the original
   * estimated total and reflect the AI's intended relative pacing across
   * scenes, so scaling them to the real total voice duration preserves that
   * pacing while matching the real audio length.
   *
   * Falls back to an equal split if scene estimates are missing/zero.
   */
  private _allocateSceneDurations(scenePlan: ScenePlan[], totalSeconds: number): number[] {
    const estimates = scenePlan.map((s) => (Number.isFinite(s.durationSeconds) && s.durationSeconds > 0 ? s.durationSeconds : 0));
    const sumEstimates = estimates.reduce((a, b) => a + b, 0);

    if (sumEstimates <= 0) {
      const equal = totalSeconds / scenePlan.length;
      return scenePlan.map(() => equal);
    }

    return estimates.map((e) => (e / sumEstimates) * totalSeconds);
  }

  // ── Real-media montage engine (the only base-video engine) ──────────────────

  /** Montage canvas ratio for a request's primary platform. */
  private _montageCanvasRatio(primaryPlatform: Platform): VideoRatio {
    const raw = PLATFORM_ASPECT_RATIOS[primaryPlatform];
    const valid: VideoRatio[] = ["9:16", "16:9", "1:1", "4:5"];
    return (valid as string[]).includes(raw) ? (raw as VideoRatio) : "9:16";
  }

  /** Fetch + canonically order a request's source assets (index-stable). */
  private async _orderedSourceAssets(requestId: string): Promise<OrderedSourceAsset[]> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    return orderSourceAssets(assets);
  }

  /**
   * Detect the hero subject (dish/sign) in each IMAGE asset via Gemini and map
   * its bounding-box center to a 0..1 focus point, keyed by canonical asset
   * index. Used to steer Ken Burns motion onto the subject instead of the photo
   * center. Clips are skipped (not still images). Fail-open: on any error this
   * returns an empty map and motion falls back to center framing.
   */
  private async _detectFocusByIndex(
    ordered: OrderedSourceAsset[]
  ): Promise<Map<number, { focusX: number; focusY: number }>> {
    const focusByIndex = new Map<number, { focusX: number; focusY: number }>();
    const images = ordered.filter((a) => a.kind === "image");
    if (images.length === 0) return focusByIndex;

    try {
      const { detectProductCoordinates } = await import("@/lib/ai/geminiSubtitlesService");
      const coords = await detectProductCoordinates(images.map((a) => a.url));
      images.forEach((img, i) => {
        const c = coords?.[i];
        if (!c) return;
        const cx = (c.xmin + c.xmax) / 2 / 1000;
        const cy = (c.ymin + c.ymax) / 2 / 1000;
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        focusByIndex.set(img.index, {
          focusX: Math.min(1, Math.max(0, cx)),
          focusY: Math.min(1, Math.max(0, cy)),
        });
      });
    } catch (err) {
      console.error("[Montage] subject-focus detection failed, using center framing:", err);
    }
    return focusByIndex;
  }

  /**
   * Render ONE montage scene segment (the requester's real photos/clips with
   * Ken Burns + transitions) and write it into `sceneVideoAssetIds[sceneIndex]`
   * NON-cumulatively. Does NOT change the pipeline step — the caller decides
   * when to advance (one scene → AwaitingVideoApproval, or all scenes → review).
   * Returns the new segment asset's id. Re-reads the latest segment array before
   * writing so sequential batch renders accumulate correctly.
   */
  private async _renderSceneInto(job: VideoGenerationJob, sceneIndex: number): Promise<string> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(job.requestId);
    if (!req) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const ordered = await this._orderedSourceAssets(job.requestId);
    const scenePlan = sanitizeScenePlanDescriptions(
      JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]") as ScenePlan[]
    );
    const scene = scenePlan[sceneIndex];
    if (!scene) throw new Error(`No approved scene at index ${sceneIndex} for montage render`);

    const fallbackSceneDuration =
      (job.voiceDurationSeconds ?? req.durationSeconds ?? 15) / Math.max(1, scenePlan.length);
    const sceneDuration =
      Number.isFinite(scene.durationSeconds) && scene.durationSeconds > 0
        ? scene.durationSeconds
        : Math.max(1, fallbackSceneDuration);

    // Prefer the concrete montage assets fixed at scene-design; rebuild from the
    // canonical ordering for legacy scenes that only carry `imageIndexes`.
    const sceneAssets =
      scene.assets && scene.assets.length > 0
        ? scene.assets
        : buildSceneMontageAssets(scene, ordered, sceneDuration);
    const renderAssets = toRenderAssetSpecs(sceneAssets, ordered);
    const totalDuration =
      renderAssets.reduce((sum, a) => sum + a.durationSeconds, 0) || sceneDuration;

    const ratio = this._montageCanvasRatio(req.targetPlatforms[0] ?? Platform.TventApp);
    const transition = isMontageTransition(scene.transitionIn)
      ? scene.transitionIn
      : DEFAULT_MONTAGE_TRANSITION;
    const outputStorageKey = buildAiVideoKey(req.userId, job.requestId);

    const stored = await montageService.renderScene({
      ratio,
      durationSeconds: totalDuration,
      assets: renderAssets,
      transition,
      outputStorageKey,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: req.userId,
      fileName: `montage_scene_${sceneIndex + 1}.mp4`,
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes: stored.fileSizeBytes,
      mimeType: "video/mp4",
      storageKey: stored.storageKey,
      storageUrl: stored.storageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
      videoRatio: ratio,
    });

    // Per-scene (non-cumulative): index i holds scene i's segment only. Re-read
    // the latest array so a sequential batch render doesn't clobber siblings.
    const latest = await videoGenerationJobRepository.findById(job.id);
    const segments: (string | null)[] = [...(latest?.sceneVideoAssetIds ?? job.sceneVideoAssetIds ?? [])];
    while (segments.length <= sceneIndex) segments.push(null);
    segments[sceneIndex] = asset.id;

    await videoGenerationJobRepository.update(job.id, {
      sceneVideoAssetIds: segments,
      videoGenLastPolledAt: new Date(),
    });
    return asset.id;
  }

  /**
   * Render ONE scene then advance to the combined review (AwaitingVideoApproval).
   * Used for a single-scene re-render (per-scene revision / retry); the other
   * scenes' segments are left untouched. Fire-and-forget.
   */
  // ──────────────────────────────────────────────────────────────────────────
  // Render-queue seam (Mac Mini worker offload)
  //
  // Every heavy compute step (montage render, animation/overlay render, FFmpeg
  // composition, additional-ratios) is dispatched through `_dispatchHeavy`
  // instead of being launched inline. If a Mac worker heartbeat is fresh, the
  // step is ENQUEUED (one DB write) for the worker to claim; otherwise it runs
  // INLINE exactly as before (the droplet fallback, so it never blocks when the
  // Mac is offline). Either way the API route returns promptly and the existing
  // pipeline-status poller is unchanged — `currentStep` is already a
  // "Generating…" state when this is called.
  // ──────────────────────────────────────────────────────────────────────────

  private async _dispatchHeavy(
    job: VideoGenerationJob,
    renderStep: RenderStep,
    inlineFn: () => Promise<void>,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const onFail = async (err: unknown) => {
      console.error(`[render:${renderStep}] failed:`, err);
      await videoGenerationJobRepository.update(job.id, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: RENDER_STEP_FAILED_AT[renderStep],
      });
    };

    if (RENDER_QUEUE.enabled) {
      try {
        if (
          await videoGenerationJobRepository.isRenderWorkerAlive(
            RENDER_QUEUE.workerFreshSeconds
          )
        ) {
          await videoGenerationJobRepository.update(job.id, {
            renderState: "queued",
            renderStep,
            renderPayload: payload ?? null,
            claimedBy: null,
            claimedAt: null,
            renderHeartbeatAt: null,
          });
          return;
        }
      } catch (err) {
        // Never strand a job: if the liveness check or enqueue write fails,
        // fall through and run the step inline.
        console.error(`[render:${renderStep}] enqueue failed, running inline:`, err);
      }
    }

    void inlineFn().catch(onFail);
  }

  /**
   * Worker entrypoint: run ONE claimed render step by dispatching to the SAME
   * private compute method the web server would have run inline — no compute is
   * reimplemented. Throws on failure so the worker can mark the claim 'failed'
   * (see `recordRenderStepFailure`).
   */
  async runQueuedRenderStep(job: VideoGenerationJob): Promise<void> {
    const step = job.renderStep;
    if (!isRenderStep(step)) {
      throw new Error(`Job ${job.id} has no valid render step: ${String(step)}`);
    }
    switch (step) {
      case RenderStep.MontageSceneSegment: {
        const sceneIndex = Number(
          (job.renderPayload as { sceneIndex?: unknown } | null)?.sceneIndex ??
            job.currentSceneIndex ??
            0
        );
        await this._renderSceneSegment(job, sceneIndex);
        break;
      }
      case RenderStep.MontageAllSegments:
        await this._renderAllSceneSegments(job);
        break;
      case RenderStep.AnimationGeneration:
        await this._runAnimationGeneration(job);
        break;
      case RenderStep.FfmpegComposition:
        await this._runFFmpegComposition(job);
        break;
      case RenderStep.OverlayComposition:
        await this._runOverlayComposition(job);
        break;
      case RenderStep.AdditionalRatios:
        await this._runAdditionalRatiosOverlay(job);
        break;
      default: {
        const _exhaustive: never = step;
        throw new Error(`Unhandled render step: ${String(_exhaustive)}`);
      }
    }
  }

  /** Failure bookkeeping for a worker-run step (mirrors the inline `.catch`). */
  async recordRenderStepFailure(job: VideoGenerationJob): Promise<void> {
    const step = isRenderStep(job.renderStep) ? job.renderStep : null;
    await videoGenerationJobRepository.update(job.id, {
      status: VideoGenerationJobStatus.Failed,
      currentStep: VideoGenerationStep.Failed,
      failedAtStep: step ? RENDER_STEP_FAILED_AT[step] : VideoGenerationStep.Failed,
    });
  }

  private async _renderSceneSegment(job: VideoGenerationJob, sceneIndex: number): Promise<void> {
    const assetId = await this._renderSceneInto(job, sceneIndex);
    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingVideoApproval,
      baseVideoAssetId: assetId,
      videoGenStatus: null,
      videoGenLastPolledAt: new Date(),
    });
  }

  /**
   * Render EVERY scene's segment sequentially, then advance to the combined
   * review where the requester reviews all scene videos together and clicks
   * "Approve all" to merge. Fire-and-forget; on any scene failure the caller's
   * `.catch` records `failedAtStep = GeneratingBaseVideo` for retry.
   */
  private async _renderAllSceneSegments(job: VideoGenerationJob): Promise<void> {
    const scenePlan = sanitizeScenePlanDescriptions(
      JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]") as ScenePlan[]
    );
    for (let i = 0; i < scenePlan.length; i++) {
      await this._renderSceneInto(job, i);
    }

    const latest = await videoGenerationJobRepository.findById(job.id);
    const firstSegment =
      (latest?.sceneVideoAssetIds ?? []).find((id): id is string => !!id) ?? null;

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingVideoApproval,
      // Representative id so the review panel renders; the real concatenated
      // base is built at "Approve all" (approveBaseVideoByRequester).
      baseVideoAssetId: firstSegment,
      videoGenStatus: null,
      videoGenLastPolledAt: new Date(),
    });
  }

  /**
   * Concatenate all approved per-scene montage segments (in scene order) into
   * the single `baseVideoAssetId` the rest of the pipeline consumes, using the
   * existing `ffmpegService.concatVideos`. Returns the new base asset's id.
   */
  private async _concatMontageBaseVideo(job: VideoGenerationJob): Promise<string> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(job.requestId);
    if (!req) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const segmentIds = (job.sceneVideoAssetIds ?? []).filter((id): id is string => !!id);
    if (segmentIds.length === 0) throw new Error("No montage segments to concatenate");

    const segmentAssets = await Promise.all(
      segmentIds.map((id) => uploadedAssetRepository.findById(id))
    );
    const storageKeys = segmentAssets
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => a.storageKey);
    if (storageKeys.length === 0) throw new Error("Montage segment assets missing for concatenation");

    const outputKey = buildAiVideoKey(req.userId, job.requestId);
    // Cross-dissolve at scene joins (falls back to hard-cut concat on failure).
    const { storageKey, storageUrl, fileSizeBytes } = await ffmpegService.concatVideosWithCrossfade(
      storageKeys,
      outputKey
    );

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const baseAsset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: req.userId,
      fileName: "montage_base.mp4",
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes,
      mimeType: "video/mp4",
      storageKey,
      storageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
    });
    return baseAsset.id;
  }

  /**
   * Montage path: the scene segment renders inline in a fire-and-forget
   * background task (`_renderSceneSegment`) that advances the step to
   * AwaitingVideoApproval itself — there is no async provider to poll, so this
   * just returns the job. Retained because the status-poll endpoint calls it.
   */
  async checkBaseVideoReady(jobId: string): Promise<VideoGenerationJob> {
    return this._getJob(jobId);
  }

  /** Staff approves the generated scene video; defers to the requester logic. */
  async approveBaseVideo(
    jobId: string,
    staffId: string,
    selectedMusicTrack: string | null = null
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    if (selectedMusicTrack !== null) {
      await videoGenerationJobRepository.update(jobId, { selectedMusicTrack });
    }
    return this.approveBaseVideoByRequester(jobId, staffId);
  }

  /**
   * Staff rejects the generated video.
   * @param backToStep  "video" → re-render all scenes; "content" → back to ChatGPT
   */
  async rejectBaseVideo(
    jobId: string,
    staffId: string,
    backToStep: "video" | "content"
  ): Promise<VideoGenerationJob> {
    void staffId;
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    if (backToStep === "content") {
      return videoGenerationJobRepository.update(jobId, {
        currentStep: VideoGenerationStep.AwaitingContentApproval,
      });
    }

    // Re-render the whole batch from a clean slate, then return to review.
    const prepared = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      currentSceneIndex: 0,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
      videoGenStatus: null,
    });
    await this._dispatchHeavy(prepared, RenderStep.MontageAllSegments, () =>
      this._renderAllSceneSegments(prepared)
    );
    return this._getJob(jobId);
  }

  // ── TTS voice generation (ElevenLabs) ────────────────────────────────────────

  /**
   * Generate the voice-over with ElevenLabs (Sarah voice, eleven_v3, Thai
   * language override) and store it in DO Spaces. Runs the full flow inline —
   * ElevenLabs is a synchronous cloud API (~5-15 s), so no task ID or polling
   * is needed. On success the job advances to AwaitingVoiceApproval.
   *
   * Uses job.approvedScriptThai (the staff/requester-approved speaking script).
   */
  private async _runIAppTtsGeneration(job: VideoGenerationJob): Promise<void> {
    const scriptThai = sanitizeThaiVoiceScript(job.approvedScriptThai ?? job.scriptThai ?? "");
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

    if (scriptThai !== (job.approvedScriptThai ?? job.scriptThai ?? "")) {
      await videoGenerationJobRepository.update(job.id, {
        scriptThai,
        approvedScriptThai: scriptThai,
      });
    }

    console.log(`[ElevenLabs] Synthesizing voice for request ${job.requestId}...`);
    const request = await this._getClipRequestBasic(job.requestId);
    const stored = await elevenLabsTtsService.synthesizeAndStore({
      text: scriptThai,
      userId: request.userId,
      requestId: job.requestId,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: stored.fileName,
      assetType: AssetType.StaffVoiceRecording,
      fileSizeBytes: stored.fileSizeBytes,
      mimeType: stored.mimeType,
      storageKey: stored.storageKey,
      storageUrl: stored.storageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
    });

    // Probe the real duration of the synthesized voice — this becomes the
    // source of truth for the video generator's durationSeconds (step 3).
    let voiceDurationSeconds: number | null = null;
    try {
      voiceDurationSeconds = await probeAudioDurationSeconds(stored.storageKey);
    } catch (err) {
      console.error("[ffprobe] Failed to probe voice duration:", err);
    }

    // Gemini alignment — produce per-sentence timestamps now (moved up from
    // the old "animation" step) so subtitleTimeline is ready before Veo.
    let voiceTimestamps: string | null = null;
    let subtitleTimeline: string | null = null;
    try {
      const { requireGeminiApiKey, AI_CONFIG } = await import("@/config/aiTools");
      requireGeminiApiKey();

      const scriptEnglishCurrent = job.approvedScriptEnglish ?? job.scriptEnglish ?? "";
      const scriptChineseCurrent = job.approvedScriptChinese ?? job.scriptChinese ?? "";
      let scriptEnglish = scriptEnglishCurrent;
      let scriptChinese = scriptChineseCurrent;

      if (!scriptEnglish || !scriptChinese) {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
        const res = await ai.models.generateContent({
          model: AI_CONFIG.gemini.textModel,
          contents: `Translate this Thai script into natural, spoken English and Simplified Chinese for social media subtitles: "${scriptThai}"
Return ONLY a valid JSON object: { "english": "...", "chinese": "..." }`,
          config: { responseMimeType: "application/json", temperature: 0.2 },
        });
        try {
          const parsed = JSON.parse(res.text ?? "{}");
          scriptEnglish = scriptEnglish || (parsed.english ?? "");
          scriptChinese = scriptChinese || (parsed.chinese ?? "");
        } catch {
          /* keep whatever we already had */
        }
        await videoGenerationJobRepository.update(job.id, {
          scriptEnglish,
          approvedScriptEnglish: scriptEnglish,
          scriptChinese,
          approvedScriptChinese: scriptChinese,
        });
      }

      const geminiSubtitlesService = await import("@/lib/ai/geminiSubtitlesService");
      const segments = await geminiSubtitlesService.alignAudioWithScript({
        audioUrl: stored.storageUrl,
        scriptThai,
        scriptEnglish,
        scriptChinese,
        durationSeconds: voiceDurationSeconds ?? 15,
      });
      voiceTimestamps = JSON.stringify(segments);
      subtitleTimeline = voiceTimestamps;
    } catch (err) {
      console.error("[GeminiAlignment] Failed to align voice timestamps:", err);
    }

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingVoiceApproval,
      voiceRecordingAssetId: asset.id,
      processedVoiceAssetId: asset.id,
      voiceDurationSeconds,
      voiceTimestamps,
      subtitleTimeline,
    });
    console.log(`[ElevenLabs] Voice stored for request ${job.requestId}: ${stored.storageKey}`);
  }

  /**
   * Re-submit the approved script to ElevenLabs for a fresh voice synthesis.
   *
   * Accepted starting states:
   *   - AwaitingVoiceApproval (normal regeneration), or
   *   - Failed with failedAtStep = GeneratingVoice (self-healing retry — a
   *     previous voice generation failed, e.g. the TTS server was down,
   *     and the job would otherwise be stuck rejecting every retry with 400).
   */
  async regenerateVoice(
    jobId: string,
    _userId: string
  ): Promise<VideoGenerationJob> {
    void _userId; // retained for caller-identity parity; not yet persisted
    const job = await this._getJob(jobId);
    const isFailedPipeline = job.currentStep === VideoGenerationStep.Failed;

    if (job.currentStep !== VideoGenerationStep.AwaitingVoiceApproval && !isFailedPipeline) {
      throw new Error(
        `Expected pipeline step ${VideoGenerationStep.AwaitingVoiceApproval} but job is at ${job.currentStep}`
      );
    }

    const updated = await videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.GeneratingVoice,
      failedAtStep: null,
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      ttsTaskId: null,
      rvcVoiceModel: "",
    });

    this._runIAppTtsGeneration(updated).catch(async (err) => {
      console.error("[iAppTTS] Regeneration failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingVoice,
      });
    });

    return updated;
  }

  /**
   * Phase 4 (Remotion-based compositing): renders one transparent overlay
   * clip per required aspect ratio (captions + motion graphics), stores
   * them on `animatedOverlayAssetIds`, and composites a single
   * representative-ratio preview (`animatedVideoAssetId`) for the
   * `AwaitingAnimationApproval` review UI. `_runFFmpegComposition` later
   * composites each ratio's overlay onto the final export directly.
   */
  private async _runAnimationGeneration(job: VideoGenerationJob): Promise<void> {
    // Phase 7 (deferred): this step previously generated Claude motion-graphics
    // specs and rendered a transparent Remotion caption/motion overlay per ratio,
    // then composited a preview. That work — together with burned-in subtitles —
    // is temporarily disabled and will return in Phase 7 with accurate subtitle
    // timestamp/timeline alignment.
    //
    // For now the AwaitingAnimationApproval step only collects the requester's
    // music choice; the base video stands in as the review preview, and no
    // overlay assets are produced (so the final compose burns no captions).
    if (!job.baseVideoAssetId) {
      throw new Error("Base video asset not found for animation step");
    }

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingAnimationApproval,
      animatedVideoAssetId: job.baseVideoAssetId,
      animatedOverlayAssetIds: {},
    });
  }

  /** Requester approves the animated video, selects target platforms, and triggers FFmpeg final composition. */
  async approveAnimationByRequester(
    jobId: string,
    userId: string,
    targetPlatforms?: Platform[],
    selectedMusicTrack: string | null = null,
    subtitleLanguages?: ("th" | "en" | "zh")[]
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingAnimationApproval);

    const job = await this._getJob(jobId);
    // Distribution channels are chosen at voice approval. Only overwrite them
    // here if a non-empty set is explicitly provided (legacy callers).
    if (targetPlatforms && targetPlatforms.length > 0) {
      const { clipRequestRepository } = await import("@/repositories/index");
      await clipRequestRepository.update(job.requestId, { targetPlatforms });
    }

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.ComposingFinalVideo,
      animationApprovedBy: userId,
      ...(selectedMusicTrack !== null ? { selectedMusicTrack } : {}),
      ...(subtitleLanguages && subtitleLanguages.length > 0 ? { subtitleLanguages } : {}),
    });

    await this._dispatchHeavy(updated, RenderStep.FfmpegComposition, () =>
      this._runFFmpegComposition(updated)
    );

    return updated;
  }

  /** Requester re-triggers animation generation (Phase 7: motion graphics + subtitles). */
  async regenerateAnimationByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    void userId; // retained for caller-identity parity; not yet persisted
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingAnimationApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      animatedVideoAssetId: null,
      animatedOverlayAssetIds: null,
    });

    await this._dispatchHeavy(updated, RenderStep.AnimationGeneration, () =>
      this._runAnimationGeneration(updated)
    );

    return updated;
  }

  private async _runSceneDesignGeneration(job: VideoGenerationJob): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const { businessProfileService } = await import("@/services/BusinessProfileService");

    const req = await clipRequestRepository.findById(job.requestId);
    if (!req) throw new Error(`ClipRequest not found: ${job.requestId}`);

    // Canonical ordering: the indexes the Vision model returns (imageIndexes /
    // assetIndex) resolve to the SAME asset in the renderer and the panels.
    const ordered = await this._orderedSourceAssets(job.requestId);

    // The montage engine animates the client's real uploads — it cannot invent
    // imagery. With no usable photos/clips there is nothing to render, so fail
    // clearly here rather than producing an empty video.
    if (ordered.length === 0) {
      throw new NoUsableMediaError(
        "No usable photos or clips were uploaded for this request. Please upload at least one image or video clip and try again."
      );
    }

    const imageUrls = ordered.map((a) => a.url);

    let businessProfileContext = null;
    try {
      const profile = await businessProfileService.getProfile(req.userId);
      if (profile) {
        businessProfileContext = {
          businessName: profile.businessName,
          category: profile.category,
          location: profile.location,
          description: profile.description,
          menuDetails: profile.menuDetails,
        };
      }
    } catch (err) {
      console.error("Failed to load business profile context for scene design:", err);
    }

    const scriptThai = sanitizeThaiVoiceScript(job.approvedScriptThai ?? job.scriptThai ?? "");
    if (!scriptThai) throw new Error("Approved speaking script is missing");

    const durationSeconds =
      job.voiceDurationSeconds ??
      (Number.isFinite(req.durationSeconds) && req.durationSeconds > 0 ? req.durationSeconds : 15);

    // Seed scene design from the approved Stage-1 storyboard when available.
    let storyboard: StoryboardScene[] | null = null;
    try {
      if (job.approvedStoryboard) storyboard = JSON.parse(job.approvedStoryboard);
    } catch {
      storyboard = null;
    }

    const output = await chatGptVisionService.generateSceneDesignFromScript({
      imageUrls,
      description: req.description,
      targetAudience: req.targetAudience,
      targetPlatforms: req.targetPlatforms,
      preferredStyle: req.preferredStyle,
      videoDurationSeconds: durationSeconds,
      businessProfileContext,
      scriptThai,
      voiceDurationSeconds: job.voiceDurationSeconds,
      storyboard,
    });

    // Subject-aware focus: steer Ken Burns onto the dish/sign per image asset.
    const focusByIndex = await this._detectFocusByIndex(ordered);

    // Fix the concrete per-scene asset list now (motion presets + per-asset
    // durations snapped to the scene length) so the renderer and the approval
    // panels share one index-aligned plan.
    // Size the montage to cover the voice PLUS the short music intro + ending,
    // so the default (pre-edit) plan already clears the minimum-length gate the
    // requester is held to at approval. Trimming clips can only grow it further.
    const montageTargetSeconds = minMontageTotalSeconds(job.voiceDurationSeconds ?? durationSeconds);
    const sceneDurations = this._allocateSceneDurations(output.scenePlan, montageTargetSeconds);
    const scenePlanToPersist: ScenePlan[] = output.scenePlan.map((scene, i) => {
      const sceneDuration =
        Number.isFinite(sceneDurations[i]) && sceneDurations[i] > 0
          ? sceneDurations[i]
          : scene.durationSeconds;
      const assets = buildSceneMontageAssets(scene, ordered, sceneDuration).map((a) => {
        // Only stills get Ken Burns focus; don't overwrite an explicit choice.
        if (ordered[a.assetIndex]?.kind === "image" && a.focusX == null && a.focusY == null) {
          const f = focusByIndex.get(a.assetIndex);
          if (f) return { ...a, focusX: f.focusX, focusY: f.focusY };
        }
        return a;
      });
      return {
        ...scene,
        assets,
        transitionIn: isMontageTransition(scene.transitionIn)
          ? scene.transitionIn
          : DEFAULT_MONTAGE_TRANSITION,
      };
    });

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
      scenePlan: JSON.stringify(scenePlanToPersist),
      hookThai: output.hookThai,
      captionThai: output.captionThai,
    });
  }

  /** Staff approves the AI voice and triggers scene/hook design from the approved script. */
  async approveVoiceConversion(
    jobId: string,
    staffId: string,
    _selectedMusicTrack: string | null = null
  ): Promise<VideoGenerationJob> {
    void _selectedMusicTrack; // retained for signature parity with the requester path
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingSceneDesign,
      voiceApprovedBy: staffId,
    });

    this._runSceneDesignGeneration(updated).catch(async (err) => {
      console.error("Scene design generation failed:", err);
      await videoGenerationJobRepository.update(job.id, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingSceneDesign,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Persist the requester's chosen distribution channels (ordered, primary
   * first) on the request. `targetPlatforms[0]` is the PRIMARY channel and sets
   * the montage base video's aspect ratio (`_montageCanvasRatio` reads it); the
   * rest are export targets, cropped from the base downstream. Invalid entries
   * are dropped and Travy App (Tvent) is always included as a mandatory channel.
   * No-op on an empty/invalid list. Done at voice approval, BEFORE any render.
   */
  private async _setDistributionChannels(requestId: string, platforms: Platform[]): Promise<void> {
    const valid = platforms.filter((p) => Object.values(Platform).includes(p));
    // Dedupe, preserving the (primary-first) order.
    const ordered = Array.from(new Set(valid));
    if (ordered.length === 0) return;
    // Travy App is mandatory — always part of the distribution set.
    if (!ordered.includes(Platform.TventApp)) ordered.push(Platform.TventApp);

    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(requestId);
    if (!req) return;
    await clipRequestRepository.update(requestId, { targetPlatforms: ordered });
  }

  /** Requester approves AI voice and triggers scene/hook design from the approved script. */
  async approveVoiceConversionByRequester(
    jobId: string,
    userId: string,
    targetPlatforms?: Platform[]
  ): Promise<VideoGenerationJob> {
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

    // The chosen channels set the distribution set; the primary (first) sets the
    // base video's aspect ratio.
    if (targetPlatforms && targetPlatforms.length > 0) {
      await this._setDistributionChannels(job.requestId, targetPlatforms);
    }

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingSceneDesign,
      voiceApprovedBy: userId,
    });

    this._runSceneDesignGeneration(updated).catch(async (err) => {
      console.error("Scene design generation failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingSceneDesign,
      });
    });

    return this._getJob(jobId);
  }

  async approveSceneDesignByRequester(
    jobId: string,
    userId: string,
    approved: {
      scenePlan: string;
      durationSeconds: number;
    }
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingSceneDesignApproval);
    const job = await this._getJob(jobId);
    const durationSeconds = clampPipelineDurationSeconds(
      job.voiceDurationSeconds ?? approved.durationSeconds
    );
    const parsedScenePlan = sanitizeScenePlanDescriptions(
      JSON.parse(approved.scenePlan) as ScenePlan[]
    );
    // Montage scenes carry authoritative per-asset durations (trimmed clips play
    // their selected window; stills their allocated hold) and may auto-grow past
    // the voice length, so they are NOT re-normalized to the target. Legacy Veo
    // scenes (no `assets`) still get scaled to the target duration.
    const isMontage = parsedScenePlan.some((s) => Array.isArray(s.assets) && s.assets.length > 0);
    const scenePlan = isMontage
      ? parsedScenePlan
      : normalizeScenePlanToDuration(parsedScenePlan, durationSeconds);

    if (isMontage) {
      const totalSeconds = scenePlan.reduce((sum, s) => sum + sceneMontageSeconds(s), 0);
      const minSeconds = minMontageTotalSeconds(job.voiceDurationSeconds ?? durationSeconds);
      if (totalSeconds + 1e-6 < minSeconds) {
        throw new Error(
          `ความยาววิดีโอรวม (${Math.round(totalSeconds * 10) / 10} วินาที) ต้องอย่างน้อย ${Math.round(minSeconds * 10) / 10} วินาที เพื่อให้คลุมเสียงพากย์ทั้งหมด`
        );
      }
    }

    const { clipRequestRepository } = await import("@/repositories/index");
    await clipRequestRepository.update(job.requestId, { durationSeconds });

    // The all-scenes overview page shows every scene's script (editable).
    // Approving it persists the full plan and renders ALL scenes; the requester
    // then reviews every scene video together and clicks "Approve all" to merge.
    //
    // Fresh batch — clear any stale segment state in the same update.
    const cleared = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      currentSceneIndex: 0,
      approvedScenePlan: JSON.stringify(scenePlan),
      contentApprovedBy: userId,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
    });
    await this._dispatchHeavy(cleared, RenderStep.MontageAllSegments, () =>
      this._renderAllSceneSegments(cleared)
    );
    return this._getJob(jobId);
  }

  /**
   * Merge requester edits to the active scene's script + image selection (and
   * the shared hook/script/caption fields) into the approved scene plan.
   * Shared by the per-scene script gate and the post-video "edit & resubmit"
   * path so both persist edits identically.
   */
  private async _persistSceneEdits(
    jobId: string,
    edits: {
      scenePlan: string;
      hookThai?: string;
      scriptThai?: string;
      captionThai?: string;
    }
  ): Promise<void> {
    const scenePlan = sanitizeScenePlanDescriptions(
      JSON.parse(edits.scenePlan) as ScenePlan[]
    );
    await videoGenerationJobRepository.update(jobId, {
      approvedScenePlan: JSON.stringify(scenePlan),
      ...(edits.hookThai !== undefined ? { approvedHookThai: edits.hookThai } : {}),
      ...(edits.scriptThai !== undefined ? { approvedScriptThai: edits.scriptThai } : {}),
      ...(edits.captionThai !== undefined ? { approvedCaptionThai: edits.captionThai } : {}),
    });
  }

  /**
   * Re-derive scene `idx`'s still-image motion from its (edited) description so a
   * script change like "zoom out" is reflected on the next render. Honors the
   * script's intent over the previously baked motion; no-op when the description
   * names no camera move (the existing motion is kept). Clips stay static.
   */
  private async _reinferSceneMotion(jobId: string, idx: number): Promise<void> {
    const job = await this._getJob(jobId);
    let plan: ScenePlan[];
    try {
      plan = JSON.parse(job.approvedScenePlan ?? "[]") as ScenePlan[];
    } catch {
      return;
    }
    const scene = plan[idx];
    if (!scene?.assets || scene.assets.length === 0) return;

    const motion = inferMotionFromText(scene.visualDescriptionThai ?? scene.visualDescription);
    if (!motion) return;

    scene.assets = scene.assets.map((a) => (a.kind === "image" ? { ...a, motion } : a));
    await videoGenerationJobRepository.update(jobId, {
      approvedScenePlan: JSON.stringify(plan),
    });
  }

  /**
   * Per-scene script gate (requester-only). The requester reviews/edits the
   * active scene's script + asset selection, then approves — which renders that
   * scene's real-media montage segment.
   */
  async approveSceneScriptByRequester(
    jobId: string,
    userId: string,
    edits: {
      scenePlan: string;
      hookThai?: string;
      scriptThai?: string;
      captionThai?: string;
    }
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingSceneScriptApproval);
    await this._persistSceneEdits(jobId, edits);

    const job = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      contentApprovedBy: userId,
    });

    // Render this scene's segment in the background.
    const sceneIndex = job.currentSceneIndex ?? 0;
    await this._dispatchHeavy(
      job,
      RenderStep.MontageSceneSegment,
      () => this._renderSceneSegment(job, sceneIndex),
      { sceneIndex }
    );
    return this._getJob(jobId);
  }

  /**
   * Requester approves ALL scene videos at once ("Approve all"). Every scene's
   * segment is concatenated into the single `baseVideoAssetId` the downstream
   * pipeline consumes, then animation generation begins. (Individual scenes are
   * revised in place beforehand via `requestVideoRevisionByRequester`.)
   */
  async approveBaseVideoByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    // Guard the auto-grow minimum once more before merging: per-scene revisions
    // could have trimmed the montage below the voice length since scene-design
    // approval. (Legacy Veo jobs without `assets` are unaffected.)
    const approvedPlan = JSON.parse(job.approvedScenePlan ?? "[]") as ScenePlan[];
    if (approvedPlan.some((s) => Array.isArray(s.assets) && s.assets.length > 0)) {
      const totalSeconds = approvedPlan.reduce((sum, s) => sum + sceneMontageSeconds(s), 0);
      const minSeconds = minMontageTotalSeconds(job.voiceDurationSeconds ?? undefined);
      if (totalSeconds + 1e-6 < minSeconds) {
        throw new Error(
          `ความยาววิดีโอรวม (${Math.round(totalSeconds * 10) / 10} วินาที) ต้องอย่างน้อย ${Math.round(minSeconds * 10) / 10} วินาที เพื่อให้คลุมเสียงพากย์ทั้งหมด`
        );
      }
    }

    // Concatenate every approved scene segment into the single base video.
    let baseVideoAssetIdUpdate: { baseVideoAssetId: string } | Record<string, never> = {};
    try {
      baseVideoAssetIdUpdate = { baseVideoAssetId: await this._concatMontageBaseVideo(job) };
    } catch (err) {
      console.error("[Montage] Base video concatenation failed:", err);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

    // All scenes approved → kick off animation generation.
    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      videoApprovedBy: userId,
      ...baseVideoAssetIdUpdate,
    });

    await this._dispatchHeavy(updated, RenderStep.AnimationGeneration, () =>
      this._runAnimationGeneration(updated)
    );

    return this._getJob(jobId);
  }

  /**
   * Send the requester back from the combined scene-video review to the
   * scene-design step to edit the whole plan (assets, order, durations, scripts)
   * — not just one scene. The approved plan is kept so the scene-design panel
   * loads their current design; the rendered per-scene segments and base video
   * are cleared and will be re-rendered when they re-approve the (possibly
   * edited) scene design.
   */
  async reopenSceneDesignByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
      currentSceneIndex: 0,
      contentApprovedBy: userId,
      videoGenStatus: null,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
    });
  }

  /**
   * Requester edits ONE scene's script + assets and resubmits from the combined
   * review. Re-renders only that scene's montage segment in place; every other
   * scene's segment is left untouched. `sceneIndex` selects the scene (defaults
   * to the job's currentSceneIndex for legacy callers).
   */
  async requestVideoRevisionByRequester(
    jobId: string,
    userId: string,
    edits: {
      scenePlan: string;
      hookThai?: string;
      scriptThai?: string;
      captionThai?: string;
    },
    sceneIndex?: number
  ): Promise<VideoGenerationJob> {
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);
    await this._persistSceneEdits(jobId, edits);

    const idx = Number.isInteger(sceneIndex) ? (sceneIndex as number) : job.currentSceneIndex ?? 0;
    // Re-derive the camera move from the (edited) scene description so editing the
    // script and re-rendering updates the motion to match the script's intent.
    await this._reinferSceneMotion(jobId, idx);

    // Keep ALL existing segments; only scene `idx` is replaced when it re-renders.
    const prepared = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      currentSceneIndex: idx,
      videoGenStatus: null,
      contentApprovedBy: userId,
    });
    await this._dispatchHeavy(
      prepared,
      RenderStep.MontageSceneSegment,
      () => this._renderSceneSegment(prepared, idx),
      { sceneIndex: idx }
    );
    return this._getJob(jobId);
  }

  /** Staff rejects the voice and triggers re-generation with iAppTTS. */
  async rejectVoiceConversion(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);
    return this.regenerateVoice(jobId, staffId);
  }

  /** Requester rejects the voice and triggers re-generation with iAppTTS. */
  async rejectVoiceConversionByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);
    return this.regenerateVoice(jobId, userId);
  }

  /** Requester reviews and approves the final composed videos, delivering the request. */
  async approveFinalVideoByRequester(
    jobId: string,
    userId: string,
    subtitleLanguages?: ("th" | "en" | "zh")[],
    selectedMotionTemplate?: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingFinalApproval);

    // Phase 7: approving the merged voice+music video no longer delivers the
    // request. Instead, the requester's chosen subtitle languages + motion
    // template are persisted and the styled/subtitle render begins (primary
    // ratio first). Delivery happens once that is approved.
    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingOverlay,
      ...(subtitleLanguages && subtitleLanguages.length > 0 ? { subtitleLanguages } : {}),
      ...(selectedMotionTemplate ? { selectedMotionTemplate } : {}),
    });

    await this._dispatchHeavy(updated, RenderStep.OverlayComposition, () =>
      this._runOverlayComposition(updated)
    );

    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 7 — subtitle + motion-graphic overlay step
  //
  // After the merged voice+music master is approved, a transparent Remotion
  // overlay (captions in the selected languages + motion graphics) is rendered
  // and composited ON TOP of the per-ratio masters (never baked into them). The
  // primary ratio is produced first for review; the remaining channel ratios are
  // generated on an explicit button; then the Travy EN+ZH clip is rendered
  // automatically in the background. The masters in finalExport_* are left clean
  // so every overlay render (incl. re-renders and Travy) starts from them.
  // ──────────────────────────────────────────────────────────────────────────

  /** Distribution ratios for the requester's own channels (excludes Travy). */
  private _userRatios(platforms: Platform[]): VideoRatio[] {
    const nonTravy = platforms.filter((p) => p !== Platform.TventApp);
    return ffmpegService.getRequiredRatiosForPlatforms(
      nonTravy.length > 0 ? nonTravy : platforms
    );
  }

  private _masterAssetIdForRatio(job: VideoGenerationJob, ratio: VideoRatio): string | null {
    switch (ratio) {
      case "9:16": return job.finalExport_9_16_assetId;
      case "16:9": return job.finalExport_16_9_assetId;
      case "1:1": return job.finalExport_1_1_assetId;
      case "4:5": return job.finalExport_4_5_assetId;
      default: return null;
    }
  }

  private _captionedAssetIdForRatio(job: VideoGenerationJob, ratio: VideoRatio): string | null {
    switch (ratio) {
      case "9:16": return job.captionedExport_9_16_assetId ?? null;
      case "16:9": return job.captionedExport_16_9_assetId ?? null;
      case "1:1": return job.captionedExport_1_1_assetId ?? null;
      case "4:5": return job.captionedExport_4_5_assetId ?? null;
      default: return null;
    }
  }

  /** True when the subtitle languages are exactly {en, zh} (order-insensitive). */
  private _isEnZhOnly(languages: ("th" | "en" | "zh")[] | null | undefined): boolean {
    const set = new Set(languages ?? []);
    return set.size === 2 && set.has("en") && set.has("zh");
  }

  private _captionedFieldForRatio(ratio: VideoRatio): keyof UpdateVideoGenerationJobInput {
    switch (ratio) {
      case "9:16": return "captionedExport_9_16_assetId";
      case "16:9": return "captionedExport_16_9_assetId";
      case "1:1": return "captionedExport_1_1_assetId";
      case "4:5": return "captionedExport_4_5_assetId";
      default: return "captionedExport_9_16_assetId";
    }
  }

  private _parseTimeline(job: VideoGenerationJob): TimedSegment[] {
    const raw = job.subtitleTimeline ?? job.voiceTimestamps;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TimedSegment[]) : [];
    } catch {
      return [];
    }
  }

  private _parseScenePlanForOverlay(job: VideoGenerationJob): ScenePlan[] {
    const raw = job.approvedScenePlan ?? job.scenePlan;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ScenePlan[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Build the overlay timing inputs ONCE per render batch: generate the motion
   * graphic specs (Claude) from the voice-time timeline, then shift BOTH the
   * caption timeline and the specs by the music lead-in, because the merged
   * master opens with a music-only lead-in (the voice is adelay'd) — so captions
   * and graphics must start later to stay synced. The overlay duration is
   * extended by the same lead-in to cover the whole master.
   */
  private async _buildOverlayInputs(job: VideoGenerationJob): Promise<{
    timeline: TimedSegment[];
    durationSeconds: number;
    palette: Palette;
  }> {
    const leadIn = ffmpegService.MUSIC_LEAD_IN_SECONDS;
    const voiceDur = job.voiceDurationSeconds ?? ffmpegService.DEFAULT_COMPOSE_DURATION_SECONDS;
    const rawTimeline = this._parseTimeline(job);

    // Palette for the template decor/accents, derived from profile + script.
    const palette = await this._deriveOverlayPalette(job);

    // Break long sentences into short display cues BEFORE shifting/rendering, so
    // captions don't wrap into many lines and overlap the stacked language above.
    const languages =
      job.subtitleLanguages && job.subtitleLanguages.length > 0
        ? job.subtitleLanguages
        : (["en", "zh"] as ("th" | "en" | "zh")[]);
    const { splitSegmentsForDisplay } = await import("@/lib/ai/geminiSubtitlesService");
    const displayTimeline = splitSegmentsForDisplay(rawTimeline, languages);

    // The master opens with a music-only lead-in (the voice is adelay'd), so
    // shift the caption timeline by the lead-in to stay synced with speech, and
    // extend the render duration to cover the whole master.
    const timeline = displayTimeline.map((s) => ({
      ...s,
      startSecond: s.startSecond + leadIn,
      endSecond: s.endSecond + leadIn,
    }));

    return { timeline, durationSeconds: voiceDur + leadIn, palette };
  }

  /** Derive the decorative palette from the business profile + approved script. */
  private async _deriveOverlayPalette(job: VideoGenerationJob): Promise<Palette> {
    try {
      const { clipRequestRepository } = await import("@/repositories/index");
      const { businessProfileService } = await import("@/services/BusinessProfileService");
      const req = await clipRequestRepository.findById(job.requestId);
      const profile = req ? await businessProfileService.getProfile(req.userId) : null;
      return await derivePalette({
        businessName: profile?.businessName,
        category: profile?.category,
        scriptEnglish: job.approvedScriptEnglish ?? job.scriptEnglish,
        scriptThai: job.approvedScriptThai ?? job.scriptThai,
      });
    } catch (err) {
      console.error("[overlay] palette derivation failed, using default:", err);
      return (await import("@/lib/ai/paletteService")).DEFAULT_PALETTE;
    }
  }

  /**
   * Render the transparent overlay for ONE ratio and composite it onto that
   * ratio's clean master, returning the new captioned FinalClip asset id. Reused
   * for the requester's channels (their selected languages) and for the Travy
   * EN+ZH render. The master is never modified.
   */
  private async _renderCaptionedRatio(
    job: VideoGenerationJob,
    userId: string,
    ratio: VideoRatio,
    languages: ("th" | "en" | "zh")[],
    inputs: Awaited<ReturnType<VideoGenerationService["_buildOverlayInputs"]>>
  ): Promise<string> {
    const masterAssetId = this._masterAssetIdForRatio(job, ratio);
    if (!masterAssetId) throw new Error(`No merged master export for ratio ${ratio}`);
    const master = await uploadedAssetRepository.findById(masterAssetId);
    if (!master) throw new Error(`Master asset not found: ${masterAssetId}`);

    // The captioned render must run for the FULL merged-master length, not just
    // the voice window — otherwise the styled clip is shorter than the master the
    // requester approved (the Remotion composition frame count is duration*FPS,
    // so a short duration truncates the master playing inside it). Probe the
    // master's real duration and render for at least that long.
    let masterDuration = 0;
    try {
      masterDuration = await probeAudioDurationSeconds(master.storageKey);
    } catch (err) {
      console.error("[overlay] failed to probe master duration, using timeline length:", err);
    }
    const renderDuration = Math.max(inputs.durationSeconds, masterDuration);

    // Single-pass styled render: the master plays inside the Remotion template
    // (audio carried through), template frame/decor + subtitles on top, output
    // as one opaque MP4 — no alpha compositing.
    const outputKey = buildFinalClipKey(userId, job.requestId, ratio);
    const result = await remotionService.renderTemplatedVideo({
      masterUrl: master.storageUrl,
      ratio,
      durationSeconds: renderDuration,
      templateId: job.selectedMotionTemplate ?? "none",
      palette: inputs.palette,
      subtitleTimeline: inputs.timeline,
      subtitleLanguages: languages.length > 0 ? languages : ["en", "zh"],
      outputStorageKey: outputKey,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);
    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId,
      fileName: `styled_${ratio.replace(":", "-")}.mp4`,
      assetType: AssetType.FinalClip,
      fileSizeBytes: result.fileSizeBytes,
      mimeType: "video/mp4",
      storageKey: result.storageKey,
      storageUrl: result.storageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
      videoRatio: ratio,
    });
    return asset.id;
  }

  /** Background: render the PRIMARY ratio captioned preview, then await review. */
  private async _runOverlayComposition(job: VideoGenerationJob): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const platforms = request.targetPlatforms ?? [];
    const primaryRatio = this._montageCanvasRatio(platforms[0] ?? Platform.TventApp);
    const languages =
      job.subtitleLanguages && job.subtitleLanguages.length > 0
        ? job.subtitleLanguages
        : (["en", "zh"] as ("th" | "en" | "zh")[]);

    const inputs = await this._buildOverlayInputs(job);
    const captionedId = await this._renderCaptionedRatio(
      job,
      request.userId,
      primaryRatio,
      languages,
      inputs
    );

    const updates: UpdateVideoGenerationJobInput = {
      currentStep: VideoGenerationStep.AwaitingOverlayApproval,
    };
    updates[this._captionedFieldForRatio(primaryRatio)] = captionedId;
    await videoGenerationJobRepository.update(job.id, updates);
  }

  /** Requester re-renders the overlay (optionally changing subtitle languages). */
  async regenerateOverlayByRequester(
    jobId: string,
    _userId: string,
    subtitleLanguages?: ("th" | "en" | "zh")[]
  ): Promise<VideoGenerationJob> {
    void _userId;
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingOverlayApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingOverlay,
      ...(subtitleLanguages && subtitleLanguages.length > 0 ? { subtitleLanguages } : {}),
    });

    await this._dispatchHeavy(updated, RenderStep.OverlayComposition, () =>
      this._runOverlayComposition(updated)
    );

    return updated;
  }

  /**
   * Requester wants to CHANGE the template / subtitle languages: go back from
   * the styled-video review to the merged-review (template + language) step and
   * clear the generated styled clips, so re-approving re-renders with the new
   * choices. Masters are kept.
   */
  async editSubtitleVideoByRequester(
    jobId: string,
    _userId: string
  ): Promise<VideoGenerationJob> {
    void _userId;
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingOverlayApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingFinalApproval,
      captionedExport_9_16_assetId: null,
      captionedExport_16_9_assetId: null,
      captionedExport_1_1_assetId: null,
      captionedExport_4_5_assetId: null,
    });
  }

  /**
   * Requester approves the subtitle + motion-graphic overlay. The previewed
   * primary-ratio captioned clip becomes the delivered video. If more channel
   * ratios remain, the job gates on AwaitingAdditionalRatios (an explicit
   * generate button); otherwise it finalizes and the Travy render begins.
   */
  async approveOverlayByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingOverlayApproval);
    const job = await this._getJob(jobId);

    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    const platforms = request?.targetPlatforms ?? [];
    const primaryRatio = this._montageCanvasRatio(platforms[0] ?? Platform.TventApp);
    const remaining = this._userRatios(platforms).filter((r) => r !== primaryRatio);

    if (remaining.length > 0) {
      // More channel formats to produce — wait for the explicit button.
      return videoGenerationJobRepository.update(jobId, {
        currentStep: VideoGenerationStep.AwaitingAdditionalRatios,
        finalApprovedBy: userId,
      });
    }

    return this._finalizeAndStartTvent(job, userId);
  }

  /** Requester triggers generation of the remaining channels' aspect ratios. */
  async generateAdditionalRatiosByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingAdditionalRatios);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAdditionalRatios,
      ...(userId ? { finalApprovedBy: userId } : {}),
    });

    await this._dispatchHeavy(updated, RenderStep.AdditionalRatios, () =>
      this._runAdditionalRatiosOverlay(updated)
    );

    return updated;
  }

  /** Background: render captioned clips for every remaining ratio, then Travy. */
  private async _runAdditionalRatiosOverlay(job: VideoGenerationJob): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const platforms = request.targetPlatforms ?? [];
    const primaryRatio = this._montageCanvasRatio(platforms[0] ?? Platform.TventApp);
    const remaining = this._userRatios(platforms).filter((r) => r !== primaryRatio);
    const languages =
      job.subtitleLanguages && job.subtitleLanguages.length > 0
        ? job.subtitleLanguages
        : (["en", "zh"] as ("th" | "en" | "zh")[]);

    const inputs = await this._buildOverlayInputs(job);
    const updates: UpdateVideoGenerationJobInput = {};
    for (const ratio of remaining) {
      const id = await this._renderCaptionedRatio(job, request.userId, ratio, languages, inputs);
      updates[this._captionedFieldForRatio(ratio)] = id;
    }
    if (Object.keys(updates).length > 0) {
      await videoGenerationJobRepository.update(job.id, updates);
    }

    const refreshed = await this._getJob(job.id);
    await this._finalizeAndStartTvent(refreshed, refreshed.finalApprovedBy ?? "");
  }

  /**
   * Phase 8: land the job on the DISTRIBUTION-REVIEW step (NOT Complete). The
   * captioned videos for every selected channel are ready, so this:
   *   1. auto-fills a per-channel publishing draft (title/caption/hashtags) via
   *      Gemini, tailored to each channel's fields;
   *   2. starts the automatic Travy (EN+ZH) render in the BACKGROUND — UNLESS
   *      the requester's subtitle languages are exactly {en, zh}, in which case
   *      the primary captioned export IS already an EN+ZH clip at the Travy
   *      (= primary) ratio and is REUSED as the Travy export immediately (no
   *      duplicate render). Leaving the page never stops the render.
   * The request is NOT marked Delivered here — that happens only when the
   * requester confirms publishing (`confirmPublishingByRequester`).
   */
  private async _finalizeAndStartTvent(
    job: VideoGenerationJob,
    userId: string
  ): Promise<VideoGenerationJob> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    const platforms = request?.targetPlatforms ?? [];
    const needsTvent = platforms.includes(Platform.TventApp);
    const primaryRatio = this._montageCanvasRatio(platforms[0] ?? Platform.TventApp);

    // Editing is complete and publishing is queued — mark the REQUEST accordingly
    // so it stays under "in progress" (ScheduledForPublishing is an active status)
    // and is NOT shown as Delivered until the requester confirms publishing.
    const { RequestStatus } = await import("@/domain/enums/RequestStatus");
    await clipRequestRepository.updateStatus(job.requestId, RequestStatus.ScheduledForPublishing);

    // Auto-fill per-channel publishing drafts (Gemini; fail-open to the caption).
    const publishingDrafts = await this._generatePublishingDrafts(job, platforms);

    // Travy EN+ZH reuse: when the requester's own subtitle languages are exactly
    // {en, zh}, the primary captioned export already matches what the Travy clip
    // would be (EN+ZH at the primary ratio, which Travy uses) — reuse it instead
    // of rendering a duplicate. Otherwise render Travy separately in background.
    const captionedPrimaryId = this._captionedAssetIdForRatio(job, primaryRatio);
    const canReuseForTvent =
      needsTvent && this._isEnZhOnly(job.subtitleLanguages) && !!captionedPrimaryId;

    const updates: UpdateVideoGenerationJobInput = {
      currentStep: VideoGenerationStep.AwaitingDistributionReview,
      finalApprovedBy: userId || job.finalApprovedBy,
      publishingDrafts,
    };
    if (needsTvent) {
      if (canReuseForTvent) {
        updates.finalExport_tvent_assetId = captionedPrimaryId;
        updates.tventVideoStatus = "ready";
      } else {
        updates.tventVideoStatus = "generating";
      }
    }

    const updated = await videoGenerationJobRepository.update(job.id, updates);

    if (needsTvent && !canReuseForTvent) {
      this._runTventVideoGeneration(updated).catch(async (err) => {
        console.error("[TventVideoGeneration] failed:", err);
        await videoGenerationJobRepository.update(job.id, { tventVideoStatus: "failed" });
      });
    }

    return updated;
  }

  /** Background: render the Travy EN+ZH captioned clip onto the primary master. */
  private async _runTventVideoGeneration(job: VideoGenerationJob): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const platforms = request.targetPlatforms ?? [];
    const primaryRatio = this._montageCanvasRatio(platforms[0] ?? Platform.TventApp);

    const inputs = await this._buildOverlayInputs(job);
    const tventAssetId = await this._renderCaptionedRatio(
      job,
      request.userId,
      primaryRatio,
      ["en", "zh"],
      inputs
    );

    await videoGenerationJobRepository.update(job.id, {
      finalExport_tvent_assetId: tventAssetId,
      tventVideoStatus: "ready",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 8 — distribution review + publishing
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Auto-fill a per-channel publishing draft (title/caption/hashtags, tailored
   * to each channel's fields — see `src/config/publishFields.ts`) from the
   * approved script + business profile via Gemini. Fail-open: on any Gemini
   * error it falls back to the approved caption/script. Excludes Travy
   * (background-only) and CDN (internal). Preserves any prior draft the
   * requester already posted/edited, so a re-finalize is idempotent.
   */
  private async _generatePublishingDrafts(
    job: VideoGenerationJob,
    platforms: Platform[]
  ): Promise<ChannelPublishingDraft[]> {
    const channels = platforms.filter((p) => isPublishablePlatform(p));
    if (channels.length === 0) return job.publishingDrafts ?? [];

    const existing = new Map((job.publishingDrafts ?? []).map((d) => [d.platform, d]));

    const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
    const scriptEnglish = job.approvedScriptEnglish ?? job.scriptEnglish ?? "";
    const captionThai = job.approvedCaptionThai ?? job.captionThai ?? "";

    let businessName = "";
    let category = "";
    try {
      const { clipRequestRepository } = await import("@/repositories/index");
      const { businessProfileService } = await import("@/services/BusinessProfileService");
      const req = await clipRequestRepository.findById(job.requestId);
      const profile = req ? await businessProfileService.getProfile(req.userId) : null;
      businessName = profile?.businessName ?? "";
      category = profile?.category ?? "";
    } catch {
      /* fail-open — drafts still get a caption/script fallback below */
    }

    // Tailored copy per channel via Gemini (fail-open to fallback below).
    let generated: Record<string, { title?: string; caption?: string; hashtags?: string[] }> = {};
    try {
      const { requireGeminiApiKey, AI_CONFIG } = await import("@/config/aiTools");
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
      const channelSpec = channels
        .map((p) => {
          const cfg = getPublishFieldConfig(p);
          return `- ${p}: ${cfg.hasTitle ? "title, " : ""}caption, hashtags`;
        })
        .join("\n");
      const res = await ai.models.generateContent({
        model: AI_CONFIG.gemini.textModel,
        contents: `You are a social media marketer for a local business${
          businessName ? ` called "${businessName}"` : ""
        }${category ? ` (${category})` : ""}.
Write short, engaging promotional copy in Thai for a short promo video, tailored to EACH channel below.
Video Thai script: "${scriptThai}"
English gist: "${scriptEnglish}"
Existing Thai caption idea: "${captionThai}"

Channels and their fields:
${channelSpec}

Rules:
- YouTube "title": <= 70 chars, catchy. Channels without a title should return an empty "title".
- "caption": platform-appropriate length (TikTok/Instagram short & punchy; Facebook slightly longer; YouTube = a description with a short call to action).
- "hashtags": 4-8 relevant hashtags WITHOUT the leading '#', mixing Thai + English where natural.
Return ONLY valid JSON: an object keyed by the channel id, each value { "title": "", "caption": "", "hashtags": [] }.`,
        config: { responseMimeType: "application/json", temperature: 0.7 },
      });
      const parsed = JSON.parse(res.text ?? "{}");
      if (parsed && typeof parsed === "object") generated = parsed;
    } catch (err) {
      console.error("[publishingDrafts] Gemini draft generation failed, using fallback:", err);
    }

    const fallbackHashtags = [businessName, category]
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, ""))
      .filter(Boolean);

    return channels.map((platform) => {
      const prior = existing.get(platform);
      // Never overwrite a channel that already posted successfully.
      if (prior && prior.status === "posted") return prior;

      const g = generated[platform] ?? {};
      const cfg = getPublishFieldConfig(platform);
      const genHashtags = Array.isArray(g.hashtags)
        ? g.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean)
        : [];
      return {
        platform,
        title: cfg.hasTitle ? (prior?.title || g.title || businessName || "").slice(0, 100) : "",
        caption: prior?.caption || g.caption || captionThai || scriptThai,
        hashtags:
          prior?.hashtags && prior.hashtags.length > 0
            ? prior.hashtags
            : genHashtags.length > 0
              ? genHashtags
              : fallbackHashtags,
        status: prior?.status ?? "pending",
        url: prior?.url ?? null,
        error: prior?.error ?? null,
      };
    });
  }

  /** Persist edited publishing drafts on the review step (no posting). */
  async savePublishingDraftsByRequester(
    jobId: string,
    _userId: string,
    drafts: ChannelPublishingDraft[]
  ): Promise<VideoGenerationJob> {
    void _userId;
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingDistributionReview);
    const job = await this._getJob(jobId);
    const stored = new Map((job.publishingDrafts ?? []).map((d) => [d.platform, d]));
    const merged: ChannelPublishingDraft[] = drafts.map((d) => {
      const prior = stored.get(d.platform);
      return {
        platform: d.platform,
        title: d.title ?? prior?.title ?? "",
        caption: d.caption ?? prior?.caption ?? "",
        hashtags: Array.isArray(d.hashtags) ? d.hashtags : prior?.hashtags ?? [],
        // Editing copy never changes a channel's posting outcome.
        status: prior?.status ?? "pending",
        url: prior?.url ?? null,
        error: prior?.error ?? null,
      };
    });
    return videoGenerationJobRepository.update(jobId, { publishingDrafts: merged });
  }

  /**
   * Requester confirms publishing on the distribution-review step. Posts each
   * not-yet-posted channel to its social platform using that channel's captioned
   * export (matching the channel's aspect ratio — NO fallback: a missing export
   * is surfaced as an error so the requester can regenerate that ratio). Records
   * a PublishingLink per success and persists per-channel status/url/error on the
   * drafts.
   *
   * Only when EVERY channel is "posted" does the request advance to Complete +
   * Delivered. Any failure keeps the job on AwaitingDistributionReview with the
   * error causes recorded, so the requester can fix them (e.g. missing API keys)
   * and click resubmit — already-posted channels are SKIPPED so they are never
   * double-posted.
   */
  async confirmPublishingByRequester(
    jobId: string,
    userId: string,
    editedDrafts?: ChannelPublishingDraft[]
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingDistributionReview);
    const job = await this._getJob(jobId);

    const { clipRequestRepository, publishingLinkRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    // Merge any edits over the stored drafts (edited copy wins; posted channels
    // keep their prior status/url so they are not retried/double-posted).
    const stored = new Map((job.publishingDrafts ?? []).map((d) => [d.platform, d]));
    const source =
      editedDrafts && editedDrafts.length > 0 ? editedDrafts : job.publishingDrafts ?? [];
    const drafts: ChannelPublishingDraft[] = source.map((d) => {
      const prior = stored.get(d.platform);
      const alreadyPosted = prior?.status === "posted";
      return {
        platform: d.platform,
        title: d.title ?? prior?.title ?? "",
        caption: d.caption ?? prior?.caption ?? "",
        hashtags: Array.isArray(d.hashtags) ? d.hashtags : prior?.hashtags ?? [],
        status: alreadyPosted ? "posted" : "pending",
        url: alreadyPosted ? prior?.url ?? null : null,
        error: null,
      };
    });

    // Post each not-yet-posted channel; collect per-channel outcomes.
    const results: ChannelPublishingDraft[] = [];
    for (const draft of drafts) {
      if (draft.status === "posted") {
        results.push(draft);
        continue;
      }
      const platform = draft.platform as Platform;
      try {
        const url = await this._postToChannel(job, platform, draft);
        await publishingLinkRepository.create({
          requestId: job.requestId,
          platform,
          url,
          publishedAt: new Date(),
        });
        results.push({ ...draft, status: "posted", url, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Publishing failed";
        console.error(`[publishing] ${platform} failed:`, message);
        results.push({ ...draft, status: "failed", url: null, error: message });
      }
    }

    const allPosted = results.length > 0 && results.every((d) => d.status === "posted");

    if (!allPosted) {
      // Stay on the review step with per-channel error causes for the requester
      // to fix before resubmitting.
      return videoGenerationJobRepository.update(jobId, { publishingDrafts: results });
    }

    // Every channel posted — mark delivered + complete.
    const { RequestStatus } = await import("@/domain/enums/RequestStatus");
    await clipRequestRepository.updateStatus(job.requestId, RequestStatus.Delivered);
    return videoGenerationJobRepository.update(jobId, {
      publishingDrafts: results,
      currentStep: VideoGenerationStep.Complete,
      finalApprovedBy: userId || job.finalApprovedBy,
    });
  }

  /**
   * Phase 8 — moderate + publish a SINGLE distribution channel.
   *
   * Each channel is published on its own from the distribution-review step. The
   * flow is: (1) Gemini screens this channel's caption/title/hashtags together
   * with a few sampled frames of the exact captioned export that would be posted
   * (see `contentModerationService`); (2) if the moderator REJECTS the content,
   * nothing is posted and no job state changes — the caller shows the rejection
   * reason and the requester is NOT allowed to edit-and-retry that channel;
   * (3) if approved, only this one channel is posted, its draft is merged back
   * into the stored drafts, and the request is marked Complete/Delivered only
   * once every publishable channel has been posted.
   */
  async moderateAndPublishChannel(
    jobId: string,
    userId: string,
    platform: Platform,
    editedDraft?: Partial<ChannelPublishingDraft>
  ): Promise<{
    approved: boolean;
    reason?: string | null;
    violations?: string[];
    currentStep?: VideoGenerationStep;
    publishingDrafts?: ChannelPublishingDraft[];
  }> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingDistributionReview);
    const job = await this._getJob(jobId);

    const { clipRequestRepository, publishingLinkRepository } = await import(
      "@/repositories/index"
    );
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const stored = job.publishingDrafts ?? [];
    const prior = stored.find((d) => d.platform === platform);
    if (!prior) {
      throw new Error(`ไม่พบข้อมูลการเผยแพร่สำหรับช่องทาง ${platform}`);
    }
    // Already posted → idempotent no-op (return current state).
    if (prior.status === "posted") {
      return {
        approved: true,
        currentStep: job.currentStep,
        publishingDrafts: stored,
      };
    }

    // The exact captioned export this channel would post — moderate ITS frames.
    const ratio = this._montageCanvasRatio(platform);
    const assetId = this._captionedAssetIdForRatio(job, ratio);
    const asset = assetId ? await uploadedAssetRepository.findById(assetId) : null;

    const draft: ChannelPublishingDraft = {
      platform,
      title: editedDraft?.title ?? prior.title ?? "",
      caption: editedDraft?.caption ?? prior.caption ?? "",
      hashtags: Array.isArray(editedDraft?.hashtags)
        ? (editedDraft!.hashtags as string[])
        : prior.hashtags ?? [],
      status: "pending",
      url: null,
      error: null,
    };

    // (1) Gemini content-safety gate.
    const { moderatePublishingContent } = await import(
      "@/lib/ai/contentModerationService"
    );
    const { PLATFORM_LABELS } = await import("@/domain/enums/Platform");
    const moderation = await moderatePublishingContent({
      videoStorageKey: asset?.storageKey ?? null,
      platformLabel: PLATFORM_LABELS[platform] ?? String(platform),
      title: draft.title,
      caption: draft.caption,
      hashtags: draft.hashtags,
    });

    // (2) Rejected → block. No posting, no state change, no correction allowed.
    if (!moderation.approved) {
      return {
        approved: false,
        reason: moderation.reason,
        violations: moderation.violations,
      };
    }

    // (3) Approved → post just this channel and merge the result back.
    let posted: ChannelPublishingDraft;
    try {
      const url = await this._postToChannel(job, platform, draft);
      await publishingLinkRepository.create({
        requestId: job.requestId,
        platform,
        url,
        publishedAt: new Date(),
      });
      posted = { ...draft, status: "posted", url, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publishing failed";
      console.error(`[publishing] ${platform} failed:`, message);
      posted = { ...draft, status: "failed", url: null, error: message };
    }

    const mergedDrafts = stored.map((d) => (d.platform === platform ? posted : d));

    // Complete the request only once every publishable channel has been posted.
    const publishableDrafts = mergedDrafts.filter((d) =>
      isPublishablePlatform(d.platform as Platform)
    );
    const allPosted =
      publishableDrafts.length > 0 &&
      publishableDrafts.every((d) => d.status === "posted");

    if (!allPosted) {
      const updated = await videoGenerationJobRepository.update(jobId, {
        publishingDrafts: mergedDrafts,
      });
      return {
        approved: true,
        currentStep: updated.currentStep,
        publishingDrafts: updated.publishingDrafts ?? mergedDrafts,
      };
    }

    const { RequestStatus } = await import("@/domain/enums/RequestStatus");
    await clipRequestRepository.updateStatus(job.requestId, RequestStatus.Delivered);
    const updated = await videoGenerationJobRepository.update(jobId, {
      publishingDrafts: mergedDrafts,
      currentStep: VideoGenerationStep.Complete,
      finalApprovedBy: userId || job.finalApprovedBy,
    });
    return {
      approved: true,
      currentStep: updated.currentStep,
      publishingDrafts: updated.publishingDrafts ?? mergedDrafts,
    };
  }

  /**
   * Post ONE channel's captioned export to its social platform. Uses the
   * channel's ratio-matching captioned export (NO fallback — a missing export
   * throws so the requester can generate that ratio first). Returns the public
   * post URL. Social credentials come from `AI_CONFIG.social` (dummy/blank keys
   * simply make the platform API call fail, which is surfaced to the requester).
   */
  private async _postToChannel(
    job: VideoGenerationJob,
    platform: Platform,
    draft: ChannelPublishingDraft
  ): Promise<string> {
    const ratio = this._montageCanvasRatio(platform);
    const assetId = this._captionedAssetIdForRatio(job, ratio);
    if (!assetId) {
      throw new Error(
        `ยังไม่มีวิดีโอสัดส่วน ${ratio} สำหรับช่องทางนี้ — กรุณาสร้างอัตราส่วนให้ครบก่อนเผยแพร่`
      );
    }
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error(`Captioned export asset not found: ${assetId}`);

    const hashtagLine = (draft.hashtags ?? []).map((h) => `#${h}`).join(" ");
    const caption = [draft.caption, hashtagLine].filter(Boolean).join("\n\n");
    const title = draft.title || (draft.caption ?? "").slice(0, 70) || "Promo";

    switch (platform) {
      case Platform.TikTok: {
        const tiktok = await import("@/lib/social/tiktokService");
        const r = await tiktok.uploadVideo({
          videoStorageKey: asset.storageKey,
          title,
          description: caption,
        });
        return r.platformUrl;
      }
      case Platform.YouTube: {
        const youtube = await import("@/lib/social/youtubeService");
        const r = await youtube.uploadVideo({
          videoStorageKey: asset.storageKey,
          title,
          description: caption,
        });
        return r.platformUrl;
      }
      case Platform.Facebook: {
        const facebook = await import("@/lib/social/facebookService");
        const r = await facebook.uploadVideo({
          videoStorageKey: asset.storageKey,
          description: caption,
        });
        return r.platformUrl;
      }
      case Platform.Instagram: {
        const instagram = await import("@/lib/social/instagramService");
        const r = await instagram.uploadVideo({
          videoStorageKey: asset.storageKey,
          caption,
        });
        return r.platformUrl;
      }
      default:
        throw new Error(`Publishing not supported for channel: ${platform}`);
    }
  }

  private async _runFFmpegComposition(job: VideoGenerationJob): Promise<void> {
    // Phase 4: the latest cumulative base video is composited per-ratio with
    // that ratio's Remotion overlay clip (animatedOverlayAssetIds) below —
    // `animatedVideoAssetId` is just the AwaitingAnimationApproval preview
    // and is not used as a source for the final exports.
    const videoAssetId = job.baseVideoAssetId;
    const [videoAsset, audioAsset] = await Promise.all([
      uploadedAssetRepository.findById(videoAssetId!),
      uploadedAssetRepository.findById(job.processedVoiceAssetId!),
    ]);
    if (!videoAsset || !audioAsset) throw new Error("Required assets missing for composition");

    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const platforms = request.targetPlatforms ?? [];
    const targetRatios = ffmpegService.getRequiredRatiosForPlatforms(platforms);

    // This step produces the un-captioned merged MASTERS only (cropped base
    // video + voice + ducked music) for every required ratio. Subtitles and the
    // motion-graphic overlay are added in the Phase-7 overlay step on top of
    // these masters, and the Travy EN+ZH clip is rendered there too — so no
    // captions, no overlay, and NO Travy export are produced here.
    //
    // Per the Phase-7 directive, the Gemini `detectProductCoordinates`
    // smart-crop ("auto product positioning") has been REMOVED from the path —
    // ratios are center-cropped (coordinates left undefined).
    const overlayStorageKeys: Partial<Record<ffmpegService.VideoRatio, string>> = {};
    const coords: ImageCoordinates | undefined = undefined;

    const result = await ffmpegService.composeAndExport({
      videoStorageKey: videoAsset.storageKey,
      audioStorageKey: audioAsset.storageKey,
      scriptThai: job.approvedScriptThai!,
      scriptEnglish: job.approvedScriptEnglish ?? job.scriptEnglish ?? "",
      hookThai: job.approvedHookThai!,
      userId: request.userId,
      requestId: job.requestId,
      musicTrackId: job.selectedMusicTrack ?? undefined,
      coordinates: coords,
      targetRatios,
      overlayStorageKeys,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const assetIds: Record<string, string> = {};

    for (const ratio of targetRatios) {
      const exportInfo = result.exports[ratio];
      if (!exportInfo) continue;

      const asset = await uploadedAssetRepository.create({
        requestId: job.requestId,
        userId: request.userId,
        fileName: `final_${ratio.replace(":", "-")}.mp4`,
        assetType: AssetType.FinalClip,
        fileSizeBytes: 0,
        mimeType: "video/mp4",
        storageKey: exportInfo.storageKey,
        storageUrl: exportInfo.storageUrl,
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt,
        videoRatio: ratio,
      });
      assetIds[ratio] = asset.id;
    }

    // The Travy (Tvent) export is NO LONGER produced here — it is rendered with
    // its EN+ZH overlay automatically in the Phase-7 background step after the
    // overlay is approved (`_runTventVideoGeneration`). Leave it null for now.
    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingFinalApproval,
      finalExport_9_16_assetId: assetIds["9:16"] ?? null,
      finalExport_16_9_assetId: assetIds["16:9"] ?? null,
      finalExport_1_1_assetId: assetIds["1:1"] ?? null,
      finalExport_4_5_assetId: assetIds["4:5"] ?? null,
      finalExport_tvent_assetId: null,
    });
  }

  /** Staff approves all final exports and advances to publishing. */
  async approveFinalVideo(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingFinalApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.Publishing,
      finalApprovedBy: staffId,
    });
  }

  /**
   * Requester wants to redo the audio merge: from the merged-video review
   * (AwaitingFinalApproval) go back to the music/voice-merge step
   * (AwaitingAnimationApproval) to pick a different track and re-compose. The
   * stale final exports are cleared — they'll be regenerated on re-approval.
   */
  async reviseAudioMergeByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    void userId; // retained for caller-identity parity; not yet persisted
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingFinalApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingAnimationApproval,
      finalExport_9_16_assetId: null,
      finalExport_16_9_assetId: null,
      finalExport_1_1_assetId: null,
      finalExport_4_5_assetId: null,
      finalExport_tvent_assetId: null,
    });
  }

  /**
   * Staff rejects the final exports and goes back to a specified step.
   */
  async rejectFinalVideo(
    jobId: string,
    staffId: string,
    backToStep: "video" | "voice" | "composition"
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingFinalApproval);

    const stepMap = {
      video: VideoGenerationStep.AwaitingVideoApproval,
      voice: VideoGenerationStep.AwaitingVoiceApproval,
      composition: VideoGenerationStep.ComposingFinalVideo,
    };

    return videoGenerationJobRepository.update(jobId, {
      currentStep: stepMap[backToStep],
      finalExport_9_16_assetId: backToStep === "composition" ? null : undefined,
      finalExport_16_9_assetId: backToStep === "composition" ? null : undefined,
      finalExport_1_1_assetId: backToStep === "composition" ? null : undefined,
      finalExport_4_5_assetId: backToStep === "composition" ? null : undefined,
    });
  }

  /**
   * Requester-triggered: skip the staff content-review gate and start the
   * pipeline directly using the AI analysis already shown to the requester.
   */
  async startFromRequesterApproval(
    requestId: string,
    requesterId: string,
    analysis: {
      scenePlan?: string | null;
      scriptThai: string;
      scriptEnglish: string;
      hookThai?: string | null;
      hookEnglish: string;
      captionThai: string;
      captionEnglish: string;
      captionChinese: string;
      /** Requester-edited storyboard (overrides the generated one). */
      storyboard?: StoryboardScene[] | null;
    }
  ): Promise<VideoGenerationJob> {
    const existing = await videoGenerationJobRepository.findByRequestId(requestId);
    const scriptThai = sanitizeThaiVoiceScript(analysis.scriptThai);
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

    // Requester-edited storyboard wins; otherwise carry the one generated at
    // Stage 1. Persisted to both fields so it seeds the Stage-3 scene design.
    const storyboardJson =
      analysis.storyboard && analysis.storyboard.length > 0
        ? JSON.stringify(analysis.storyboard)
        : existing?.storyboard ?? null;

    // Job was pre-created by the analyze endpoint at AwaitingContentApproval.
    // Update it with the requester-approved (possibly edited) data and start the pipeline.
    if (existing?.currentStep === VideoGenerationStep.AwaitingContentApproval) {
      const updated = await videoGenerationJobRepository.update(existing.id, {
        currentStep: VideoGenerationStep.GeneratingVoice,
        approvedScenePlan: sanitizeScenePlanJson(analysis.scenePlan),
        approvedScriptThai: scriptThai,
        approvedScriptEnglish: analysis.scriptEnglish,
        approvedHookThai: analysis.hookThai ?? null,
        approvedHookEnglish: analysis.hookEnglish,
        approvedCaptionThai: analysis.captionThai,
        approvedCaptionEnglish: analysis.captionEnglish,
        approvedCaptionChinese: analysis.captionChinese,
        storyboard: storyboardJson,
        approvedStoryboard: storyboardJson,
        contentApprovedBy: requesterId,
      });

      this._runIAppTtsGeneration(updated).catch(async (err) => {
        console.error("[ElevenLabs] Voice generation failed:", err);
        await videoGenerationJobRepository.update(existing.id, {
          status: VideoGenerationJobStatus.Failed,
          currentStep: VideoGenerationStep.Failed,
          failedAtStep: VideoGenerationStep.GeneratingVoice,
        });
      });

      return this._getJob(existing.id);
    }

    if (existing && existing.status === VideoGenerationJobStatus.Active) {
      throw new Error("An active pipeline already exists for this request");
    }

    const job = await videoGenerationJobRepository.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.GeneratingVoice,
      storyboard: storyboardJson,
      approvedStoryboard: storyboardJson,
      scenePlan: sanitizeScenePlanJson(analysis.scenePlan),
      scriptThai,
      scriptEnglish: analysis.scriptEnglish,
      scriptChinese: null,
      hookThai: analysis.hookThai ?? null,
      hookEnglish: analysis.hookEnglish,
      captionThai: analysis.captionThai,
      captionEnglish: analysis.captionEnglish,
      captionChinese: analysis.captionChinese,
      approvedScenePlan: sanitizeScenePlanJson(analysis.scenePlan),
      approvedScriptThai: scriptThai,
      approvedScriptEnglish: analysis.scriptEnglish,
      approvedScriptChinese: null,
      approvedHookThai: analysis.hookThai ?? null,
      approvedHookEnglish: analysis.hookEnglish,
      approvedCaptionThai: analysis.captionThai,
      approvedCaptionEnglish: analysis.captionEnglish,
      approvedCaptionChinese: analysis.captionChinese,
      videoGenTaskId: null,
      videoGenTaskIds: null,
      videoGenStatus: null,
      videoGenLastPolledAt: null,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
      ttsTaskId: null,
      rvcVoiceModel: "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      selectedMusicTrack: null,
      voiceDurationSeconds: null,
      voiceTimestamps: null,
      subtitleTimeline: null,
      animationSpec: null,
      animatedVideoAssetId: null,
      animatedOverlayAssetIds: null,
      animationApprovedBy: null,
      subtitleLanguages: ["en", "zh"],
      finalExport_9_16_assetId: null,
      finalExport_16_9_assetId: null,
      finalExport_1_1_assetId: null,
      finalExport_4_5_assetId: null,
      finalExport_tvent_assetId: null,
      failedAtStep: null,
      contentApprovedBy: requesterId,
      videoApprovedBy: null,
      voiceApprovedBy: null,
      finalApprovedBy: null,
    });

    this._runIAppTtsGeneration(job).catch(async (err) => {
      console.error("[ElevenLabs] Voice generation failed:", err);
      await videoGenerationJobRepository.update(job.id, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingVoice,
      });
    });

    return this._getJob(job.id);
  }

  /** Get the current pipeline job for a request. */
  async getCurrentJob(requestId: string): Promise<VideoGenerationJob | null> {
    return videoGenerationJobRepository.findByRequestId(requestId);
  }

  /**
   * Retry a failed pipeline step.
   * Restarts only from the step that actually failed — not from the beginning.
   * Optionally accepts requester-edited content to apply to approved fields before retrying.
   */
  async retryPipeline(
    jobId: string,
    editedContent?: {
      hookThai: string | null;
      hookEnglish: string | null;
      scriptThai: string | null;
      scriptEnglish: string | null;
      scenes: {
        visualDescription?: string;
        visualDescriptionThai?: string;
        durationSeconds?: number;
        imageIndexes?: number[];
        motionNotes?: string;
      }[];
    }
  ): Promise<VideoGenerationJob> {
    const job = await this._getJob(jobId);
    if (job.currentStep !== VideoGenerationStep.Failed) {
      throw new Error("Can only retry a pipeline that is in Failed state");
    }

    const failedAt = job.failedAtStep ?? VideoGenerationStep.AnalyzingContent;

    // Apply requester edits to approved fields before retrying
    if (editedContent) {
      const existingPlan = JSON.parse(
        job.approvedScenePlan ?? job.scenePlan ?? "[]"
      ) as ScenePlan[];
      const updatedScenePlan =
        editedContent.scenes.length > 0
          ? existingPlan.map((s, i) => ({
              ...s,
              imageIndexes: Array.isArray(editedContent.scenes[i]?.imageIndexes)
                ? editedContent.scenes[i]!.imageIndexes!
                    .filter((idx) => Number.isInteger(idx) && idx >= 0)
                    .slice(0, 2)
                : s.imageIndexes,
              durationSeconds:
                Array.isArray(editedContent.scenes[i]?.imageIndexes) &&
                editedContent.scenes[i]!.imageIndexes!.length >= 2
                  ? 8
                  :
                Number.isFinite(editedContent.scenes[i]?.durationSeconds) &&
                Number(editedContent.scenes[i]?.durationSeconds) > 0
                  ? Number(editedContent.scenes[i]?.durationSeconds)
                  : s.durationSeconds,
              visualDescriptionThai: sanitizeSceneDescription(
                editedContent.scenes[i]?.visualDescriptionThai ??
                  editedContent.scenes[i]?.visualDescription ??
                  s.visualDescriptionThai
              ),
              visualDescription:
                sanitizeSceneDescription(
                  editedContent.scenes[i]?.visualDescription ??
                    editedContent.scenes[i]?.visualDescriptionThai ??
                    s.visualDescription
                ),
              motionNotes: editedContent.scenes[i]?.motionNotes ?? s.motionNotes,
            }))
          : existingPlan;
      await videoGenerationJobRepository.update(jobId, {
        approvedScenePlan: JSON.stringify(sanitizeScenePlanDescriptions(updatedScenePlan)),
        approvedScriptThai:
          editedContent.scriptThai === null
            ? null
            : sanitizeThaiVoiceScript(editedContent.scriptThai),
        approvedScriptEnglish: editedContent.scriptEnglish,
        approvedHookThai: editedContent.hookThai,
        approvedHookEnglish: editedContent.hookEnglish,
      });
    }

    // Reset to active + clear failedAtStep
    await videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Active,
      failedAtStep: null,
    });

    switch (failedAt) {
      case VideoGenerationStep.AnalyzingContent: {
        const { clipRequestRepository } = await import("@/repositories/index");
        const req = await clipRequestRepository.findById(job.requestId);
        if (!req) throw new Error(`ClipRequest not found: ${job.requestId}`);
        const assets = await uploadedAssetRepository.findByRequestId(job.requestId);
        const imageUrls = assets
          .filter((a) => (a.assetType === AssetType.Image || a.assetType === AssetType.Video) && a.uploadStatus === AssetUploadStatus.Uploaded)
          .map((a) => a.storageUrl).filter(Boolean);
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.AnalyzingContent,
          scenePlan: null, scriptThai: null, scriptEnglish: null,
          hookThai: null, hookEnglish: null,
          captionThai: null, captionEnglish: null, captionChinese: null,
        });
        this._runChatGptAnalysis(jobId, job.requestId, {
          imageUrls,
          description: req.description,
          targetAudience: req.targetAudience,
          targetPlatforms: req.targetPlatforms,
          preferredStyle: req.preferredStyle,
        }).catch(async (err) => {
          console.error("Gemini analysis failed on retry:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.AnalyzingContent,
          });
        });
        return updated;
      }

      case VideoGenerationStep.GeneratingBaseVideo: {
        // The batch render of all scenes failed somewhere; re-render the whole
        // batch from a clean slate, then return to the combined review.
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingBaseVideo,
          currentSceneIndex: 0,
          sceneVideoAssetIds: null,
          baseVideoAssetId: null,
          videoGenStatus: null,
        });
        await this._dispatchHeavy(updated, RenderStep.MontageAllSegments, () =>
          this._renderAllSceneSegments(updated)
        );
        return updated;
      }

      case VideoGenerationStep.GeneratingVoice: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingVoice,
          ttsTaskId: null,
          voiceRecordingAssetId: null,
          processedVoiceAssetId: null,
        });
        this._runIAppTtsGeneration(updated).catch(async (err) => {
          console.error("[iAppTTS] Retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.GeneratingVoice,
          });
        });
        return updated;
      }

      case VideoGenerationStep.GeneratingSceneDesign: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingSceneDesign,
          scenePlan: null,
          hookThai: null,
        });
        this._runSceneDesignGeneration(updated).catch(async (err) => {
          console.error("Scene design retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.GeneratingSceneDesign,
          });
        });
        return updated;
      }

      case VideoGenerationStep.GeneratingAnimations: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingAnimations,
          animatedVideoAssetId: null,
          animatedOverlayAssetIds: null,
        });
        await this._dispatchHeavy(updated, RenderStep.AnimationGeneration, () =>
          this._runAnimationGeneration(updated)
        );
        return updated;
      }

      case VideoGenerationStep.ComposingFinalVideo: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.ComposingFinalVideo,
          finalExport_9_16_assetId: null,
          finalExport_16_9_assetId: null,
          finalExport_1_1_assetId: null,
          finalExport_4_5_assetId: null,
        });
        await this._dispatchHeavy(updated, RenderStep.FfmpegComposition, () =>
          this._runFFmpegComposition(updated)
        );
        return updated;
      }

      default:
        throw new Error(`No retry handler for step: ${failedAt}`);
    }
  }

  /** Mark job as complete (called after all platforms published). */
  async markComplete(jobId: string): Promise<VideoGenerationJob> {
    return videoGenerationJobRepository.update(jobId, {
      status: VideoGenerationJobStatus.Complete,
      currentStep: VideoGenerationStep.Complete,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _getJob(jobId: string): Promise<VideoGenerationJob> {
    const job = await videoGenerationJobRepository.findById(jobId);
    if (!job) throw new Error(`VideoGenerationJob not found: ${jobId}`);
    return job;
  }

  private async _getJobAtStep(
    jobId: string,
    expectedStep: VideoGenerationStep
  ): Promise<VideoGenerationJob> {
    const job = await this._getJob(jobId);
    if (job.currentStep !== expectedStep) {
      throw new Error(
        `Expected pipeline step ${expectedStep} but job is at ${job.currentStep}`
      );
    }
    return job;
  }

  private async _getClipRequestBasic(requestId: string): Promise<{ userId: string }> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(requestId);
    if (!req) throw new Error(`ClipRequest not found: ${requestId}`);
    return { userId: req.userId };
  }

  private async _moveAssetInSpaces(sourceKey: string, destKey: string): Promise<void> {
    const { CopyObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const bucket = process.env.DO_SPACES_BUCKET!;
    await spacesClient.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${sourceKey}`,
        Key: destKey,
        ACL: "public-read",
      })
    );
    await spacesClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
  }
}

export const videoGenerationService = new VideoGenerationService();
