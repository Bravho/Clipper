/**
 * Stages LINE customer media on Mar-PC, one folder per job.
 *
 * Phase C of the LINE + USB phone plan. Nothing here deletes files: the 8-day
 * retention is design-only until Tho approves the cleanup code.
 *
 * Off by default (`LINE_MEDIA_STAGING_ENABLED`). Staging is read-only on the
 * cloud side (a signed GET) and writes only under `LINE_STAGING_ROOT`.
 */

import { createWriteStream, mkdirSync } from 'fs';
import { join, resolve, sep } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

export const LINE_STAGING_RETENTION_DAYS = 8;

const DEFAULT_ROOT = 'D:\\coding\\ai_line_work\\staging';

export function isLineMediaStagingEnabled(): boolean {
  return process.env.LINE_MEDIA_STAGING_ENABLED === 'true';
}

export function lineStagingRoot(): string {
  return process.env.LINE_STAGING_ROOT || DEFAULT_ROOT;
}

const JOB_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * Build the on-disk path for one staged file. Throws on anything that could
 * escape the job folder (path separators, "..", odd characters).
 */
export function stagedFilePath(root: string, jobId: string, fileName: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error('invalid_job_id');
  if (!SAFE_NAME_RE.test(fileName) || fileName === '.' || fileName.startsWith('..')) {
    throw new Error('invalid_file_name');
  }
  const jobDir = resolve(root, jobId);
  const full = resolve(jobDir, fileName);
  if (!full.startsWith(jobDir + sep)) throw new Error('path_escape');
  return full;
}

/**
 * Download one LINE asset (given its signed URL) into the job folder.
 * Returns the local path. Uses a plain GET; no paid service is called.
 */
export async function stageLineAsset(opts: {
  jobId: string;
  fileName: string;
  signedUrl: string;
  root?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): Promise<string> {
  const root = opts.root ?? lineStagingRoot();
  const target = stagedFilePath(root, opts.jobId, opts.fileName);
  mkdirSync(resolve(root, opts.jobId), { recursive: true });

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.signedUrl);
  if (!res.ok || !res.body) throw new Error(`stage_http_${res.status}`);

  const max = opts.maxBytes ?? 1024 * 1024 * 1024;
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new Error('stage_too_large');

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (e?: Error | null, d?: Buffer) => void) {
      written += chunk.length;
      if (written > max) return cb(new Error('stage_too_large'));
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(target));
  return target;
}
