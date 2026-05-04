import { IVideoPublishRecordRepository } from "@/repositories/interfaces/IVideoPublishRecordRepository";
import {
  VideoPublishRecord,
  CreateVideoPublishRecordInput,
  UpdateVideoPublishRecordInput,
} from "@/domain/models/VideoPublishRecord";
import { Platform } from "@/domain/enums/Platform";

// TODO: PostgreSQL — replace this entire class with PostgresVideoPublishRecordRepository.

declare global {
  // eslint-disable-next-line no-var
  var __mockVideoPublishRecordStore: Map<string, VideoPublishRecord> | undefined;
}

function getStore(): Map<string, VideoPublishRecord> {
  if (!global.__mockVideoPublishRecordStore) {
    global.__mockVideoPublishRecordStore = new Map();
  }
  return global.__mockVideoPublishRecordStore;
}

export class MockVideoPublishRecordRepository
  implements IVideoPublishRecordRepository
{
  private store: Map<string, VideoPublishRecord>;

  constructor(store?: Map<string, VideoPublishRecord>) {
    this.store = store ?? getStore();
  }

  async findByJobId(jobId: string): Promise<VideoPublishRecord[]> {
    return [...this.store.values()].filter((r) => r.jobId === jobId);
  }

  async findByJobIdAndPlatform(
    jobId: string,
    platform: Platform
  ): Promise<VideoPublishRecord | null> {
    for (const record of this.store.values()) {
      if (record.jobId === jobId && record.platform === platform) {
        return { ...record };
      }
    }
    return null;
  }

  async create(input: CreateVideoPublishRecordInput): Promise<VideoPublishRecord> {
    const now = new Date();
    const record: VideoPublishRecord = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return { ...record };
  }

  async update(
    id: string,
    input: UpdateVideoPublishRecordInput
  ): Promise<VideoPublishRecord> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`VideoPublishRecord not found: ${id}`);
    const updated: VideoPublishRecord = {
      ...existing,
      ...input,
      id,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }
}
