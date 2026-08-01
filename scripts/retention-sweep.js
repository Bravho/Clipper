/**
 * retention-sweep.js — scheduled storage/data-retention sweep.
 *
 * Implements the application-level retention rules from
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
 *   C. Stale drafts: a Draft with no activity for more than INACTIVE_DAYS has
 *      its media purged and its uploaded_assets rows deleted (so the draft UI
 *      doesn't render broken links to lifecycle-expired objects). The draft
 *      row itself is kept — the requester can re-upload and still submit.
 *
 *   D. Orphan reconciliation: lists every media prefix and deletes objects
 *      whose requestId no longer exists in the DB, or belongs to a request
 *      that is terminal (rejected / auto_cancelled / delivered / published)
 *      and past the FINAL_CLIP_DAYS grace window. Catches strays left by
 *      partial failures, deleted drafts, and lifecycle-driven deletions that
 *      removed request_mat/ but not the processed artefacts.
 *      Skip with --skip-reconcile.
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
const SKIP_RECONCILE = args.includes("--skip-reconcile");
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

// Shared with src/services/StorageLifecycleService.ts — single source of truth
// so the app cascade and this sweep can never drift (preview_exports was once
// missing here for exactly that reason).
const { mediaPrefixes: MEDIA_PREFIXES } = require(path.join(
  __dirname,
  "..",
  "src",
  "config",
  "mediaPrefixes.json"
));

const BUCKET = get("DO_SPACES_BUCKET");
const s3 = new S3Client({
  endpoint: get("DO_SPACES_ENDPOINT"),
  region: get("DO_SPACES_REGION") || "sgp1",
  credentials: {
    accessKeyId: get("DO_SPACES_KEY"),
    secretAccessKey: get("DO_SPACES_SECRET"),
  },
  forcePathStyle: true,
  // @aws-sdk/client-s3 >= 3.729 sends CRC32 integrity checksums by default;
  // DigitalOcean Spaces rejects them with an opaque 400 "UnknownError".
  // Only send/validate checksums when the API actually requires them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
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

/**
 * RClipper Management retention pin.
 *
 * A project transferred into RClipper Management keeps its media until
 * `management_content_items.media_expires_at` (the 30-day paid window once the
 * user pays; the underlying export's short window while still free). If this
 * sweep purged on the clip window, Management could find its videos gone before
 * that.
 *
 * The pin is therefore time-bounded, not permanent. A request is exempt while
 * EITHER:
 *   * its Management window is still open (media not yet due, not yet purged), OR
 *   * a publication is still waiting to go out, whatever the window says —
 *     expiring media out from under a post the user already paid for would be a
 *     broken promise, not a storage saving.
 *
 * Once both are false the media is no longer pinned here and is purged by the
 * ordinary rules, while the Management RECORD and its history live on.
 *
 * Fails OPEN on error — if the check itself breaks we skip the purge rather than
 * risk deleting pinned media. Over-retaining costs storage; under-retaining
 * breaks a paid feature.
 *
 * Returns the subset of `requestIds` that are pinned.
 */
async function pinnedManagementRequestIds(requestIds) {
  if (requestIds.length === 0) return new Set();
  try {
    const { rows } = await db.query(
      // ::text on the column, because clip_requests.id (and therefore this FK)
      // may be uuid or text depending on how the database was created — see the
      // note in migration 019. The existing orphan sweep casts for the same reason.
      `SELECT DISTINCT c.source_generation_id::text AS id
         FROM management_content_items c
        WHERE c.source_generation_id::text = ANY($1::text[])
          AND c.status <> 'cancelled'
          AND (
                -- Management retention window still open
                (c.media_deleted_at IS NULL
                 AND (c.media_expires_at IS NULL OR c.media_expires_at > NOW()))
                -- ...or a post is still in flight (no scheduled-ahead posting)
                OR EXISTS (
                     SELECT 1 FROM management_publications p
                      WHERE p.management_content_id = c.id
                        AND p.status IN ('draft','publishing')
                   )
              )`,
      [requestIds]
    );
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    // Migration 019 not applied yet, or the DB is unhappy. Treat every request
    // as pinned so nothing is deleted on a bad read.
    console.error(
      "   ! management pin check failed — skipping purge for safety:",
      err.message
    );
    return new Set(requestIds);
  }
}

