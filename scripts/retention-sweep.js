/**
 * retention-sweep.js — scheduled storage/data-retention sweep.
 *
 * Implements the two application-level retention rules from
 * docs/storage-lifecycle-design.md (Addendum A):
 *
 *   A. Final-clip window: a request that has been delivered/published for more
 *      than FINAL_CLIP_DAYS (default 7) has its media purged (final clips +
 *      all processed intermediates + raw uploads). Thumbnails are kept.
 *
 *   B. Inactivity auto-cancel: a non-terminal, non-draft request with no
 *      activity for more than INACTIVE_DAYS (default 30) is marked
 *      'auto_cancelled' and its media purged (thumbnails kept).
 *
 * Cascade guarantee: purge deletes across EVERY media prefix for the request in
 * one pass, so removing the uploads necessarily removes every processed
 * artefact. Thumbnails (kept here) expire via the Spaces 2-year lifecycle rule.
 *
 * Runs outbound-only (Postgres + Spaces over the network) — suitable for a cron
 * job on the app server or the Mac Mini processing unit.
 *
 * Usage:
 *   node scripts/retention-sweep.js                 # live run
 *   node scripts/retention-sweep.js --dry-run       # log only, delete nothing
 *   node scripts/retention-sweep.js --clip-days=7 --inactive-days=30
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const argVal = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
};
const FINAL_CLIP_DAYS = argVal("clip-days", 7);
const INACTIVE_DAYS = argVal("inactive-days", 30);

// ── Env ──────────────────────────────────────────────────────────────────────
const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (k) =>
  (env.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")) || [])[1]?.trim();

const MEDIA_PREFIXES = [
  "tmp",
  "processing",
  "request_mat",
  "ai_videos",
  "animated_videos",
  "animated_overlays",
  "processed_audio",
  "voice_recordings",
  "final_exports",
  "clips",
];

const BUCKET = get("DO_SPACES_BUCKET");
const s3 = new S3Client({
  endpoint: get("DO_SPACES_ENDPOINT"),
  region: get("DO_SPACES_REGION") || "sgp1",
  credentials: {
    accessKeyId: get("DO_SPACES_KEY"),
    secretAccessKey: get("DO_SPACES_SECRET"),
  },
  forcePathStyle: true,
});

const db = new Client({
  host: get("PGHOST"),
  database: get("PGDATABASE"),
  port: Number(get("PGPORT")) || 5432,
  user: get("PG_USER"),
  password: get("PG_PASSWORD"),
  ssl: { rejectUnauthorized: false },
});

// ── Spaces helpers ───────────────────────────────────────────────────────────
async function listRequestKeys(userId, requestId) {
  const marker = `/${requestId}/`;
  const keys = [];
  for (const prefix of MEDIA_PREFIXES) {
    let token;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: `${prefix}/${userId}/`,
          ContinuationToken: token,
        })
      );
      for (const obj of res.Contents || []) {
        if (obj.Key && obj.Key.includes(marker)) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return keys;
}

async function deleteKeys(keys) {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (DRY_RUN) {
      deleted += batch.length;
      continue;
    }
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    deleted += batch.length - (res.Errors ? res.Errors.length : 0);
    for (const e of res.Errors || []) {
      console.error(`   ! delete error ${e.Key}: ${e.Message}`);
    }
  }
  return deleted;
}

async function purge(label, userId, requestId) {
  const keys = await listRequestKeys(userId, requestId);
  if (keys.length === 0) {
    console.log(`   ${label} ${requestId}: no media (already purged)`);
    return 0;
  }
  const n = await deleteKeys(keys);
  console.log(
    `   ${label} ${requestId}: ${DRY_RUN ? "would delete" : "deleted"} ${n}/${keys.length} object(s)`
  );
  return n;
}

// ── Sweeps ───────────────────────────────────────────────────────────────────
async function sweepDeliveredClips() {
  const { rows } = await db.query(
    `SELECT id, user_id FROM clip_requests
       WHERE status IN ('delivered','published')
         AND updated_at < NOW() - ($1 || ' days')::interval`,
    [String(FINAL_CLIP_DAYS)]
  );
  console.log(`\n[A] Delivered > ${FINAL_CLIP_DAYS}d — ${rows.length} request(s)`);
  let total = 0;
  for (const r of rows) total += await purge("clip-window", r.user_id, r.id);
  return total;
}

async function sweepInactive() {
  const { rows } = await db.query(
    `SELECT id, user_id FROM clip_requests
       WHERE status IN ('submitted','under_review','accepted_for_production',
                        'editing','scheduled_for_publishing','on_hold','revision_requested')
         AND updated_at < NOW() - ($1 || ' days')::interval`,
    [String(INACTIVE_DAYS)]
  );
  console.log(`\n[B] Inactive > ${INACTIVE_DAYS}d — ${rows.length} request(s)`);
  let total = 0;
  for (const r of rows) {
    if (!DRY_RUN) {
      await db.query(
        `UPDATE clip_requests SET status = 'auto_cancelled', updated_at = NOW()
           WHERE id = $1`,
        [r.id]
      );
    }
    console.log(
      `   ${DRY_RUN ? "would auto-cancel" : "auto-cancelled"} ${r.id}`
    );
    total += await purge("inactive", r.user_id, r.id);
  }
  return total;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(
    `Retention sweep ${DRY_RUN ? "(DRY RUN) " : ""}— clip=${FINAL_CLIP_DAYS}d inactive=${INACTIVE_DAYS}d`
  );
  await db.connect();
  try {
    const a = await sweepDeliveredClips();
    const b = await sweepInactive();
    console.log(
      `\nDone. ${DRY_RUN ? "Would delete" : "Deleted"} ${a + b} object(s) total.`
    );
  } catch (err) {
    console.error("Sweep failed:", err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
