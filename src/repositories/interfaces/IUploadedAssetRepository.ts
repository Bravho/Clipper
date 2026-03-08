import {
  UploadedAsset,
  CreateUploadedAssetInput,
  UpdateUploadedAssetInput,
} from "@/domain/models/UploadedAsset";

/**
 * Repository contract for UploadedAsset persistence.
 *
 * TODO: PostgreSQL — implement PostgresUploadedAssetRepository.
 *   Index on request_id for efficient asset lookups per request.
 *   When deleting assets, also trigger DigitalOcean Spaces object deletion.
 *
 * TODO: DigitalOcean Spaces — the update() method will be called after the
 *   presigned upload completes to set storageKey and storageUrl.
 */
export interface IUploadedAssetRepository {
  findByRequestId(requestId: string): Promise<UploadedAsset[]>;
  findById(id: string): Promise<UploadedAsset | null>;
  create(input: CreateUploadedAssetInput): Promise<UploadedAsset>;
  update(id: string, input: UpdateUploadedAssetInput): Promise<UploadedAsset>;
  deleteByRequestId(requestId: string): Promise<void>;
  countByRequestId(requestId: string): Promise<number>;
}