async function purge(label, userId, requestId) {
  const pinned = await pinnedManagementRequestIds([requestId]);
  if (pinned.has(requestId)) {
    console.log(
      `   ${label} ${requestId}: SKIPPED — transferred to RClipper Management (retention pinned)`
    );
    return 0;
  }

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

async function sweepStaleDrafts() {
  const { rows } = await db.query(
    `SELECT id, user_id FROM clip_requests
       WHERE status = 'draft'
         AND updated_at < NOW() - ($1 || ' days')::interval`,
    [String(INACTIVE_DAYS)]
  );
  console.log(`\n[C] Stale drafts > ${INACTIVE_DAYS}d — ${rows.length} request(s)`);
  let total = 0;
  for (const r of rows) {
    total += await purge("stale-draft", r.user_id, r.id);
    if (!DRY_RUN) {
      const res = await db.query(
        `DELETE FROM uploaded_assets WHERE request_id = $1`,
        [r.id]
      );
      if (res.rowCount > 0) {
        console.log(`   stale-draft ${r.id}: removed ${res.rowCount} asset row(s)`);
      }
    }
  }
  return total;
}

/**
 * [D] Orphan reconciliation.
 *
 * Key layout is {prefix}/{userId}/{YYYY-MM-DD}/{requestId}/... — the requestId
 * is always the 4th segment. Any object whose requestId is unknown to the DB,
 * or whose request is terminal and past the grace window, is an orphan.
 * Keys that don't match the expected layout are left alone (never guess-delete).
 */
async function sweepOrphans() {
  console.log(`\n[D] Orphan reconciliation`);

  // 1. Collect keys per requestId across every media prefix (thumbnails excluded).
  const keysByRequest = new Map(); // requestId -> string[]
  let skippedUnparseable = 0;
  for (const prefix of MEDIA_PREFIXES) {
    let token;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: `${prefix}/`,
          ContinuationToken: token,
        })
      );
      for (const obj of res.Contents || []) {
        if (!obj.Key) continue;
        const parts = obj.Key.split("/");
        // Expect at least prefix/userId/date/requestId/filename
        if (parts.length < 5 || !parts[3]) {
          skippedUnparseable++;
          continue;
        }
        const requestId = parts[3];
        if (!keysByRequest.has(requestId)) keysByRequest.set(requestId, []);
        keysByRequest.get(requestId).push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  if (skippedUnparseable > 0) {
    console.log(`   skipped ${skippedUnparseable} key(s) with unexpected layout`);
  }
  if (keysByRequest.size === 0) {
    console.log("   no media objects found");
    return 0;
  }

  // 2. Look up every referenced request in one query.
  const ids = [...keysByRequest.keys()];
  const { rows } = await db.query(
    `SELECT id::text AS id, status,
            (updated_at < NOW() - ($2 || ' days')::interval) AS past_grace
       FROM clip_requests WHERE id::text = ANY($1::text[])`,
    [ids, String(FINAL_CLIP_DAYS)]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Projects transferred into RClipper Management are exempt — a scheduled post
  // may still need this media. Checked in bulk so [D] stays one extra query.
  const pinned = await pinnedManagementRequestIds(ids);
  if (pinned.size > 0) {
    console.log(`   ${pinned.size} request(s) pinned by RClipper Management — skipping`);
  }

  // 3. Decide per request. Delete only clearly-safe cases.
  const PURGEABLE_TERMINAL = new Set([
    "rejected",
    "auto_cancelled",
    "delivered",
    "published",
  ]);
  let total = 0;
  for (const [requestId, keys] of keysByRequest) {
    if (pinned.has(requestId)) continue;
    const req = byId.get(requestId);
    let reason = null;
    if (!req) {
      reason = "request not in DB";
    } else if (PURGEABLE_TERMINAL.has(req.status) && req.past_grace) {
      reason = `terminal '${req.status}' past ${FINAL_CLIP_DAYS}d grace`;
    }
    if (!reason) continue;
    const n = await deleteKeys(keys);
    console.log(
      `   orphan ${requestId} (${reason}): ${DRY_RUN ? "would delete" : "deleted"} ${n}/${keys.length} object(s)`
    );
    total += n;
  }
  if (total === 0) console.log("   no orphans");
  return total;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(
    `Retention sweep ${DRY_RUN ? "(DRY RUN) " : ""}— clip=${FINAL_CLIP_DAYS}d inactive=${INACTIVE_DAYS}d${SKIP_RECONCILE ? " (reconcile skipped)" : ""}`
  );
  await db.connect();
  try {
    const a = await sweepDeliveredClips();
    const b = await sweepInactive();
    const c = await sweepStaleDrafts();
    const d = SKIP_RECONCILE ? 0 : await sweepOrphans();
    console.log(
      `\nDone. ${DRY_RUN ? "Would delete" : "Deleted"} ${a + b + c + d} object(s) total.`
    );
  } catch (err) {
    console.error("Sweep failed:", err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
