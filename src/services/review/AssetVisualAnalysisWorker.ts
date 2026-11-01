import { visualConfig, visualEnabled } from '@/config/storyboardVisual';
import type { IAssetVisualAnalysisRepository } from '@/repositories/interfaces/IAssetVisualAnalysisRepository';
import type { IUploadedAssetRepository } from '@/repositories/interfaces/IUploadedAssetRepository';
import { analyseVisualMedia } from '@/lib/ai/storyboardVisualMedia';
import { productDetector } from '@/lib/ai/ProductDetector';
import { spacesSignedUrl } from '@/lib/spaces';
/** Durable upload queue, drained only by the render worker. Failed/abandoned
 * claims are deliberately not replayed; bump version explicitly to reanalyse. */
export async function processAssetVisualAnalysis(repo: IAssetVisualAnalysisRepository, assets: IUploadedAssetRepository,
  analyse = analyseVisualMedia, signedUrl = spacesSignedUrl, afterAnalysis?: (requestId: string) => Promise<void>): Promise<boolean> {
  if (!visualEnabled()) return false;
  const version = visualConfig().version;
  for (const expiredId of await repo.expireClaims(version, visualConfig().claimTimeout)) {
    const expiredAsset = await assets.findById(expiredId);
    if (expiredAsset && afterAnalysis) await afterAnalysis(expiredAsset.requestId);
  }
  const id = await repo.claim(version);
  if (!id) return false;
  let asset;
  try {
    if (await repo.get(id, version)) return true;
    asset = await assets.findById(id);
    if (!asset || !asset.storageKey.startsWith('line_uploads/')) throw new Error('not_line_source');
    await repo.save(await analyse(id, await signedUrl(asset.storageKey, 300), asset.mimeType.startsWith('image/'), productDetector()));
  } catch { await repo.fail(id, version); }
  if (asset && afterAnalysis) await afterAnalysis(asset.requestId);
  return true;
}
