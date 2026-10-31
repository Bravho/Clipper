#!/usr/bin/env ts-node
/**
 * cleanup-line-uploads.ts
 *
 * Deletes downloaded LINE shop files from Spaces that are older than 7 days.
 * Runs with --dry-run by default (no files are deleted unless --execute is passed).
 *
 * Usage:
 *   npx ts-node scripts/cleanup-line-uploads.ts              # dry-run (default)
 *   npx ts-node scripts/cleanup-line-uploads.ts --execute    # actually delete
 *
 * IMPORTANT: Do not run this script directly during development.
 * Connects to real Spaces — only run from the server/worker environment.
 */

import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  ObjectIdentifier,
} from '@aws-sdk/client-s3';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';

const DRY_RUN = !process.argv.includes('--execute');
const MAX_AGE_DAYS = 7;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** Prefixes that contain LINE-intake downloaded shop files. */
const LINE_UPLOAD_PREFIXES = [
  'request_mat/line/',
  'line_uploads/',
];

async function listOldKeys(prefix: string, cutoff: Date): Promise<string[]> {
  const old: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await spacesClient.send(
      new ListObjectsV2Command({
        Bucket: SPACES_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of result.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      if (obj.LastModified < cutoff) old.push(obj.Key);
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return old;
}

async function deleteKeys(keys: string[]): Promise<void> {
  const batch = 1000; // S3 DeleteObjects limit
  for (let i = 0; i < keys.length; i += batch) {
    const chunk = keys.slice(i, i + batch);
    const objects: ObjectIdentifier[] = chunk.map((Key) => ({ Key }));
    await spacesClient.send(
      new DeleteObjectsCommand({ Bucket: SPACES_BUCKET, Delete: { Objects: objects } })
    );
  }
}

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  console.log(
    `[cleanup-line-uploads] cutoff=${cutoff.toISOString()} dry_run=${DRY_RUN}`
  );

  let total = 0;
  for (const prefix of LINE_UPLOAD_PREFIXES) {
    const keys = await listOldKeys(prefix, cutoff);
    total += keys.length;
    console.log(`  ${prefix}: ${keys.length} file(s) older than ${MAX_AGE_DAYS} days`);
    if (DRY_RUN) {
      keys.slice(0, 5).forEach((k) => console.log(`    (dry) would delete: ${k}`));
      if (keys.length > 5) console.log(`    ... and ${keys.length - 5} more`);
    } else {
      await deleteKeys(keys);
      console.log(`  deleted ${keys.length} file(s)`);
    }
  }

  console.log(
    `[cleanup-line-uploads] total ${total} file(s)${DRY_RUN ? ' (dry run — nothing deleted)' : ' deleted'}`
  );
}

main().catch((err) => {
  console.error('[cleanup-line-uploads] fatal error:', err);
  process.exit(1);
});
