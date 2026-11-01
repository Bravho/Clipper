import type { StoryboardVersion, NewStoryboardVersion } from '@/domain/models/StoryboardVersion';
export interface IStoryboardVersionRepository {
  get(id: string): Promise<StoryboardVersion | null>;
  latest(requestId: string): Promise<StoryboardVersion | null>;
  /** Append under a request lock. Parent must be current; revisions debit atomically. */
  append(input: NewStoryboardVersion, consumeRevision?: boolean): Promise<StoryboardVersion>;
  linkDelivery(requestId: string, versionId: string, assetIds: string[]): Promise<void>;
}
