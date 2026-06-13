import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
  videoPublishRecordRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { buildVoiceRecordingKey, buildTmpKey, buildAnimatedVideoKey } from "@/lib/spacesKeys";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import * as klingService from "@/lib/ai/klingService";
import * as elevenLabsTtsService from "@/lib/ai/elevenLabsTtsService";
import * as ffmpegService from "@/lib/ai/ffmpegService";
import * as animationService from "@/lib/ai/animationService";
import type { VideoGenerationJob, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { GenerateContentParams } from "@/lib/ai/chatGptVisionService";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Platform, PLATFORM_ASPECT_RATIOS } from "@/domain/enums/Platform";

const PRESIGNED_TTL = 15 * 60; // 15 minutes

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
      klingTaskId: null,
      klingStatus: null,
      klingLastPolledAt: null,
      baseVideoAssetId: null,
      ttsTaskId: null,
      rvcVoiceModel: params.rvcVoiceModel ?? "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      selectedMusicTrack: null,
      subtitleTimeline: null,
      animationSpec: null,
      animatedVideoAssetId: null,
      animationApprovedBy: null,
      finalExport_9_16_assetId: null,
      finalExport_16_9_assetId: null,
      finalExport_1_1_assetId: null,
      finalExport_4_5_assetId: null,
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

    const output = await chatGptVisionService.generateScenePlanAndScript({
      ...params,
      videoDurationSeconds: 15,
      businessProfileContext,
    });

    await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingContentApproval,
      scenePlan: JSON.stringify(output.scenePlan),
      scriptThai: output.scriptThai,
      hookThai: output.hookThai,
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
   * Staff approves the scene plan and script (with optional edits), then
   * submits to Kling AI for video generation.
   */
  async approveContent(
    jobId: string,
    staffId: string,
    approved: {
      scenePlan: string;
      scriptThai: string;
      scriptEnglish: string;
      hookThai: string;
      hookEnglish: string;
      captionThai: string;
      captionEnglish: string;
      captionChinese: string;
    }
  ): Promise<VideoGenerationJob> {
    const job = await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingContentApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      approvedScenePlan: approved.scenePlan,
      approvedScriptThai: approved.scriptThai,
      approvedScriptEnglish: approved.scriptEnglish,
      approvedHookThai: approved.hookThai,
      approvedHookEnglish: approved.hookEnglish,
      approvedCaptionThai: approved.captionThai,
      approvedCaptionEnglish: approved.captionEnglish,
      approvedCaptionChinese: approved.captionChinese,
      contentApprovedBy: staffId,
    });

    try {
      await this._runKlingGeneration(updated);
    } catch (err) {
      console.error("Kling generation failed:", err);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

    return this._getJob(jobId);
  }

  private async _runKlingGeneration(job: VideoGenerationJob): Promise<void> {
    const request = await this._getClipRequestImages(job.requestId);
    const scenePlan = JSON.parse(job.approvedScenePlan!) as ScenePlan[];
    const scenePrompt = scenePlan.map((s) => s.visualDescriptionThai ?? s.visualDescription ?? "").join(" Then: ");
    const prompt =
      scenePrompt +
      " IMPORTANT: Do not fabricate or hallucinate final product visuals (e.g. finished dishes, packaged goods, retail displays) that are not present in the submitted source images. If the submitted images already show the final product, you may recreate or animate those faithfully. Only invent visuals for raw materials and ingredients. Fabricating final products that differ from the real item risks misrepresentation.";

    const aspectRatio = PLATFORM_ASPECT_RATIOS[request.primaryPlatform];
    const taskId = await klingService.createVideo({
      imageUrls: request.imageUrls,
      prompt,
      aspectRatio,
      durationSeconds: request.durationSeconds,
    });

    await videoGenerationJobRepository.update(job.id, { klingTaskId: taskId });
  }

  /**
   * Poll Kling for video completion. Called by the status endpoint.
   * Advances step to AwaitingVideoApproval when done.
   */
  async checkBaseVideoReady(jobId: string): Promise<VideoGenerationJob> {
    const job = await this._getJob(jobId);

    if (job.currentStep !== VideoGenerationStep.GeneratingBaseVideo) return job;
    if (!job.klingTaskId) return job;

    const status = await klingService.pollTaskStatus(job.klingTaskId);

    console.log(`[Kling] task=${job.klingTaskId} status=${status.status} requestId=${job.requestId}`);

    if (status.status === "failed") {
      console.error(`[Kling] task=${job.klingTaskId} failed: ${status.reason}`);
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
        klingLastPolledAt: new Date(),
      });
    }

    if (status.status !== "succeed") {
      return videoGenerationJobRepository.update(jobId, {
        klingStatus: status.status,
        klingLastPolledAt: new Date(),
      });
    }

    // Download from Kling and store in DO Spaces
    const request = await this._getClipRequestBasic(job.requestId);
    const { storageKey, storageUrl, fileSizeBytes } = await klingService.downloadAndStore(
      status.videoUrl,
      request.userId,
      job.requestId
    );

    // Remove the previous base video asset if one exists from a prior attempt
    if (job.baseVideoAssetId) {
      await uploadedAssetRepository.deleteById(job.baseVideoAssetId);
    }

    // Create UploadedAsset record
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: "kling_generated.mp4",
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

    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingVideoApproval,
      baseVideoAssetId: asset.id,
    });
  }

  /** Staff approves the Kling video and triggers iAppTTS voice generation automatically. */
  async approveBaseVideo(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingVoice,
      videoApprovedBy: staffId,
    });

    this._runIAppTtsGeneration(updated).catch(async (err) => {
      console.error("[iAppTTS] Voice generation failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingVoice,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Staff rejects the Kling video.
   * @param backToStep  "video" → regenerate with Kling; "content" → go back to ChatGPT
   */
  async rejectBaseVideo(
    jobId: string,
    staffId: string,
    backToStep: "video" | "content",
    newPrompt?: string
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
      klingTaskId: null,
      baseVideoAssetId: null,
    });

    try {
      await this._runKlingGeneration(updated);
    } catch (err) {
      console.error("Kling regeneration failed:", err);
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
    const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
    if (!scriptThai) throw new Error("No approved Thai script available for TTS");

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

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingVoiceApproval,
      voiceRecordingAssetId: asset.id,
      processedVoiceAssetId: asset.id,
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

  private async _runAnimationGeneration(job: VideoGenerationJob): Promise<void> {
    const audioAsset = await uploadedAssetRepository.findById(job.processedVoiceAssetId!);
    if (!audioAsset) throw new Error("Voice asset not found for animation generation");

    const { clipRequestRepository } = await import("@/repositories/index");
    const request = await clipRequestRepository.findById(job.requestId);
    if (!request) throw new Error(`ClipRequest not found: ${job.requestId}`);

    const scriptThai = job.approvedScriptThai ?? job.scriptThai ?? "";
    let scriptEnglish = job.approvedScriptEnglish ?? job.scriptEnglish ?? "";
    let scriptChinese = job.approvedScriptChinese ?? job.scriptChinese ?? "";
    const durationSeconds = request.durationSeconds || 15;

    // Fail fast with a clear setup error before doing any work
    const { requireGeminiApiKey, AI_CONFIG } = await import("@/config/aiTools");
    requireGeminiApiKey();

    // Translate script to English + Simplified Chinese if missing (needed for
    // the subtitle timeline). Single Gemini call covers both languages.
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

    // Step 1: Gemini audio alignment — extract per-sentence timestamps
    const geminiSubtitlesService = await import("@/lib/ai/geminiSubtitlesService");
    const segments = await geminiSubtitlesService.alignAudioWithScript({
      audioUrl: audioAsset.storageUrl,
      scriptThai,
      scriptEnglish,
      scriptChinese,
      durationSeconds,
    });
    const subtitleTimeline = JSON.stringify(segments);

    // Step 2: Claude generates animation specs using timestamps
    let scenePlan: any[] = [];
    try { scenePlan = JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]"); } catch { /* ignore */ }

    const specs = await animationService.generateAnimationSpec({
      scriptThai,
      timedSegments: segments,
      scenePlan,
      hookThai: job.approvedHookThai ?? job.hookThai ?? "",
      durationSeconds,
    });

    // Step 3: FFmpeg renders animation overlays on the base video
    const videoAsset = await uploadedAssetRepository.findById(job.baseVideoAssetId!);
    if (!videoAsset) throw new Error("Base video asset not found");

    const animatedKey = buildAnimatedVideoKey(request.userId, job.requestId);
    await animationService.renderAnimationsOnVideo({
      videoStorageKey: videoAsset.storageKey,
      animationSpecs: specs,
      outputStorageKey: animatedKey,
    });

    // Create asset record for the animated video
    const { spacesPublicUrl } = await import("@/lib/spaces");
    const { AssetType, AssetUploadStatus } = await import("@/domain/enums/AssetType");
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const animAsset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: "animated_video.mp4",
      assetType: AssetType.AnimatedVideo,
      fileSizeBytes: 0,
      mimeType: "video/mp4",
      storageKey: animatedKey,
      storageUrl: spacesPublicUrl(animatedKey),
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
      videoRatio: null,
    });

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingAnimationApproval,
      subtitleTimeline,
      animationSpec: JSON.stringify(specs),
      animatedVideoAssetId: animAsset.id,
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
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingAnimationApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      animatedVideoAssetId: null,
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

  /** Staff approves the iAppTTS voice and triggers animation generation. */
  async approveVoiceConversion(
    jobId: string,
    staffId: string,
    selectedMusicTrack: string | null = null
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      voiceApprovedBy: staffId,
      selectedMusicTrack,
    });

    this._runAnimationGeneration(updated).catch(async (err) => {
      console.error("[AnimationGeneration] Failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingAnimations,
      });
    });

    return updated;
  }

  /** Requester approves iAppTTS voice, selects music + platforms, triggers animation generation. */
  async approveVoiceConversionByRequester(
    jobId: string,
    userId: string,
    targetPlatforms: Platform[],
    selectedMusicTrack: string | null = null
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

    const job = await this._getJob(jobId);

    // Save platform selection to request
    const { clipRequestRepository } = await import("@/repositories/index");
    await clipRequestRepository.update(job.requestId, { targetPlatforms });

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingAnimations,
      voiceApprovedBy: userId,
      selectedMusicTrack,
    });

    this._runAnimationGeneration(updated).catch(async (err) => {
      console.error("[AnimationGeneration] Failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingAnimations,
      });
    });

    return updated;
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
    // Prefer the animated video (with graphic overlays) over the raw base video
    const videoAssetId = job.animatedVideoAssetId ?? job.baseVideoAssetId;
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

    // Use pre-computed subtitle timeline from animation step if available; otherwise re-run alignment
    let assSubtitlesContent: string | undefined = undefined;
    let assSubtitlesContentTvent: string | undefined = undefined;
    const subtitleLanguages = job.subtitleLanguages && job.subtitleLanguages.length > 0
      ? job.subtitleLanguages
      : (["en", "zh"] as ("th" | "en" | "zh")[]);
    const needsTventExport = platforms.includes(Platform.TventApp);
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
    let coords: any = undefined;
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
      voice: VideoGenerationStep.AwaitingVoiceRecording,
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
   * Requester-triggered: skip the staff content-review gate and start Kling
   * directly using the AI analysis already shown to the requester.
   */
  async startFromRequesterApproval(
    requestId: string,
    requesterId: string,
    analysis: {
      scenePlan: string;
      scriptThai: string;
      scriptEnglish: string;
      hookThai: string;
      hookEnglish: string;
      captionThai: string;
      captionEnglish: string;
      captionChinese: string;
    }
  ): Promise<VideoGenerationJob> {
    const existing = await videoGenerationJobRepository.findByRequestId(requestId);

    // Job was pre-created by the analyze endpoint at AwaitingContentApproval.
    // Update it with the requester-approved (possibly edited) data and start Kling.
    if (existing?.currentStep === VideoGenerationStep.AwaitingContentApproval) {
      const updated = await videoGenerationJobRepository.update(existing.id, {
        currentStep: VideoGenerationStep.GeneratingBaseVideo,
        approvedScenePlan: analysis.scenePlan,
        approvedScriptThai: analysis.scriptThai,
        approvedScriptEnglish: analysis.scriptEnglish,
        approvedHookThai: analysis.hookThai,
        approvedHookEnglish: analysis.hookEnglish,
        approvedCaptionThai: analysis.captionThai,
        approvedCaptionEnglish: analysis.captionEnglish,
        approvedCaptionChinese: analysis.captionChinese,
        contentApprovedBy: requesterId,
      });
      try {
        await this._runKlingGeneration(updated);
      } catch (err) {
        console.error("Kling generation failed:", err);
        return videoGenerationJobRepository.update(existing.id, {
          status: VideoGenerationJobStatus.Failed,
          currentStep: VideoGenerationStep.Failed,
          failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
        });
      }
      return this._getJob(existing.id);
    }

    if (existing && existing.status === VideoGenerationJobStatus.Active) {
      throw new Error("An active pipeline already exists for this request");
    }

    const job = await videoGenerationJobRepository.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      scenePlan: analysis.scenePlan,
      scriptThai: analysis.scriptThai,
      scriptEnglish: analysis.scriptEnglish,
      scriptChinese: null,
      hookThai: analysis.hookThai,
      hookEnglish: analysis.hookEnglish,
      captionThai: analysis.captionThai,
      captionEnglish: analysis.captionEnglish,
      captionChinese: analysis.captionChinese,
      approvedScenePlan: analysis.scenePlan,
      approvedScriptThai: analysis.scriptThai,
      approvedScriptEnglish: analysis.scriptEnglish,
      approvedScriptChinese: null,
      approvedHookThai: analysis.hookThai,
      approvedHookEnglish: analysis.hookEnglish,
      approvedCaptionThai: analysis.captionThai,
      approvedCaptionEnglish: analysis.captionEnglish,
      approvedCaptionChinese: analysis.captionChinese,
      klingTaskId: null,
      klingStatus: null,
      klingLastPolledAt: null,
      baseVideoAssetId: null,
      ttsTaskId: null,
      rvcVoiceModel: "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      selectedMusicTrack: null,
      subtitleTimeline: null,
      animationSpec: null,
      animatedVideoAssetId: null,
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

    try {
      await this._runKlingGeneration(job);
    } catch (err) {
      console.error("Kling generation failed:", err);
      return videoGenerationJobRepository.update(job.id, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

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
        approvedScriptThai: editedContent.scriptThai,
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
          klingTaskId: null,
          baseVideoAssetId: null,
        });
        try {
          await this._runKlingGeneration(updated);
        } catch (err) {
          console.error("Kling retry failed:", err);
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

      case VideoGenerationStep.GeneratingAnimations: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.GeneratingAnimations,
          animatedVideoAssetId: null,
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

  /** Requester approves the Kling video and triggers iAppTTS voice generation automatically. */
  async approveBaseVideoByRequester(
    jobId: string,
    requesterId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingVoice,
      videoApprovedBy: requesterId,
    });

    this._runIAppTtsGeneration(updated).catch(async (err) => {
      console.error("[iAppTTS] Voice generation failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingVoice,
      });
    });

    return this._getJob(jobId);
  }

  /**
   * Requester requests a video revision with an updated script.
   * Saves edited approved fields and re-triggers Kling generation.
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

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.GeneratingBaseVideo,
      approvedScenePlan: editedContent.scenePlan,
      approvedHookThai: editedContent.hookThai,
      approvedScriptThai: editedContent.scriptThai,
      approvedCaptionThai: editedContent.captionThai,
      klingTaskId: null,
      baseVideoAssetId: null,
    });

    try {
      await this._runKlingGeneration(updated);
    } catch (err) {
      console.error("Kling regeneration failed:", err);
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
