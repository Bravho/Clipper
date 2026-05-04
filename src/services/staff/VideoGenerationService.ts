import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
  videoPublishRecordRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { AI_CONFIG } from "@/config/aiTools";
import { buildVoiceRecordingKey, buildTmpKey } from "@/lib/spacesKeys";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import * as klingService from "@/lib/ai/klingService";
import * as elevenLabsService from "@/lib/ai/elevenLabsService";
import * as ffmpegService from "@/lib/ai/ffmpegService";
import type { VideoGenerationJob, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { GenerateContentParams } from "@/lib/ai/chatGptVisionService";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Platform } from "@/domain/enums/Platform";

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
      elevenLabsVoiceId?: string;
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
      baseVideoAssetId: null,
      elevenLabsVoiceId: params.elevenLabsVoiceId ?? AI_CONFIG.elevenLabs.defaultVoiceId,
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
      scriptEnglish: output.scriptEnglish,
      hookThai: output.hookThai,
      hookEnglish: output.hookEnglish,
      captionThai: output.captionThai,
      captionEnglish: output.captionEnglish,
      captionChinese: output.captionChinese,
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

    // Trigger Kling asynchronously
    this._runKlingGeneration(updated).catch(async (err) => {
      console.error("Kling generation failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    });

    return updated;
  }

  private async _runKlingGeneration(job: VideoGenerationJob): Promise<void> {
    const request = await this._getClipRequestImages(job.requestId);
    const scenePlan = JSON.parse(job.approvedScenePlan!) as ScenePlan[];
    const scenePrompt = scenePlan.map((s) => s.visualDescription).join(" Then: ");
    const prompt =
      scenePrompt +
      " IMPORTANT: Do not fabricate or hallucinate final product visuals (e.g. finished dishes, packaged goods, retail displays) that are not present in the submitted source images. If the submitted images already show the final product, you may recreate or animate those faithfully. Only invent visuals for raw materials and ingredients. Fabricating final products that differ from the real item risks misrepresentation.";

    const taskId = await klingService.createVideo({
      imageUrls: request.imageUrls,
      prompt,
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

    if (status.status === "failed") {
      return videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    }

    if (status.status !== "succeed") return job;

    // Download from Kling and store in DO Spaces
    const request = await this._getClipRequestBasic(job.requestId);
    const { storageKey, storageUrl } = await klingService.downloadAndStore(
      status.videoUrl,
      request.userId,
      job.requestId
    );

    // Create UploadedAsset record
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: request.userId,
      fileName: "kling_generated.mp4",
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes: 0,
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

    this._runKlingGeneration(updated).catch(async (err) => {
      console.error("Kling regeneration failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
      });
    });

    return updated;
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
   * Confirm voice recording upload and trigger ElevenLabs conversion.
   */
  async confirmVoiceRecording(
    jobId: string,
    staffId: string,
    assetId: string
  ): Promise<VideoGenerationJob> {
    await this._getJobAtStep(jobId, VideoGenerationStep.AwaitingVoiceRecording);

    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Voice recording asset not found");

    const job = await this._getJob(jobId);
    const request = await this._getClipRequestBasic(job.requestId);

    // Move from tmp/ to voice_recordings/
    const voiceKey = buildVoiceRecordingKey(staffId, job.requestId, asset.fileName);
    await this._moveAssetInSpaces(asset.storageKey, voiceKey);

    await uploadedAssetRepository.update(assetId, {
      storageKey: voiceKey,
      storageUrl: spacesPublicUrl(voiceKey),
      uploadStatus: AssetUploadStatus.Uploaded,
    });

    const updated = await videoGenerationJobRepository.update(jobId, {
      currentStep: VideoGenerationStep.ProcessingVoice,
      voiceRecordingAssetId: assetId,
    });

    this._runVoiceConversion(updated, staffId).catch(async (err) => {
      console.error("ElevenLabs voice conversion failed:", err);
      await videoGenerationJobRepository.update(jobId, {
        status: VideoGenerationJobStatus.Failed,
        currentStep: VideoGenerationStep.Failed,
        failedAtStep: VideoGenerationStep.ProcessingVoice,
      });
    });

    return updated;
  }

  private async _runVoiceConversion(job: VideoGenerationJob, staffId: string): Promise<void> {
    const recordingAsset = await uploadedAssetRepository.findById(job.voiceRecordingAssetId!);
    if (!recordingAsset) throw new Error("Voice recording asset missing");

    const request = await this._getClipRequestBasic(job.requestId);

    const { storageKey, storageUrl } = await elevenLabsService.convertVoice({
      audioStorageKey: recordingAsset.storageKey,
      targetVoiceId: job.elevenLabsVoiceId,
      userId: request.userId,
      requestId: job.requestId,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const processedAsset = await uploadedAssetRepository.create({
      requestId: job.requestId,
      userId: staffId,
      fileName: "processed_voice.mp3",
      assetType: AssetType.ProcessedVoice,
      fileSizeBytes: 0,
      mimeType: "audio/mpeg",
      storageKey,
      storageUrl,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt,
    });

    await videoGenerationJobRepository.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingVoiceApproval,
      processedVoiceAssetId: processedAsset.id,
    });
  }

  /** Staff approves the ElevenLabs voice conversion and triggers FFmpeg. */
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

  /** Get the current pipeline job for a request. */
  async getCurrentJob(requestId: string): Promise<VideoGenerationJob | null> {
    return videoGenerationJobRepository.findByRequestId(requestId);
  }

  /**
   * Retry a failed pipeline step.
   * Restarts only from the step that actually failed — not from the beginning.
   */
  async retryPipeline(jobId: string): Promise<VideoGenerationJob> {
    const job = await this._getJob(jobId);
    if (job.currentStep !== VideoGenerationStep.Failed) {
      throw new Error("Can only retry a pipeline that is in Failed state");
    }

    const failedAt = job.failedAtStep ?? VideoGenerationStep.AnalyzingContent;

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
        this._runKlingGeneration(updated).catch(async (err) => {
          console.error("Kling retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.GeneratingBaseVideo,
          });
        });
        return updated;
      }

      case VideoGenerationStep.ProcessingVoice: {
        const updated = await videoGenerationJobRepository.update(jobId, {
          currentStep: VideoGenerationStep.ProcessingVoice,
          processedVoiceAssetId: null,
        });
        const staffId = job.voiceApprovedBy ?? job.contentApprovedBy ?? "";
        this._runVoiceConversion(updated, staffId).catch(async (err) => {
          console.error("ElevenLabs retry failed:", err);
          await videoGenerationJobRepository.update(jobId, {
            status: VideoGenerationJobStatus.Failed,
            currentStep: VideoGenerationStep.Failed,
            failedAtStep: VideoGenerationStep.ProcessingVoice,
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

  private async _getClipRequestImages(requestId: string): Promise<{ userId: string; imageUrls: string[] }> {
    const { clipRequestRepository } = await import("@/repositories/index");
    const req = await clipRequestRepository.findById(requestId);
    if (!req) throw new Error(`ClipRequest not found: ${requestId}`);

    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    const imageUrls = assets
      .filter((a) => a.assetType === AssetType.Image || a.assetType === AssetType.Video)
      .filter((a) => a.uploadStatus === AssetUploadStatus.Uploaded)
      .map((a) => a.storageUrl)
      .filter(Boolean);

    return { userId: req.userId, imageUrls };
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
