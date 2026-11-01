import { ListObjectsV2Command, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import type { IAssetVisualAnalysisRepository } from '@/repositories/interfaces/IAssetVisualAnalysisRepository';
export const LINE_UPLOAD_PREFIXES = ['request_mat/line/', 'line_uploads/'] as const;
export async function cleanupLineAssets(client: Pick<S3Client, 'send'>, bucket: string,
  options: { execute?: boolean; now?: Date; analysisRepo?: IAssetVisualAnalysisRepository } = {}) {
  const cutoff = new Date((options.now ?? new Date()).getTime() - 7 * 86400000);
  const keys: string[] = [];
  for (const prefix of LINE_UPLOAD_PREFIXES) {
    let token: string | undefined;
    do {
      const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const object of result.Contents ?? []) {
        if (object.Key?.startsWith(prefix) && object.LastModified && object.LastModified < cutoff) keys.push(object.Key);
      }
      token = result.NextContinuationToken;
    } while (token);
  }
  if (options.execute === true) {
    for (let i = 0; i < keys.length; i += 1000) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) } }));
    }
  }
  const { count: framesPurged } = options.analysisRepo
    ? await options.analysisRepo.purgeOldFrameData(cutoff, options.execute === true)
    : { count: 0 };
  return { keys, dryRun: options.execute !== true, cutoff, framesPurged };
}
