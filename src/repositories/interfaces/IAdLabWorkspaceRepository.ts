import type { AdLabStore } from "@/domain/models/AdLab";

export type AdLabPersistenceMode = "postgresql" | "local";

export interface AdLabWorkspaceResult {
  store: AdLabStore | null;
  persistence: AdLabPersistenceMode;
  pendingSync: boolean;
}

export interface IAdLabWorkspaceRepository {
  findByOwnerId(ownerId: string): Promise<AdLabWorkspaceResult>;
  upsert(ownerId: string, data: AdLabStore): Promise<AdLabWorkspaceResult>;
}
