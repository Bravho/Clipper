import { IUploadedAssetRepository } from "@/repositories/interfaces/IUploadedAssetRepository";
import {
  UploadedAsset,
  CreateUploadedAssetInput,
  UpdateUploadedAssetInput,
} from "@/domain/models/UploadedAsset";
import { SEED_UPLOADED_ASSETS } from "@/seed/requestSeedData";

// TODO: PostgreSQL — replace with PostgresUploadedAssetRepository.
//   When deleting, also trigger DigitalOcean Spaces object deletion via UploadService.

// TODO: DigitalOcean Spaces — update() is called after the presigned upload completes
//   to set storageKey and storageUrl from the DO Spaces response.

declare global {
  // eslint-disable-next-line no-var
  var __mockUploadedAssetStore: Map<string, UploadedAsset> | undefined;
}

function getStore(): Map<string, UploadedAsset> {
  if (!global.__mockUploadedAssetStore) {
    global.__mockUploadedAssetStore = new Map();
    SEED_UPLOADED_ASSETS.forEach((a) =>
      global.__mockUploadedAssetStore!.set(a.id, { ...a })
    );
  }
  return global.__mockUploadedAssetStore;
}

export class MockUploadedAssetRepository implements IUploadedAssetRepository {
  private store: Map<string, UploadedAsset>;

  constructor(store?: Map<string, UploadedAsset>) {
    this.store = store ?? getStore();
  }

  async findByRequestId(requestId: string): Promise<UploadedAsset[]> {
    return [...this.store.values()]
      .filter((a) => a.requestId === requestId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(id: string): Promise<UploadedAsset | null> {
    const asset = this.store.get(id);
    return asset ? { ...asset } : null;
  }

  async create(input: CreateUploadedAssetInput): Promise<UploadedAsset> {
    const asset: UploadedAsset = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(asset.id, asset);
    return { ...asset };
  }

  async update(
    id: string,
    input: UpdateUploadedAssetInput
  ): Promise<UploadedAsset> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`UploadedAsset not found: ${id}`);
    const updated: UploadedAsset = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return { ...updated };
  }

  async deleteByRequestId(requestId: string): Promise<void> {
    for (const [id, asset] of this.store.entries()) {
      if (asset.requestId === requestId) {
        this.store.delete(id);
      }
    }
  }

  async countByRequestId(requestId: string): Promise<number> {
    let count = 0;
    for (const asset of this.store.values()) {
      if (asset.requestId === requestId) count++;
    }
    return count;
  }
}
