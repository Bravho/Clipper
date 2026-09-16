import type { StudioStore } from "@/domain/models/Studio";

export type StudioPersistenceMode = "postgresql" | "local";

export interface StudioWorkspaceResult {
  store: StudioStore | null;
  persistence: StudioPersistenceMode;
  pendingSync: boolean;
}

export interface IStudioWorkspaceRepository {
  findByOwnerId(ownerId: string): Promise<StudioWorkspaceResult>;
  upsert(ownerId: string, data: StudioStore): Promise<StudioWorkspaceResult>;
}
