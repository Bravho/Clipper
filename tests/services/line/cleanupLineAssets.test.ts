import { cleanupLineAssets, LINE_UPLOAD_PREFIXES } from '@/services/line/cleanupLineAssets';
import { MockAssetVisualAnalysisRepository } from '@/repositories/mock/MockAssetVisualAnalysisRepository';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';

// Minimal S3 mock
function makeS3(keys: { Key: string; LastModified: Date }[]) {
  const deleted: string[] = [];
  const send = jest.fn(async (cmd: unknown) => {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    if (name === 'ListObjectsV2Command') return { Contents: keys };
    if (name === 'DeleteObjectsCommand') {
      const objs = ((cmd as Record<string,unknown>).input as Record<string,unknown>).Delete as { Objects: { Key: string }[] };
      objs.Objects.forEach(o => deleted.push(o.Key));
      return {};
    }
    return {};
  });
  return { send, deleted };
}

const bucket = 'test-bucket';

function makeAnalysis(assetId: string, hasData: boolean): AssetVisualAnalysis {
  return {
    assetId, version: '1', usableDuration: 10, width: 1080, height: 1920, photo: false, cuts: [],
    frames: [{ data: hasData ? 'abc123' : null, time: 2.5, detection: null, centerOffset: null, areaRatio: null }],
  };
}

async function makeRepoWithEntries(opts: { old: boolean; hasData: boolean; count?: number }) {
  const repo = new MockAssetVisualAnalysisRepository();
  const n = opts.count ?? 1;
  for (let i = 0; i < n; i++) {
    const assetId = `asset-${i}`;
    await repo.enqueue(assetId, '1');
    const entries = (repo as unknown as { entries: Map<string, { state: string; createdAt: number }> })['entries'];
    const entry = entries.get(assetId + ':1')!;
    // claim + save to put into 'done' state
    entry.state = 'claimed';
    const inner = repo as unknown as { entries: Map<string, { state: string; value?: AssetVisualAnalysis; assetId: string; version: string; claimedAt?: number; createdAt: number }> };
    inner.entries.set(assetId + ':1', { ...entry, state: 'done', value: makeAnalysis(assetId, opts.hasData),
      createdAt: opts.old ? Date.now() - 8 * 86400000 : Date.now() });
  }
  return repo;
}

// ── S3 cleanup tests ──────────────────────────────────────────────────────────

test('dry-run: reports old keys but does not delete them', async () => {
  const old = new Date(Date.now() - 8 * 86400000);
  const recent = new Date(Date.now() - 3 * 86400000);
  const s3 = makeS3([
    { Key: 'line_uploads/c/u/old.jpg', LastModified: old },
    { Key: 'line_uploads/c/u/new.jpg', LastModified: recent },
    { Key: 'request_mat/line/r/old.mp4', LastModified: old },
  ]);
  const result = await cleanupLineAssets(s3, bucket);
  expect(result.dryRun).toBe(true);
  expect(result.keys).toHaveLength(2);
  expect(result.keys).toContain('line_uploads/c/u/old.jpg');
  expect(result.keys).toContain('request_mat/line/r/old.mp4');
  expect(s3.deleted).toHaveLength(0);
});

test('execute: deletes only old keys within LINE_UPLOAD_PREFIXES', async () => {
  const old = new Date(Date.now() - 8 * 86400000);
  const s3 = makeS3([
    { Key: 'line_uploads/c/u/old.jpg', LastModified: old },
    { Key: 'other_prefix/file.jpg', LastModified: old },  // outside scope
  ]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true });
  expect(result.dryRun).toBe(false);
  // only keys within LINE_UPLOAD_PREFIXES get collected
  expect(result.keys).toContain('line_uploads/c/u/old.jpg');
  expect(result.keys).not.toContain('other_prefix/file.jpg');
  expect(s3.deleted).toContain('line_uploads/c/u/old.jpg');
  expect(s3.deleted).not.toContain('other_prefix/file.jpg');
});

// ── Frame purge tests ─────────────────────────────────────────────────────────

test('dry-run: counts rows with frame data older than 7 days without modifying', async () => {
  const repo = await makeRepoWithEntries({ old: true, hasData: true });
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket, { analysisRepo: repo });
  expect(result.dryRun).toBe(true);
  expect(result.framesPurged).toBe(1);
  // Verify data is still present (not modified)
  const entries = (repo as unknown as { entries: Map<string, { value?: AssetVisualAnalysis }> })['entries'];
  const entry = [...entries.values()][0];
  expect(entry.value?.frames[0].data).toBe('abc123');
});

test('execute: strips frame data from old done rows', async () => {
  const repo = await makeRepoWithEntries({ old: true, hasData: true });
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true, analysisRepo: repo });
  expect(result.framesPurged).toBe(1);
  const entries = (repo as unknown as { entries: Map<string, { value?: AssetVisualAnalysis }> })['entries'];
  const entry = [...entries.values()][0];
  expect(entry.value?.frames[0].data).toBeNull();
  // detection/metrics preserved
  expect(entry.value?.frames[0].time).toBe(2.5);
});

test('execute: skips rows newer than 7 days', async () => {
  const repo = await makeRepoWithEntries({ old: false, hasData: true });
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true, analysisRepo: repo });
  expect(result.framesPurged).toBe(0);
  const entries = (repo as unknown as { entries: Map<string, { value?: AssetVisualAnalysis }> })['entries'];
  const entry = [...entries.values()][0];
  expect(entry.value?.frames[0].data).toBe('abc123');
});

test('execute: skips rows where data is already null (idempotent)', async () => {
  const repo = await makeRepoWithEntries({ old: true, hasData: false });
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true, analysisRepo: repo });
  expect(result.framesPurged).toBe(0);
});

test('no repo: framesPurged is 0', async () => {
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket);
  expect(result.framesPurged).toBe(0);
});

test('execute: purges multiple old rows with data', async () => {
  const repo = await makeRepoWithEntries({ old: true, hasData: true, count: 3 });
  const s3 = makeS3([]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true, analysisRepo: repo });
  expect(result.framesPurged).toBe(3);
});

test('nothing outside LINE_UPLOAD_PREFIXES is deleted', async () => {
  const old = new Date(Date.now() - 8 * 86400000);
  const s3 = makeS3([
    { Key: 'videos/production/v.mp4', LastModified: old },
    { Key: 'assets/img/logo.png', LastModified: old },
  ]);
  const result = await cleanupLineAssets(s3, bucket, { execute: true });
  expect(result.keys).toHaveLength(0);
  expect(s3.deleted).toHaveLength(0);
  const prefix = LINE_UPLOAD_PREFIXES;
  expect(prefix).toContain('line_uploads/');
  expect(prefix).toContain('request_mat/line/');
});
