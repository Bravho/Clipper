import {
  videoGenerationJobRepository,
  videoPublishRecordRepository,
  uploadedAssetRepository,
} from "@/repositories/index";
import { Platform } from "@/domain/enums/Platform";
import { PublishStatus } from "@/domain/enums/PublishStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { VideoPublishRecord } from "@/domain/models/VideoPublishRecord";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import * as youtubeService from "@/lib/social/youtubeService";
import * as tiktokService from "@/lib/social/tiktokService";
import * as instagramService from "@/lib/social/instagramService";
import * as facebookService from "@/lib/social/facebookService";
import * as tventService from "@/lib/social/tventService";
import { videoGenerationService } from "./VideoGenerationService";

/** The asset ratio to use when uploading to each platform. */
const PLATFORM_RATIO: Record<Platform, "9:16" | "16:9" | "1:1" | "4:5" | null> = {
  [Platform.YouTube]:   "16:9",
  [Platform.TikTok]:    "9:16",
  [Platform.Instagram]: "9:16",
  [Platform.Facebook]:  "4:5",
  [Platform.TventApp]:  "9:16",
  [Platform.CDN]:       null,
};

/** The default caption language to pre-populate per platform. */
export type PlatformCaptionKey = "captionThai" | "captionEnglish" | "captionChinese";

const PLATFORM_DEFAULT_CAPTION: Record<Platform, PlatformCaptionKey | null> = {
  [Platform.YouTube]:   "captionEnglish",
  [Platform.TikTok]:    "captionEnglish",
  [Platform.Instagram]: "captionEnglish",
  [Platform.Facebook]:  "captionThai",
  [Platform.TventApp]:  "captionThai",
  [Platform.CDN]:       null,
};

export interface PublishStatusView {
  records: VideoPublishRecord[];
  isYouTubePublished: boolean;
  defaultCaptions: Record<Platform, string | null>;
}

