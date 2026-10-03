import type { AdLabStore } from "@/domain/models/AdLab";
import type { IAdLabWorkspaceRepository, AdLabWorkspaceResult } from "./interfaces/IAdLabWorkspaceRepository";
import { LocalAdLabWorkspaceRepository } from "./local/LocalAdLabWorkspaceRepository";
import { PostgresAdLabWorkspaceRepository } from "./postgres/PostgresAdLabWorkspaceRepository";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";

/** Offline-first Ad Lab persistence with explicit, command-driven cloud sync. */
export class HybridAdLabWorkspaceRepository implements IAdLabWorkspaceRepository {
  constructor(
    private readonly local = new LocalAdLabWorkspaceRepository(undefined, true),
    private readonly cloud = new PostgresAdLabWorkspaceRepository()
  ) {}

  async findByOwnerId(ownerId: string): Promise<AdLabWorkspaceResult> {
    const localResult = await this.local.findByOwnerId(ownerId);
    if (localResult.store) {
      return localResult.pendingSync
        ? localResult
        : { ...localResult, persistence: "postgresql" };
    }

    // A new computer may have no local cache yet. It may read an existing cloud
    // workspace once, but pending local changes are never uploaded implicitly.
    try {
      const cloudResult = await this.cloud.findByOwnerId(ownerId);
      if (cloudResult.store) await this.local.cacheFromPostgres(ownerId, cloudResult.store);
      return cloudResult;
    } catch (error) {
      if (!isTransientPostgresConnectionError(error)) throw error;
      return localResult;
    }
  }

  async upsert(ownerId: string, data: AdLabStore): Promise<AdLabWorkspaceResult> {
    return this.local.upsert(ownerId, data);
  }
}
