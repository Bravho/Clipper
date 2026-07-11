import { IUploadedAssetRepository } from "@/repositories/interfaces/IUploadedAssetRepository";
import {
  UploadedAsset,
  CreateUploadedAssetInput,
  UpdateUploadedAssetInput,
} from "@/domain/models/UploadedAsset";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { pool } from "@/lib/db";

function rowToAsset(row: Record<string, unknown>): UploadedAsset {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    userId: row.user_id as string,
    fileName: row.file_name as string,
    assetType: row.asset_type as AssetType,
    // Postgres returns BIGINT/NUMERIC as a string — coerce to a real number so
    // arithmetic (e.g. summing upload sizes) adds instead of string-concatenating.
    fileSizeBytes: Number(row.file_size_bytes ?? 0),
    mimeType: row.mime_type as string,
    storageKey: row.storage_key as string,
    storageUrl: row.storage_url as string,
    thumbnailKey: (row.thumbnail_key as string) ?? "",
    thumbnailUrl: (row.thumbnail_url as string) ?? "",
    uploadStatus: row.upload_status as AssetUploadStatus,
    // NUMERIC comes back as a string — coerce to a real number (or null).
    durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    videoRatio: (row.video_ratio as UploadedAsset["videoRatio"]) ?? null,
    sourceAssetId: (row.source_asset_id as string) ?? null,
    scheduledDeletionAt: new Date(row.scheduled_deletion_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresUploadedAssetRepository
  implements IUploadedAssetRepository
{
  constructor(private db = pool) {}

  async findByRequestId(requestId: string): Promise<UploadedAsset[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM uploaded_assets WHERE request_id = $1 ORDER BY created_at ASC",
      [requestId]
    );
    return rows.map(rowToAsset);
  }

  async findById(id: string): Promise<UploadedAsset | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM uploaded_assets WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToAsset(rows[0]) : null;
  }

  async findWatermarkedPreviewFor(
    sourceAssetId: string
  ): Promise<UploadedAsset | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM uploaded_assets
        WHERE source_asset_id = $1 AND asset_type = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [sourceAssetId, AssetType.WatermarkedPreview]
    );
    return rows[0] ? rowToAsset(rows[0]) : null;
  }

  async create(input: CreateUploadedAssetInput): Promise<UploadedAsset> {
    const { rows } = await this.db.query(
      `INSERT INTO uploaded_assets (
         request_id, user_id, file_name, asset_type,
         file_size_bytes, mime_type, storage_key, storage_url,
         thumbnail_key, thumbnail_url, upload_status,
         video_ratio, duration_seconds, scheduled_deletion_at,
         source_asset_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        input.requestId,
        input.userId,
        input.fileName,
        input.assetType,
        input.fileSizeBytes,
        input.mimeType,
        input.storageKey,
        input.storageUrl,
        input.thumbnailKey,
        input.thumbnailUrl,
        input.uploadStatus,
        input.videoRatio ?? null,
        input.durationSeconds ?? null,
        input.scheduledDeletionAt,
        input.sourceAssetId ?? null,
      ]
    );
    return rowToAsset(rows[0]);
  }

  async update(
    id: string,
    input: UpdateUploadedAssetInput
  ): Promise<UploadedAsset> {
    const COL_MAP: Record<string, string> = {
      storageKey: "storage_key",
      storageUrl: "storage_url",
      thumbnailKey: "thumbnail_key",
      thumbnailUrl: "thumbnail_url",
      uploadStatus: "upload_status",
      videoRatio: "video_ratio",
      durationSeconds: "duration_seconds",
    };

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      const col = COL_MAP[key];
      if (!col) continue;
      sets.push(`${col} = $${idx++}`);
      values.push(value);
    }

    if (sets.length === 0) {
      const { rows } = await this.db.query(
        "SELECT * FROM uploaded_assets WHERE id = $1",
        [id]
      );
      if (!rows[0]) throw new Error(`UploadedAsset not found: ${id}`);
      return rowToAsset(rows[0]);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE uploaded_assets SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`UploadedAsset not found: ${id}`);
    return rowToAsset(rows[0]);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.query("DELETE FROM uploaded_assets WHERE id = $1", [id]);
  }

  async deleteByRequestId(requestId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM uploaded_assets WHERE request_id = $1",
      [requestId]
    );
  }

  async countByRequestId(requestId: string): Promise<number> {
    const { rows } = await this.db.query(
      "SELECT COUNT(*)::int AS count FROM uploaded_assets WHERE request_id = $1",
      [requestId]
    );
    return rows[0].count as number;
  }
}
