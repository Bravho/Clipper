import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
} from "@/domain/models/VideoGenerationJob";

export interface IVideoGenerationJobRepository {
  findById(id: string): Promise<VideoGenerationJob | null>;
  findByRequestId(requestId: string): Promise<VideoGenerationJob | null>;
  create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob>;
  update(id: string, input: UpdateVideoGenerationJobInput): Promise<VideoGenerationJob>;
}