export class VideoPublishingService {
  /**
   * Publish the final video to one platform.
   * Enforces that YouTube must be published before Tvent.
   */
  async publishToPlatform(
    jobId: string,
    staffId: string,
    platform: Platform,
    caption: string
  ): Promise<VideoPublishRecord> {
    const job = await this._getJobAtPublishing(jobId);

    // Tvent requires YouTube to be published first
    if (platform === Platform.TventApp) {
      const ytRecord = await videoPublishRecordRepository.findByJobIdAndPlatform(
        jobId,
        Platform.YouTube
      );
      if (!ytRecord || ytRecord.status !== PublishStatus.Published) {
        throw new Error("YouTube must be published before publishing to Tvent");
      }
    }

    // Upsert the publish record as Publishing
    const existing = await videoPublishRecordRepository.findByJobIdAndPlatform(jobId, platform);
    let record: VideoPublishRecord;

    if (existing) {
      record = await videoPublishRecordRepository.update(existing.id, {
        status: PublishStatus.Publishing,
        errorMessage: null,
        publishedAt: null,
      });
    } else {
      record = await videoPublishRecordRepository.create({
        jobId,
        platform,
        status: PublishStatus.Publishing,
        platformVideoId: null,
        platformUrl: null,
        captionUsed: caption,
        publishedBy: staffId,
        publishedAt: null,
        errorMessage: null,
      });
    }

    try {
      const result = await this._callPlatformApi(job, platform, caption);

      record = await videoPublishRecordRepository.update(record.id, {
        status: PublishStatus.Published,
        platformVideoId: result.platformVideoId,
        platformUrl: result.platformUrl,
        captionUsed: caption,
        publishedAt: new Date(),
        errorMessage: null,
      });

      // Check if all target platforms are now published and mark job complete
      await this._checkAndMarkComplete(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record = await videoPublishRecordRepository.update(record.id, {
        status: PublishStatus.Failed,
        errorMessage: message,
      });
    }

    return record;
  }

  /** Get publish status for all platforms for a job. */
  async getPublishStatus(jobId: string): Promise<PublishStatusView> {
    const job = await videoGenerationJobRepository.findById(jobId);
    if (!job) throw new Error(`VideoGenerationJob not found: ${jobId}`);

    const records = await videoPublishRecordRepository.findByJobId(jobId);
    const isYouTubePublished = records.some(
      (r) => r.platform === Platform.YouTube && r.status === PublishStatus.Published
    );

    // Build default captions from approved caption fields
    const defaultCaptions: Record<Platform, string | null> = {} as Record<Platform, string | null>;
    for (const platform of Object.values(Platform)) {
      const captionKey = PLATFORM_DEFAULT_CAPTION[platform];
      if (!captionKey) {
        defaultCaptions[platform] = null;
        continue;
      }
      defaultCaptions[platform] = job[captionKey] ?? null;
    }

    return { records, isYouTubePublished, defaultCaptions };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _getJobAtPublishing(jobId: string): Promise<VideoGenerationJob> {
    const job = await videoGenerationJobRepository.findById(jobId);
    if (!job) throw new Error(`VideoGenerationJob not found: ${jobId}`);
    if (job.currentStep !== VideoGenerationStep.Publishing) {
      throw new Error(`Job is not in Publishing step (currently: ${job.currentStep})`);
    }
    return job;
  }

  private async _callPlatformApi(
    job: VideoGenerationJob,
    platform: Platform,
    caption: string
  ): Promise<{ platformVideoId: string; platformUrl: string }> {
    const ratio = PLATFORM_RATIO[platform];

    if (platform === Platform.TventApp) {
      // Tvent uses the YouTube URL — get it from the published YouTube record
      const ytRecord = await videoPublishRecordRepository.findByJobIdAndPlatform(
        job.id,
        Platform.YouTube
      );
      if (!ytRecord?.platformUrl) throw new Error("YouTube URL not available for Tvent");
      return tventService.uploadVideo({
        youtubeUrl: ytRecord.platformUrl,
        title: caption.split("\n")[0].slice(0, 100),
        description: caption,
      });
    }

    if (platform === Platform.CDN) {
      // CDN link is just the direct storage URL — no upload needed
      const assetId = job.finalExport_16_9_assetId;
      if (!assetId) throw new Error("No 16:9 export available for CDN");
      const asset = await uploadedAssetRepository.findById(assetId);
      if (!asset) throw new Error("CDN asset not found");
      return { platformVideoId: asset.id, platformUrl: asset.storageUrl };
    }

    const assetId = this._getAssetIdForRatio(job, ratio!);
    if (!assetId) throw new Error(`No export asset found for ratio ${ratio}`);
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);

    switch (platform) {
      case Platform.YouTube:
        return youtubeService.uploadVideo({
          videoStorageKey: asset.storageKey,
          title: caption.split("\n")[0].slice(0, 100),
          description: caption,
        });
      case Platform.TikTok:
        return tiktokService.uploadVideo({
          videoStorageKey: asset.storageKey,
          title: caption.split("\n")[0].slice(0, 150),
          description: caption,
        });
      case Platform.Instagram:
        return instagramService.uploadVideo({
          videoStorageKey: asset.storageKey,
          caption,
        });
      case Platform.Facebook:
        return facebookService.uploadVideo({
          videoStorageKey: asset.storageKey,
          description: caption,
        });
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  private _getAssetIdForRatio(
    job: VideoGenerationJob,
    ratio: "9:16" | "16:9" | "1:1" | "4:5"
  ): string | null {
    switch (ratio) {
      case "9:16":  return job.finalExport_9_16_assetId;
      case "16:9":  return job.finalExport_16_9_assetId;
      case "1:1":   return job.finalExport_1_1_assetId;
      case "4:5":   return job.finalExport_4_5_assetId;
    }
  }

  private async _checkAndMarkComplete(job: VideoGenerationJob): Promise<void> {
    const records = await videoPublishRecordRepository.findByJobId(job.id);
    const allPublished = records.every((r) => r.status === PublishStatus.Published);
    if (allPublished && records.length > 0) {
      await videoGenerationService.markComplete(job.id);
    }
  }
}

export const videoPublishingService = new VideoPublishingService();
