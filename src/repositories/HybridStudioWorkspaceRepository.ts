import type { StudioStore } from "@/domain/models/Studio";
import type { IStudioWorkspaceRepository, StudioWorkspaceResult } from "./interfaces/IStudioWorkspaceRepository";
import { LocalStudioWorkspaceRepository } from "./local/LocalStudioWorkspaceRepository";
import { PostgresStudioWorkspaceRepository } from "./postgres/PostgresStudioWorkspaceRepository";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";

/** Offline-first Studio persistence with explicit, command-driven cloud sync. */
export class HybridStudioWorkspaceRepository implements IStudioWorkspaceRepository {
  constructor(
    private readonly local = new LocalStudioWorkspaceRepository(undefined, true),
    private readonly cloud = new PostgresStudioWorkspaceRepository()
  ) {}

  async findByOwnerId(ownerId: string): Promise<StudioWorkspaceResult> {
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

  async upsert(ownerId: string, data: StudioStore): Promise<StudioWorkspaceResult> {
    return this.local.upsert(ownerId, data);
  }
}
