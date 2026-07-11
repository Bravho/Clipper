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
  /**
   * Find the watermarked-preview sibling of a clean FinalClip, if one has been
   * rendered. Used by the paywall to serve the watermarked variant while the
   * download is locked. Returns null when no watermarked preview exists.
   */
  findWatermarkedPreviewFor(sourceAssetId: string): Promise<UploadedAsset | null>;
  create(input: CreateUploadedAssetInput): Promise<UploadedAsset>;
  update(id: string, input: UpdateUploadedAssetInput): Promise<UploadedAsset>;
  deleteById(id: string): Promise<void>;
  deleteByRequestId(requestId: string): Promise<void>;
  countByRequestId(requestId: string): Promise<number>;
}
