import { Platform } from "@/domain/enums/Platform";
import { PublishStatus } from "@/domain/enums/PublishStatus";

/**
 * Records the outcome of publishing a final clip to one social media platform.
 *
 * One record per (job, platform) pair. Re-publishing overwrites the existing record.
 *
 * TODO: PostgreSQL — map to `video_publish_records` table.
 */
export interface VideoPublishRecord {
  id: string;
  jobId: string;
  platform: Platform;
  status: PublishStatus;
  /** The platform's internal video identifier after a successful upload. */
  platformVideoId: string | null;
  /** Public URL of the video on the platform. Used by Tvent to embed the YouTube link. */
  platformUrl: string | null;
  /** Caption text submitted with the video (may differ from AI-generated captions). */
  captionUsed: string | null;
  /** Staff user ID who triggered the publish. */
  publishedBy: string;
  publishedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateVideoPublishRecordInput = Omit<
  VideoPublishRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateVideoPublishRecordInput = Partial<
  Pick<
    VideoPublishRecord,
    "status" | "platformVideoId" | "platformUrl" | "captionUsed" | "publishedAt" | "errorMessage"
  >
>;
