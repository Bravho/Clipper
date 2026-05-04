import {
  videoGenerationJobRepository,
  uploadedAssetRepository,
  videoPublishRecordRepository,
} from "@/repositories/index";
import { VideoGenerationStep, PIPELINE_STEP_LABELS, POLLING_STEPS } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { PublishStatus } from "@/domain/enums/PublishStatus";
import { Platform, PLATFORM_LABELS } from "@/domain/enums/Platform";
import type { VideoGenerationJob, ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { VideoPublishRecord } from "@/domain/models/VideoPublishRecord";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";
import type { PlatformCaptionKey } from "./VideoPublishingService";

export interface ResolvedAssets {
  baseVideo: UploadedAsset | null;
  voiceRecording: UploadedAsset | null;
  processedVoice: UploadedAsset | null;
  finalExports: {
    "9:16": UploadedAsset | null;
    "16:9": UploadedAsset | null;
    "1:1": UploadedAsset | null;
    "4:5": UploadedAsset | null;
  };
}

export interface PipelineStepInfo {
  step: VideoGenerationStep;
  label: string;
  isCurrentStep: boolean;
  isCompleted: boolean;
  isPolling: boolean;
}

export interface PlatformPublishView {
  platform: Platform;
  label: string;
  record: VideoPublishRecord | null;
  isLocked: boolean;
  lockReason: string | null;
  defaultCaption: string | null;
  videoRatio: "9:16" | "16:9" | "1:1" | "4:5" | null;
}

export interface StaffPipelineView {
  job: VideoGenerationJob;
  scenePlanParsed: ScenePlan[];
  resolvedAssets: ResolvedAssets;
  stepProgress: PipelineStepInfo[];
  publishViews: PlatformPublishView[];
  isPolling: boolean;
}

const STEP_ORDER: VideoGenerationStep[] = [
  VideoGenerationStep.AnalyzingContent,
  VideoGenerationStep.AwaitingContentApproval,
  VideoGenerationStep.GeneratingBaseVideo,
  VideoGenerationStep.AwaitingVideoApproval,
  VideoGenerationStep.AwaitingVoiceRecording,
  VideoGenerationStep.ProcessingVoice,
  VideoGenerationStep.AwaitingVoiceApproval,
  VideoGenerationStep.ComposingFinalVideo,
  VideoGenerationStep.AwaitingFinalApproval,
  VideoGenerationStep.Publishing,
  VideoGenerationStep.Complete,
];

const PLATFORM_RATIO: Record<Platform, "9:16" | "16:9" | "1:1" | "4:5" | null> = {
  [Platform.YouTube]:   "16:9",
  [Platform.TikTok]:    "9:16",
  [Platform.Instagram]: "9:16",
  [Platform.Facebook]:  "4:5",
  [Platform.TventApp]:  "9:16",
  [Platform.CDN]:       null,
};

const PLATFORM_DEFAULT_CAPTION: Record<Platform, PlatformCaptionKey | null> = {
  [Platform.YouTube]:   "captionEnglish",
  [Platform.TikTok]:    "captionEnglish",
  [Platform.Instagram]: "captionEnglish",
  [Platform.Facebook]:  "captionThai",
  [Platform.TventApp]:  "captionThai",
  [Platform.CDN]:       null,
};

const PUBLISHABLE_PLATFORMS: Platform[] = [
  Platform.YouTube,
  Platform.TikTok,
  Platform.Instagram,
  Platform.Facebook,
  Platform.TventApp,
];

export class VideoPipelinePresentationService {
  async getStaffPipelineView(requestId: string): Promise<StaffPipelineView | null> {
    const job = await videoGenerationJobRepository.findByRequestId(requestId);
    if (!job) return null;

    const [resolvedAssets, publishRecords] = await Promise.all([
      this._resolveAssets(job),
      videoPublishRecordRepository.findByJobId(job.id),
    ]);

    const scenePlanParsed = this._parseScenePlan(job.approvedScenePlan ?? job.scenePlan);
    const stepProgress = this._buildStepProgress(job.currentStep);
    const publishViews = this._buildPublishViews(job, publishRecords);
    const isPolling = POLLING_STEPS.includes(job.currentStep);

    return {
      job,
      scenePlanParsed,
      resolvedAssets,
      stepProgress,
      publishViews,
      isPolling,
    };
  }

  private async _resolveAssets(job: VideoGenerationJob): Promise<ResolvedAssets> {
    const assetIds = [
      job.baseVideoAssetId,
      job.voiceRecordingAssetId,
      job.processedVoiceAssetId,
      job.finalExport_9_16_assetId,
      job.finalExport_16_9_assetId,
      job.finalExport_1_1_assetId,
      job.finalExport_4_5_assetId,
    ].filter(Boolean) as string[];

    const fetched = await Promise.all(
      assetIds.map((id) => uploadedAssetRepository.findById(id))
    );

    const assetMap = new Map<string, UploadedAsset>();
    for (const asset of fetched) {
      if (asset) assetMap.set(asset.id, asset);
    }

    return {
      baseVideo: job.baseVideoAssetId ? assetMap.get(job.baseVideoAssetId) ?? null : null,
      voiceRecording: job.voiceRecordingAssetId ? assetMap.get(job.voiceRecordingAssetId) ?? null : null,
      processedVoice: job.processedVoiceAssetId ? assetMap.get(job.processedVoiceAssetId) ?? null : null,
      finalExports: {
        "9:16": job.finalExport_9_16_assetId ? assetMap.get(job.finalExport_9_16_assetId) ?? null : null,
        "16:9": job.finalExport_16_9_assetId ? assetMap.get(job.finalExport_16_9_assetId) ?? null : null,
        "1:1": job.finalExport_1_1_assetId ? assetMap.get(job.finalExport_1_1_assetId) ?? null : null,
        "4:5": job.finalExport_4_5_assetId ? assetMap.get(job.finalExport_4_5_assetId) ?? null : null,
      },
    };
  }

  private _parseScenePlan(raw: string | null): ScenePlan[] {
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ScenePlan[];
    } catch {
      return [];
    }
  }

  private _buildStepProgress(currentStep: VideoGenerationStep): PipelineStepInfo[] {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    return STEP_ORDER.map((step, index) => ({
      step,
      label: PIPELINE_STEP_LABELS[step],
      isCurrentStep: step === currentStep,
      isCompleted: index < currentIndex,
      isPolling: POLLING_STEPS.includes(step) && step === currentStep,
    }));
  }

  private _buildPublishViews(
    job: VideoGenerationJob,
    records: VideoPublishRecord[]
  ): PlatformPublishView[] {
    const recordMap = new Map(records.map((r) => [r.platform, r]));
    const isYouTubePublished = recordMap.get(Platform.YouTube)?.status === PublishStatus.Published;

    return PUBLISHABLE_PLATFORMS.map((platform) => {
      const captionKey = PLATFORM_DEFAULT_CAPTION[platform];
      const defaultCaption = captionKey ? (job[captionKey as keyof VideoGenerationJob] as string | null ?? null) : null;

      const isLocked = platform === Platform.TventApp && !isYouTubePublished;
      const lockReason = isLocked ? "YouTube must be published first to obtain the video link for Tvent." : null;

      return {
        platform,
        label: PLATFORM_LABELS[platform],
        record: recordMap.get(platform) ?? null,
        isLocked,
        lockReason,
        defaultCaption,
        videoRatio: PLATFORM_RATIO[platform],
      };
    });
  }
}

export const videoPipelinePresentationService = new VideoPipelinePresentationService();
