import { cleanupLineAssets } from '@/services/line/cleanupLineAssets';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
test('production cleanup selects only old LINE objects across pages and defaults to dry-run', async () => {
  const send = jest.fn().mockResolvedValueOnce({ Contents: [
    { Key: 'line_uploads/old', LastModified: new Date('2026-10-01') },
    { Key: 'studio/old', LastModified: new Date('2026-10-01') },
    { Key: 'line_uploads/new', LastModified: new Date('2026-11-01') }] })
    .mockResolvedValueOnce({ Contents: [], NextContinuationToken: 'page2' })
    .mockResolvedValueOnce({ Contents: [{ Key: 'line_uploads/older', LastModified: new Date('2026-09-01') }] });
  const result = await cleanupLineAssets({ send } as never, 'bucket', { now: new Date('2026-11-01') });
  expect(result.dryRun).toBe(true);
  expect(result.keys).toEqual(['line_uploads/older']);
  expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(false);
});
