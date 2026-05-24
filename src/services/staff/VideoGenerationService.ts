import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
  videoPublishRecordRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { buildVoiceRecordingKey, buildTmpKey } from "@/lib/spacesKeys";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import * as klingService from "@/lib/ai/klingService";
import * as ffmpegService from "@/lib/ai/ffmpegService";
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
      hookThai: null,
      hookEnglish: null,
      captionThai: null,
      captionEnglish: null,
      captionChinese: null,
      approvedScenePlan: null,
      approvedScriptThai: null,
      approvedScriptEnglish: null,
      approvedHookThai: null,
      approvedHookEnglish: null,
      approvedCaptionThai: null,
      approvedCaptionEnglish: null,
      approvedCaptionChinese: null,
      klingTaskId: null,
      klingStatus: null,
      klingLastPolledAt: null,
      baseVideoAssetId: null,
      rvcVoiceModel: params.rvcVoiceModel ?? "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
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
    const output = await chatGptVisionService.generateScenePlanAndScript({
      ...params,
      videoDurationSeconds: 15,
    });

    await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingContentApproval,
      scenePlan: JSON.stringify(output.scenePlan),
      scriptThai: output.scriptThai,
      hookThai: output.hookThai,
      captionThai: output.captionThai,
    });
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

  /** Staff approves the Kling video and advances to voice recording. */
  async approveBaseVideo(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingVoiceRecording,
      videoApprovedBy: staffId,
    });
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

  /**
   * Create a presigned URL for staff to upload their voice recording.
   * Returns the asset ID and presigned PUT URL.
   */
  async createVoiceRecordingUpload(
    jobId: string,
    staffId: string,
    fileName: string,
    fileSizeBytes: number,
    mimeType: string
  ): Promise<{ assetId: string; presignedUrl: string; storageKey: string }> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceRecording);

    const job = await this._getJob(jobId);
    const request = await this._getClipRequestBasic(job.requestId);

    const storageKey = buildTmpKey(staffId, job.requestId, fileName);
    const bucket = process.env.DO_SPACES_BUCKET!;

    const presignedUrl = await getSignedUrl(
      spacesClient,
      new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: mimeType }),
      { expiresIn: PRESIGNED_TTL }
    );

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: staffId,
      fileName,
      assetType: AssetType.StaffVoiceRecording,
      fileSizeBytes,
      mimeType,
      storageKey,
      storageUrl: "",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Pending,
      scheduledDeletionAt,
    });

    return { assetId: asset.id, presignedUrl, storageKey };
  }

  /**
   * Confirm voice recording upload.
   * The requester's browser sends audio directly to the RVC Mac Mini and uploads
   * the already-converted WAV, so no server-side conversion is needed here.
   * Advances directly to AwaitingVoiceApproval.
   */
  async confirmVoiceRecording(
    jobId: string,
    userId: string,
    assetId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceRecording);

    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Voice recording asset not found");

    const job = await this._getJob(jobId);

    // Move from tmp/ to voice_recordings/
    const voiceKey = buildVoiceRecordingKey(userId, job.requestId, asset.fileName);
    await this._moveAssetInSpaces(asset.storageKey, voiceKey);

    await uploadedAssetRepository.update(assetId, {
      storageKey: voiceKey,
      storageUrl: spacesPublicUrl(voiceKey),
      uploadStatus: AssetUploadStatus.Uploaded,
    });

    // RVC conversion was done in the requester's browser — the uploaded asset
    // is already the converted audio. Both IDs point to the same asset.
    return videoGenerationJobRepository.update(jobId, {
      currentStep:           VideoGenerationStep.AwaitingVoiceApproval,
      voiceRecordingAssetId: assetId,
      processedVoiceAssetId: assetId,
    });
  }

  /** Staff approves the RVC voice conversion and triggers FFmpeg. */
  async approveVoiceConversion(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.ComposingFinalVideo,
      voiceApprovedBy: staffId,
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

  /** Staff rejects the voice conversion and goes back to re-recording. */
  async rejectVoiceConversion(
    jobId: string,
    staffId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingVoiceRecording,
      processedVoiceAssetId: null,
    });
  }

  private async _runFFmpegComposition(job: VideoGenerationJob): Promise<void> {
    const [videoAsset, audioAsset] = await Promise.all([
      uploadedAssetRepository.findById(job.baseVideoAssetId!),
      uploadedAssetRepository.findById(job.processedVoiceAssetId!),
    ]);
    if (!videoAsset || !audioAsset) throw new Error("Required assets missing for composition");

    const request = await this._getClipRequestBasic(job.requestId);

    const result = await ffmpegService.composeAndExport({
      videoStorageKey: videoAsset.storageKey,
      audioStorageKey: audioAsset.storageKey,
      scriptThai: job.approvedScriptThai!,
      scriptEnglish: job.approvedScriptEnglish!,
      hookThai: job.approvedHookThai!,
      userId: request.userId,
      requestId: job.requestId,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const ratios = ["9:16", "16:9", "1:1", "4:5"] as const;
    const assetIds: Record<string, string> = {};

    for (const ratio of ratios) {
      const { storageKey, storageUrl } = result.exports[ratio];
      const asset = await uploadedAssetRepository.create({
        requestId: job.requestId,
        userId: request.userId,
        fileName: `final_${ratio.replace(":", "-")}.mp4`,
        assetType: AssetType.FinalClip,
        fileSizeBytes: 0,
        mimeType: "video/mp4",
        storageKey,
        storageUrl,
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt,
        videoRatio: ratio,
      });
      assetIds[ratio] = asset.id;
    }

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingFinalApproval,
      finalExport_9_16_assetId: assetIds["9:16"],
      finalExport_16_9_assetId: assetIds["16:9"],
      finalExport_1_1_assetId: assetIds["1:1"],
      finalExport_4_5_assetId: assetIds["4:5"],
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
      hookThai: analysis.hookThai,
      hookEnglish: analysis.hookEnglish,
      captionThai: analysis.captionThai,
      captionEnglish: analysis.captionEnglish,
      captionChinese: analysis.captionChinese,
      approvedScenePlan: analysis.scenePlan,
      approvedScriptThai: analysis.scriptThai,
      approvedScriptEnglish: analysis.scriptEnglish,
      approvedHookThai: analysis.hookThai,
      approvedHookEnglish: analysis.hookEnglish,
      approvedCaptionThai: analysis.captionThai,
      approvedCaptionEnglish: analysis.captionEnglish,
      approvedCaptionChinese: analysis.captionChinese,
      klingTaskId: null,
      klingStatus: null,
      klingLastPolledAt: null,
      baseVideoAssetId: null,
      rvcVoiceModel: "",
      voiceRecordingAssetId: null,
      processedVoiceAssetId: null,
      finalExport_9_16_assetId: null,
      finalExport_16_9_assetId: null,
      finalExport_1_1_assetId: null,
      finalExport_4_5_assetId: null,
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

  /** Requester approves the Kling video and advances to voice recording. */
  async approveBaseVideoByRequester(
    jobId: string,
    requesterId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVideoApproval);
    return videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.AwaitingVoiceRecording,
      videoApprovedBy: requesterId,
    });
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
    // Import lazily to avoid circular dependencies
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
    // Guard against legacy in-memory records that pre-date the durationSeconds field.
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
