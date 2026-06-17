import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { buildAnimatedVideoKey, buildAnimatedOverlayKey, buildAiVideoKey } from "@/lib/spacesKeys";
import { spacesClient } from "@/lib/spaces";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import * as veoService from "@/lib/ai/veoService";
import * as elevenLabsTtsService from "@/lib/ai/elevenLabsTtsService";
import * as ffmpegService from "@/lib/ai/ffmpegService";
import * as animationService from "@/lib/ai/animationService";
import * as remotionService from "@/lib/ai/remotionService";
import type { VideoGenerationJob, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { GenerateContentParams } from "@/lib/ai/chatGptVisionService";
import type { ImageCoordinates } from "@/lib/ai/geminiSubtitlesService";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AI_CONFIG } from "@/config/aiTools";

const execFileAsync = promisify(execFile);

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
    }
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingContentApproval);
    const scriptThai = sanitizeThaiVoiceScript(approved.scriptThai);
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingVoice,
      approvedScenePlan: approved.scenePlan ?? null,
      approvedScriptThai: scriptThai,
      approvedScriptEnglish: approved.scriptEnglish,
      approvedHookThai: approved.hookThai ?? null,
      approvedHookEnglish: approved.hookEnglish,
      approvedCaptionThai: approved.captionThai,
      approvedCaptionEnglish: approved.captionEnglish,
      approvedCaptionChinese: approved.captionChinese,
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
   * scene plan). This is the Phase 3 per-scene duration strategy.
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

  /**
   * Select image URLs for a scene using `scene.imageIndexes`, falling back
   * to all images if `imageIndexes` is empty, and silently dropping any
   * out-of-bounds indexes. If every index is out of bounds (or the array
   * ends up empty), falls back to the full image set so the video generator
   * always receives at least one image.
   */
  private _selectSceneImages(allImageUrls: string[], imageIndexes: number[] | undefined): string[] {
    if (!imageIndexes || imageIndexes.length === 0) {
      return allImageUrls;
    }
    const selected = imageIndexes
      .filter((i) => Number.isInteger(i) && i >= 0 && i < allImageUrls.length)
      .map((i) => allImageUrls[i]);
    return selected.length > 0 ? selected : allImageUrls;
  }

  /**
   * Issue one Veo `createVideo` call per scene in `approvedScenePlan`,
   * using requester-approved scene durations plus that scene's
   * `visualDescriptionThai` + `imageIndexes`-selected images. Records all task
   * IDs (in scene order) on `videoGenTaskIds`, plus the first task ID on the
   * legacy `videoGenTaskId` field for any code paths that still read it as an
   * "in-flight" signal.
   */
  private async _runVideoGeneration(job: VideoGenerationJob): Promise<void> {
    const request = await this._getClipRequestImages(job.requestId);
    const scenePlan = JSON.parse(job.approvedScenePlan!) as ScenePlan[];

    const ANTI_HALLUCINATION =
      " IMPORTANT: Do not fabricate or hallucinate final product visuals (e.g. finished dishes, packaged goods, retail displays) that are not present in the submitted source images. If the submitted images already show the final product, you may recreate or animate those faithfully. Only invent visuals for raw materials and ingredients. Fabricating final products that differ from the real item risks misrepresentation.";

    const aspectRatio = PLATFORM_ASPECT_RATIOS[request.primaryPlatform];
    const sceneDurations = scenePlan.map((scene) =>
      Number.isFinite(scene.durationSeconds) && scene.durationSeconds > 0
        ? scene.durationSeconds
        : Math.max(1, request.durationSeconds / scenePlan.length)
    );

    const taskIds: string[] = [];
    for (let i = 0; i < scenePlan.length; i++) {
      const scene = scenePlan[i];
      const prompt = (scene.visualDescriptionThai ?? scene.visualDescription ?? "") + ANTI_HALLUCINATION;
      const imageUrls = this._selectSceneImages(request.imageUrls, scene.imageIndexes);

      const taskId = await veoService.createVideo({
        imageUrls,
        prompt,
        aspectRatio,
        durationSeconds: sceneDurations[i],
      });
      taskIds.push(taskId);
    }

    await videoGenerationJobRepository.update(job.id, {
      videoGenTaskIds: taskIds,
      videoGenTaskId: taskIds[0] ?? null,
      sceneVideoAssetIds: null,
    });
  }

  /**
   * Poll Veo for ALL per-scene video completions. Called by the status
   * endpoint. Once every scene's clip has been downloaded and stored, the
   * clips are merged automatically (in scene order) with
   * `ffmpegService.concatVideos` into a single `baseVideoAssetId` and the job
   * advances to AwaitingVideoApproval.
   */
  async checkBaseVideoReady(jobId: string): Promise<VideoGenerationJob> {
    const job = await this._getJob(jobId);

    if (job.currentStep !== VideoGenerationStep.GeneratingBaseVideo) return job;

    const taskIds = job.videoGenTaskIds ?? (job.videoGenTaskId ? [job.videoGenTaskId] : []);
    if (taskIds.length === 0) return job;

    const request = await this._getClipRequestBasic(job.requestId);

    // Existing per-scene asset IDs from previous polls (null slots = not ready yet)
    const sceneAssetIds: (string | null)[] =
      job.sceneVideoAssetIds && job.sceneVideoAssetIds.length === taskIds.length
        ? [...job.sceneVideoAssetIds]
        : new Array(taskIds.length).fill(null);

    let anyFailed = false;
    let failReason = "";
    let anyNewlyStored = false;

    for (let i = 0; i < taskIds.length; i++) {
      if (sceneAssetIds[i]) continue; // already stored from a previous poll

      const status = await veoService.pollTaskStatus(taskIds[i]);
      console.log(`[Veo] scene=${i} task=${taskIds[i]} status=${status.status} requestId=${job.requestId}`);

      if (status.status === "failed") {
        anyFailed = true;
        failReason = status.reason;
        console.error(`[Veo] scene=${i} task=${taskIds[i]} failed: ${status.reason}`);
        continue;
      }

      if (status.status !== "succeed") {
        continue; // still submitted/processing
      }

      // Download from Veo and store in DO Spaces
      const { storageKey, storageUrl, fileSizeBytes } = await veoService.downloadAndStore(
        status.videoUrl,
        request.userId,
        job.requestId
      );

      const scheduledDeletionAt = new Date();
      scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

      const asset = await uploadedAssetRepository.create({
        requestId: job.requestId,
        userId: request.userId,
        fileName: `veo_scene_${i + 1}.mp4`,
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

      sceneAssetIds[i] = asset.id;
      anyNewlyStored = true;
    }

    if (anyFailed) {
      console.error(`[Veo] one or more scenes failed: ${failReason}`);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
        videoGenLastPolledAt: new Date(),
        sceneVideoAssetIds: sceneAssetIds,
      });
    }

    const allReady = sceneAssetIds.every((a) => a !== null);

    if (!allReady) {
      // sceneAssetIds is a sparse array (string | null) keyed by scene index
      // — stored as-is so the next poll only re-checks scenes still null.
      return videoGenerationJobRepository.update(jobId, {
        videoGenLastPolledAt: new Date(),
        ...(anyNewlyStored ? { sceneVideoAssetIds: sceneAssetIds } : {}),
      });
    }

    // All scenes ready — concatenate in scene order.
    const readyAssetIds = sceneAssetIds as string[];
    const sceneAssets = await Promise.all(
      readyAssetIds.map((id) => uploadedAssetRepository.findById(id))
    );
    const missingIdx = sceneAssets.findIndex((a) => !a);
    if (missingIdx !== -1) {
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

    const sceneStorageKeys = sceneAssets.map((a) => a!.storageKey);

    // Remove the previous concatenated base video asset if one exists from a prior attempt
    if (job.baseVideoAssetId) {
      await uploadedAssetRepository.deleteById(job.baseVideoAssetId);
    }

    const concatKey = buildAiVideoKey(request.userId, job.requestId);
    const { storageKey: concatStorageKey, storageUrl: concatStorageUrl } = await ffmpegService.concatVideos(
      sceneStorageKeys,
      concatKey
    );

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const concatAsset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: "veo_generated.mp4",
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes: 0,
      mimeType: "video/mp4",
      storageKey: concatStorageKey,
      storageUrl: concatStorageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
    });

    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingVideoApproval,
      baseVideoAssetId: concatAsset.id,
      sceneVideoAssetIds: readyAssetIds,
      videoGenLastPolledAt: new Date(),
    });
  }

  /** Staff approves the generated video and triggers animation generation automatically. */
  async approveBaseVideo(
    jobId: string,
    staffId: string,
    selectedMusicTrack: string | null = null
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      videoApprovedBy: staffId,
      ...(selectedMusicTrack !== null ? { selectedMusicTrack } : {}),
    });

    this._runAnimationGeneration(updated).catch(async (err) => {
      console.error("[AnimationGeneration] Failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingAnimations,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Staff rejects the generated video.
   * @param backToStep  "video" → regenerate with Veo; "content" → go back to ChatGPT
   */
  async rejectBaseVideo(
    jobId: string,
    staffId: string,
    backToStep: "video" | "content"
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    if (backToStep === "content") {
      return videoGenerationJobRepository.update(jobId, {
        currentStep: VideoGenerationStep.AwaitingContentApproval,
      });
    }

    // Regenerate video with optional updated prompt
    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      videoGenTaskId: null,
      videoGenTaskIds: null,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
    });

    try {
      await this._runVideoGeneration(updated);
    } catch (err) {
      console.error("Veo regeneration failed:", err);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

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
    const isVoiceFailure =
      job.currentStep === VideoGenerationStep.Failed &&
      job.failedAtStep === VideoGenerationStep.GeneratingVoice;

    if (job.currentStep !== VideoGenerationStep.AwaitingVoiceApproval && !isVoiceFailure) {
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
    const audioAsset = await uploadedAssetRepository.findById(job.processedVoiceAssetId!);
    if (!audioAsset) throw new Error("Voice asset not found for animation generation");

    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
    const durationSeconds = job.voiceDurationSeconds ?? request.durationSeconds ?? 15;

    // Per-sentence timestamps were produced by Gemini right after voice
    // generation (step 2) and stored on the job as voiceTimestamps /
    // subtitleTimeline. Reuse them here instead of re-running alignment.
    const timestampsSource = job.voiceTimestamps ?? job.subtitleTimeline;
    if (!timestampsSource) {
      throw new Error("No voice timestamps available for animation generation");
    }
    const segments = JSON.parse(timestampsSource);
    const subtitleTimeline = job.subtitleTimeline ?? timestampsSource;

    // Step 1: Claude generates motion-graphics specs (kinetic text,
    // lower-thirds, CTA banners) from the real voice timeline + scene plan.
    let scenePlan: ScenePlan[] = [];
    try { scenePlan = JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]"); } catch { /* ignore */ }

    const specs = await animationService.generateAnimationSpec({
      scriptThai,
      timedSegments: segments,
      scenePlan,
      hookThai: job.approvedHookThai ?? job.hookThai ?? "",
      durationSeconds,
    });

    const subtitleLanguages = job.subtitleLanguages && job.subtitleLanguages.length > 0
      ? job.subtitleLanguages
      : (["en", "zh"] as ("th" | "en" | "zh")[]);

    const { spacesPublicUrl } = await import("@/lib/spaces");
    const { AssetType, AssetUploadStatus } = await import("@/domain/enums/AssetType");
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    // Step 2: render one Remotion overlay per required export ratio.
    const targetRatios = ffmpegService.getRequiredRatiosForPlatforms(request.targetPlatforms ?? []);
    const overlayAssetIds: Record<string, string> = {};

    for (const ratio of targetRatios) {
      const overlayKey = buildAnimatedOverlayKey(request.userId, job.requestId, ratio);
      await remotionService.renderOverlay({
        ratio,
        durationSeconds,
        subtitleTimeline: segments,
        subtitleLanguages,
        scenePlan,
        animationSpecs: specs,
        outputStorageKey: overlayKey,
      });

      const overlayAsset = await uploadedAssetRepository.create({
        requestId: job.requestId,
        userId: request.userId,
        fileName: `overlay_${ratio.replace(":", "-")}.webm`,
        assetType: AssetType.AnimatedVideo,
        fileSizeBytes: 0,
        mimeType: "video/webm",
        storageKey: overlayKey,
        storageUrl: spacesPublicUrl(overlayKey),
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt,
        videoRatio: ratio,
      });
      overlayAssetIds[ratio] = overlayAsset.id;
    }

    // Step 3: composite a single representative-ratio preview (base video +
    // that ratio's overlay) for the AwaitingAnimationApproval review UI.
    const previewRatio = targetRatios.includes("9:16") ? "9:16" : targetRatios[0];
    const videoAsset = await uploadedAssetRepository.findById(job.baseVideoAssetId!);
    if (!videoAsset) throw new Error("Base video asset not found");
    const previewOverlayAsset = await uploadedAssetRepository.findById(overlayAssetIds[previewRatio]);
    if (!previewOverlayAsset) throw new Error("Overlay asset not found for animation preview");

    const animatedKey = buildAnimatedVideoKey(request.userId, job.requestId);
    await ffmpegService.renderOverlayPreview({
      videoStorageKey: videoAsset.storageKey,
      overlayStorageKey: previewOverlayAsset.storageKey,
      ratio: previewRatio,
      outputStorageKey: animatedKey,
    });

    const animAsset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: "animated_preview.mp4",
      assetType: AssetType.AnimatedVideo,
      fileSizeBytes: 0,
      mimeType: "video/mp4",
      storageKey: animatedKey,
      storageUrl: spacesPublicUrl(animatedKey),
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
      videoRatio: previewRatio,
    });

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingAnimationApproval,
      subtitleTimeline,
      animationSpec: JSON.stringify(specs),
      animatedVideoAssetId: animAsset.id,
      animatedOverlayAssetIds: overlayAssetIds,
    });
  }

  /** Requester approves the animated video, selects target platforms, and triggers FFmpeg final composition. */
  async approveAnimationByRequester(
    jobId: string,
    userId: string,
    targetPlatforms: Platform[],
    selectedMusicTrack: string | null = null,
    subtitleLanguages?: ("th" | "en" | "zh")[]
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingAnimationApproval);

    const job = await this._getJob(jobId);
    const { clipRequestRepository } = await import("@/repositories/index");
    await clipRequestRepository.update(job.requestId, { targetPlatforms });

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.ComposingFinalVideo,
      animationApprovedBy: userId,
      ...(selectedMusicTrack !== null ? { selectedMusicTrack } : {}),
      ...(subtitleLanguages && subtitleLanguages.length > 0 ? { subtitleLanguages } : {}),
    });

    this._runFFmpegComposition(updated).catch(async (err) => {
      console.error("FFmpeg composition failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.ComposingFinalVideo,
      });
    });

    return updated;
  }

  /** Requester rejects the animation result and re-triggers animation generation. */
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

    this._runAnimationGeneration(updated).catch(async (err) => {
      console.error("[AnimationGeneration] Regeneration failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingAnimations,
      });
    });

    return updated;
  }

  private async _runSceneDesignGeneration(job: VideoGenerationJob): Promise<void> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const { businessProfileService } = await import("@/services/BusinessProfileService");

    const req = await clipRequestRepository.findById(job.requestId);
    if (!req) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const assets = await uploadedAssetRepository.findByRequestId(job.requestId);
    const imageUrls = assets
      .filter((a) => a.assetType === AssetType.Image || a.assetType === AssetType.Video)
      .filter((a) => a.uploadStatus === AssetUploadStatus.Uploaded)
      .map((a) => a.storageUrl)
      .filter(Boolean);

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
    });

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
      scenePlan: JSON.stringify(output.scenePlan),
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

  /** Requester approves AI voice and triggers scene/hook design from the approved script. */
  async approveVoiceConversionByRequester(
    jobId: string,
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

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
    const { clipRequestRepository } = await import("@/repositories/index");
    await clipRequestRepository.update(job.requestId, { durationSeconds: approved.durationSeconds });

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      approvedScenePlan: approved.scenePlan,
      contentApprovedBy: userId,
    });

    try {
      await this._runVideoGeneration(updated);
    } catch (err) {
      console.error("Veo generation failed:", err);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

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
    userId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingFinalApproval);

    const job = await this._getJob(jobId);
    const { clipRequestRepository } = await import("@/repositories/index");
    
    // Mark request as Delivered
    const { RequestStatus } = await import("@/domain/enums/RequestStatus");
    await clipRequestRepository.updateStatus(job.requestId, RequestStatus.Delivered);

    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.Complete,
      finalApprovedBy: userId,
    });
  }

  private async _runFFmpegComposition(job: VideoGenerationJob): Promise<void> {
    // Phase 4: the base (concatenated) video is composited per-ratio with
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

    // Resolve Phase 4 Remotion overlay clips (one per required ratio) so
    // ffmpegService can composite + skip redundant subtitle burn-in.
    const overlayStorageKeys: Partial<Record<ffmpegService.VideoRatio, string>> = {};
    if (job.animatedOverlayAssetIds) {
      await Promise.all(
        Object.entries(job.animatedOverlayAssetIds).map(async ([ratio, assetId]) => {
          const asset = await uploadedAssetRepository.findById(assetId);
          if (asset) overlayStorageKeys[ratio as ffmpegService.VideoRatio] = asset.storageKey;
        })
      );
    }

    // Use pre-computed subtitle timeline from animation step if available; otherwise re-run alignment
    let assSubtitlesContent: string | undefined = undefined;
    let assSubtitlesContentTvent: string | undefined = undefined;
    const subtitleLanguages = job.subtitleLanguages && job.subtitleLanguages.length > 0
      ? job.subtitleLanguages
      : (["en", "zh"] as ("th" | "en" | "zh")[]);
    const needsTventExport = platforms.includes(Platform.TventApp);
    // The 9:16 Remotion overlay's captions were rendered with `subtitleLanguages`
    // (set above in _runAnimationGeneration) — only reuse it for the Tvent
    // export if that exactly matches Tvent's fixed English+Chinese requirement.
    const overlayCoversTventSubtitles =
      !!overlayStorageKeys["9:16"] &&
      subtitleLanguages.length === 2 &&
      subtitleLanguages.includes("en") &&
      subtitleLanguages.includes("zh");
    try {
      const geminiSubtitlesService = await import("@/lib/ai/geminiSubtitlesService");

      if (job.subtitleTimeline) {
        const segments = JSON.parse(job.subtitleTimeline);
        assSubtitlesContent = geminiSubtitlesService.generateAssSubtitles(segments, subtitleLanguages);
        if (needsTventExport) {
          assSubtitlesContentTvent = geminiSubtitlesService.generateAssSubtitles(segments, ["en", "zh"]);
        }
      } else {
        const { AI_CONFIG, requireGeminiApiKey } = await import("@/config/aiTools");
        const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
        let scriptEnglish = job.approvedScriptEnglish ?? job.scriptEnglish ?? "";
        let scriptChinese = job.approvedScriptChinese ?? job.scriptChinese ?? "";

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

        const duration = request.durationSeconds || 15;
        const segments = await geminiSubtitlesService.alignAudioWithScript({
          audioUrl: audioAsset.storageUrl,
          scriptThai,
          scriptEnglish,
          scriptChinese,
          durationSeconds: duration,
        });
        assSubtitlesContent = geminiSubtitlesService.generateAssSubtitles(segments, subtitleLanguages);
        if (needsTventExport) {
          assSubtitlesContentTvent = geminiSubtitlesService.generateAssSubtitles(segments, ["en", "zh"]);
        }
      }
    } catch (err) {
      console.error("[FFmpeg] Subtitle preparation failed, falling back to word count:", err);
    }

    // Call Gemini coordinates detection for smart crop focus
    let coords: ImageCoordinates | undefined = undefined;
    try {
      const geminiSubtitlesService = await import("@/lib/ai/geminiSubtitlesService");
      const assets = await uploadedAssetRepository.findByRequestId(job.requestId);
      const imageUrls = assets
        .filter((a) => (a.assetType === AssetType.Image || a.assetType === AssetType.Video) && a.uploadStatus === AssetUploadStatus.Uploaded)
        .map((a) => a.storageUrl).filter(Boolean);
      
      if (imageUrls.length > 0) {
        const coordsList = await geminiSubtitlesService.detectProductCoordinates(imageUrls);
        if (coordsList && coordsList[0]) {
          coords = coordsList[0];
        }
      }
    } catch (err) {
      console.error("[FFmpeg] Coordinate focus detection failed, using default center:", err);
    }

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
      assSubtitlesContent,
      assSubtitlesContentTvent,
      overlayStorageKeys,
      overlayCoversTventSubtitles,
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

    // Dedicated Tvent App export: a separate asset if its EN+ZH subtitles
    // differ from the general 9:16 export, otherwise the same 9:16 asset
    // (it already carries EN+ZH subtitles).
    let tventAssetId: string | null = null;
    if (needsTventExport) {
      const tventExportInfo = result.exports["tvent"];
      if (tventExportInfo) {
        const tventAsset = await uploadedAssetRepository.create({
          requestId: job.requestId,
          userId: request.userId,
          fileName: "final_tvent.mp4",
          assetType: AssetType.FinalClip,
          fileSizeBytes: 0,
          mimeType: "video/mp4",
          storageKey: tventExportInfo.storageKey,
          storageUrl: tventExportInfo.storageUrl,
          thumbnailKey: "",
          thumbnailUrl: "",
          uploadStatus: AssetUploadStatus.Uploaded,
          scheduledDeletionAt,
          videoRatio: "9:16",
        });
        tventAssetId = tventAsset.id;
      } else {
        tventAssetId = assetIds["9:16"] ?? null;
      }
    }

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingFinalApproval,
      finalExport_9_16_assetId: assetIds["9:16"] ?? null,
      finalExport_16_9_assetId: assetIds["16:9"] ?? null,
      finalExport_1_1_assetId: assetIds["1:1"] ?? null,
      finalExport_4_5_assetId: assetIds["4:5"] ?? null,
      finalExport_tvent_assetId: tventAssetId,
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
    }
  ): Promise<VideoGenerationJob> {
    const existing = await videoGenerationJobRepository.findByRequestId(requestId);
    const scriptThai = sanitizeThaiVoiceScript(analysis.scriptThai);
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

    // Job was pre-created by the analyze endpoint at AwaitingContentApproval.
    // Update it with the requester-approved (possibly edited) data and start the pipeline.
    if (existing?.currentStep === VideoGenerationStep.AwaitingContentApproval) {
      const updated = await videoGenerationJobRepository.update(existing.id, {
        currentStep: VideoGenerationStep.GeneratingVoice,
        approvedScenePlan: analysis.scenePlan ?? null,
        approvedScriptThai: scriptThai,
        approvedScriptEnglish: analysis.scriptEnglish,
        approvedHookThai: analysis.hookThai ?? null,
        approvedHookEnglish: analysis.hookEnglish,
        approvedCaptionThai: analysis.captionThai,
        approvedCaptionEnglish: analysis.captionEnglish,
        approvedCaptionChinese: analysis.captionChinese,
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
      scenePlan: analysis.scenePlan ?? null,
      scriptThai,
      scriptEnglish: analysis.scriptEnglish,
      scriptChinese: null,
      hookThai: analysis.hookThai ?? null,
      hookEnglish: analysis.hookEnglish,
      captionThai: analysis.captionThai,
      captionEnglish: analysis.captionEnglish,
      captionChinese: analysis.captionChinese,
      approvedScenePlan: analysis.scenePlan ?? null,
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
      scenes: { visualDescription: string; motionNotes: string }[];
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
              visualDescription:
                editedContent.scenes[i]?.visualDescription ?? s.visualDescription,
              motionNotes: editedContent.scenes[i]?.motionNotes ?? s.motionNotes,
            }))
          : existingPlan;
      await videoGenerationJobRepository.update(jobId, {
        approvedScenePlan: JSON.stringify(updatedScenePlan),
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
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingBaseVideo,
          videoGenTaskId: null,
          videoGenTaskIds: null,
          sceneVideoAssetIds: null,
          baseVideoAssetId: null,
        });
        try {
          await this._runVideoGeneration(updated);
        } catch (err) {
          console.error("Veo retry failed:", err);
          return videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
          });
        }
        return this._getJob(jobId);
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
        this._runAnimationGeneration(updated).catch(async (err) => {
          console.error("[AnimationGeneration] Retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.GeneratingAnimations,
          });
        });
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
        this._runFFmpegComposition(updated).catch(async (err) => {
          console.error("FFmpeg retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.ComposingFinalVideo,
          });
        });
        return updated;
      }

      default:
        throw new Error(`No retry handler for step: ${failedAt}`);
    }
  }

  /** Requester approves the generated video and triggers animation generation automatically. */
  async approveBaseVideoByRequester(
    jobId: string,
    requesterId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      videoApprovedBy: requesterId,
    });

    this._runAnimationGeneration(updated).catch(async (err) => {
      console.error("[AnimationGeneration] Failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingAnimations,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Requester requests a video revision with an updated script.
   * Saves edited approved fields and re-triggers Veo generation.
   */
  async requestVideoRevisionByRequester(
    jobId: string,
    requesterId: string,
    editedContent: {
      scenePlan: string;
      hookThai: string;
      scriptThai: string;
      captionThai: string;
    }
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);
    const scriptThai = sanitizeThaiVoiceScript(editedContent.scriptThai);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      approvedScenePlan: editedContent.scenePlan,
      approvedHookThai: editedContent.hookThai,
      approvedScriptThai: scriptThai,
      approvedCaptionThai: editedContent.captionThai,
      videoGenTaskId: null,
      videoGenTaskIds: null,
      sceneVideoAssetIds: null,
      baseVideoAssetId: null,
    });

    try {
      await this._runVideoGeneration(updated);
    } catch (err) {
      console.error("Veo regeneration failed:", err);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

    return this._getJob(jobId);
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

  private async _getClipRequestImages(requestId: string): Promise<{ userId: string; imageUrls: string[]; primaryPlatform: Platform; durationSeconds: number }> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(requestId);
    if (!req) throw new Error(`ClipRequest not found: ${requestId}`);

    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    const imageUrls = assets
      .filter((a) => a.assetType === AssetType.Image || a.assetType === AssetType.Video)
      .filter((a) => a.uploadStatus === AssetUploadStatus.Uploaded)
      .map((a) => a.storageUrl)
      .filter(Boolean);

    const primaryPlatform = req.targetPlatforms[0] ?? Platform.TventApp;
    const durationSeconds = Number.isFinite(req.durationSeconds) && req.durationSeconds > 0
      ? req.durationSeconds
      : 15;
    return { userId: req.userId, imageUrls, primaryPlatform, durationSeconds };
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
