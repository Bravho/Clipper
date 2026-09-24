import { uploadedAssetRepository } from "@/repositories";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";

/**
 * The canonical, index-stable view of a request's uploaded source material.
 *
 * Every part of the montage pipeline that refers to an asset "by index" — the
 * Stage-1 storyboard, the Stage-3 montage scene plan, the approval panels, and
 * the Remotion renderer — MUST resolve indexes through this single ordering, so
 * that index N always means the same photo/clip everywhere. This is the
 * cross-pipeline alignment guarantee.
 */
export interface OrderedSourceAsset {
  /** Zero-based index in the canonical ordering — the value scenes reference. */
  index: number;
  id: string;
  url: string;
  thumbnailUrl: string;
  kind: "image" | "clip";
  fileName: string;
  /** Real clip length (seconds) probed at upload; null for images / unknown. */
  durationSeconds?: number | null;
  /**
   * Set when the ORIGINAL bytes live on the requester's device and were never
   * uploaded. `url` is then a small poster derivative — fine for Gemini, the
   * scene designer and thumbnails, and wrong for a render.
   *
   * Anything that turns an ordered asset into something a renderer reads must
   * branch here: hand a renderer the poster and it will animate a still where a
   * moving clip belongs, and the result looks almost right, which is the worst
   * kind of wrong.
   */
  localId?: string | null;
}

/**
 * Pure: filter to usable source media (uploaded images/clips) and order them
 * deterministically by creation time (then id as a tiebreaker), assigning the
 * canonical index. Sorting here — rather than relying on repository order —
 * keeps the ordering identical across Postgres and Mock repositories.
 */
export function orderSourceAssets(assets: UploadedAsset[]): OrderedSourceAsset[] {
  return assets
    .filter(
      (a) =>
        (a.assetType === AssetType.Image || a.assetType === AssetType.Video) &&
        a.uploadStatus === AssetUploadStatus.Uploaded &&
        // A device-held asset has a poster in `storageUrl`, so this stays the
        // single "is this usable source material" test for both paths.
        !!a.storageUrl
    )
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((a, index) => ({
      index,
      id: a.id,
      url: a.storageUrl,
      thumbnailUrl: a.thumbnailUrl || a.storageUrl,
      kind: a.assetType === AssetType.Video ? "clip" : "image",
      fileName: a.fileName,
      durationSeconds: a.durationSeconds ?? null,
      localId: a.deviceLocalId ?? null,
    }));
}

/** Fetch and order a request's source assets through the canonical ordering. */
export async function getOrderedSourceAssets(requestId: string): Promise<OrderedSourceAsset[]> {
  const assets = await uploadedAssetRepository.findByRequestId(requestId);
  return orderSourceAssets(assets);
}
