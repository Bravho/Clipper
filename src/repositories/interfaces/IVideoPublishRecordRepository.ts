import { Platform } from "@/domain/enums/Platform";
import {
  VideoPublishRecord,
  CreateVideoPublishRecordInput,
  UpdateVideoPublishRecordInput,
} from "@/domain/models/VideoPublishRecord";

export interface IVideoPublishRecordRepository {
  findByJobId(jobId: string): Promise<VideoPublishRecord[]>;
  findByJobIdAndPlatform(
    jobId: string,
    platform: Platform
  ): Promise<VideoPublishRecord | null>;
  create(input: CreateVideoPublishRecordInput): Promise<VideoPublishRecord>;
  update(id: string, input: UpdateVideoPublishRecordInput): Promise<VideoPublishRecord>;
}
