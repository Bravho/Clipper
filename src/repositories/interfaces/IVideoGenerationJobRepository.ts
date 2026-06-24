import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";

export interface IVideoGenerationJobRepository {
  findById(id: string): Promise<VideoGenerationJob | null>;
  findByRequestId(requestId: string): Promise<VideoGenerationJob | null>;
  create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob>;
  update(id: string, input: UpdateVideoGenerationJobInput): Promise<VideoGenerationJob>;
  /** Immutable audit log of every pipeline step the job entered, oldest first. */
  listStepHistory(jobId: string): Promise<VideoGenerationStepHistoryEntry[]>;
}
