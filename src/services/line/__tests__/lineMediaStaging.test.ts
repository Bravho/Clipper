import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { stagedFilePath, stageLineAsset, LINE_STAGING_RETENTION_DAYS } from '../lineMediaStaging';

describe('lineMediaStaging', () => {
  const root = 'D:\\coding\\ai_line_work\\staging';
  const job = 'job-abcdef12';

  it('builds a path inside the job folder', () => {
    const p = stagedFilePath(root, job, 'video.mp4');
    expect(p.startsWith(join(root, job))).toBe(true);
  });

  it.each([
    ['bad job id', '../x', 'video.mp4', 'invalid_job_id'],
    ['traversal name', job, '..\\evil.mp4', 'invalid_file_name'],
    ['slash in name', job, 'a/b.mp4', 'invalid_file_name'],
    ['dot name', job, '.', 'invalid_file_name'],
  ])('rejects %s', (_label, j, f, err) => {
    expect(() => stagedFilePath(root, j, f)).toThrow(err);
  });

  it('keeps retention at 8 days (no deletion code here)', () => {
    expect(LINE_STAGING_RETENTION_DAYS).toBe(8);
  });

  it('writes the downloaded bytes into the job folder', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stage-test-'));
    const fakeFetch = (async () =>
      new Response(Buffer.from('hello'), { status: 200 })) as unknown as typeof fetch;
    const out = await stageLineAsset({
      jobId: job, fileName: 'clip.bin', signedUrl: 'https://example.invalid/x',
      root: tmp, fetchImpl: fakeFetch,
    });
    expect(readFileSync(out, 'utf8')).toBe('hello');
  });

  it('refuses a download over the size cap', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stage-test-'));
    const fakeFetch = (async () =>
      new Response(Buffer.from('0123456789'), { status: 200 })) as unknown as typeof fetch;
    await expect(stageLineAsset({
      jobId: job, fileName: 'big.bin', signedUrl: 'https://example.invalid/x',
      root: tmp, fetchImpl: fakeFetch, maxBytes: 4,
    })).rejects.toThrow('stage_too_large');
  });
});
