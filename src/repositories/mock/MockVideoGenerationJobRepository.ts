import { IVideoGenerationJobRepository } from "@/repositories/interfaces/IVideoGenerationJobRepository";
import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
} from "@/domain/models/VideoGenerationJob";

// TODO: PostgreSQL — replace this entire class with PostgresVideoGenerationJobRepository.

declare global {
  // eslint-disable-next-line no-var
  var __mockVideoGenerationJobStore: Map<string, VideoGenerationJob> | undefined;
}

function getStore(): Map<string, VideoGenerationJob> {
  if (!global.__mockVideoGenerationJobStore) {
    global.__mockVideoGenerationJobStore = new Map();
  }
  return global.__mockVideoGenerationJobStore;
}

export class MockVideoGenerationJobRepository
  implements IVideoGenerationJobRepository
{
  private store: Map<string, VideoGenerationJob>;

  constructor(store?: Map<string, VideoGenerationJob>) {
    this.store = store ?? getStore();
  }

  async findById(id: string): Promise<VideoGenerationJob | null> {
    return this.store.has(id) ? { ...this.store.get(id)! } : null;
  }

  async findByRequestId(requestId: string): Promise<VideoGenerationJob | null> {
    for (const job of this.store.values()) {
      if (job.requestId === requestId) return { ...job };
    }
    return null;
  }

  async create(input: CreateVideoGenerationJobInput): Promise<VideoGenerationJob> {
    const now = new Date();
    const job: VideoGenerationJob = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(job.id, job);
    return { ...job };
  }

  async update(
    id: string,
    input: UpdateVideoGenerationJobInput
  ): Promise<VideoGenerationJob> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`VideoGenerationJob not found: ${id}`);
    const updated: VideoGenerationJob = {
      ...existing,
      ...input,
      id,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }
}
