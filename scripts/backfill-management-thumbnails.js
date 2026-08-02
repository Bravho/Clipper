/**
 * backfill-management-thumbnails.js — give existing RClipper Management library
 * items the preview image they never got.
 *
 * WHY THIS IS NEEDED. `management_content_items.thumbnail_storage_key` is written
 * ONLY by the INSERT in `createOrGetTransferredVideo` (which is
 * `ON CONFLICT DO NOTHING`). Any video transferred while its export had no poster
 * — which, before `AssetPosterService`, was every export produced by a path other
 * than the captioned render — is stuck with a NULL thumbnail forever. Uploaded
 * videos never had one at all. Those items are what render as a black player with
 * nothing beneath it in "วิดิโอของคุณ".
 *
 * WHAT IT DOES. For each live item with no thumbnail:
 *   1. prefer the poster already on the source `uploaded_assets` row (free);
 *   2. otherwise extract a midpoint frame from the item's own primary asset with
 *      ffmpeg, upload it to `thumbnails/`, and — when the item came from a
 *      generation — write it back onto the source asset too, so the generator UI
 *      and any future transfer benefit from the same work.
 *
 * SAFE TO RE-RUN. Only touches rows that still have no thumbnail. Sequential by
 * design: each item downloads a whole video, so a parallel run would saturate
 * bandwidth and CPU.
 *
 * Usage (from the project root):
 *   node scripts/backfill-management-thumbnails.js            # apply
 *   node scripts/backfill-management-thumbnails.js --dry-run  # report only
 *   node scripts/backfill-management-thumbnails.js --limit 25
 *
 * Requires ffmpeg/ffprobe on PATH (or FFMPEG_PATH in .env.local) and the same
 * PG_* / DO_SPACES_* env vars the app uses.
 */
const { Client } = require("pg");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  if (i === -1) return null;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
})();

const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")) || [])[1]?.trim();

const FFMPEG = get("FFMPEG_PATH") || "ffmpeg";
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) =>
  m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"
);
const BUCKET = get("DO_SPACES_BUCKET");

const s3 = new S3Client({
  endpoint: get("DO_SPACES_ENDPOINT"),
  region: get("DO_SPACES_REGION") || "sgp1",
  credentials: {
    accessKeyId: get("DO_SPACES_KEY"),
    secretAccessKey: get("DO_SPACES_SECRET"),
  },
  forcePathStyle: true,
  // DigitalOcean Spaces rejects the CRC32 integrity checksums that
  // @aws-sdk/client-s3 >= 3.729 sends by default, with an opaque 400.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const db = new Client({
  host: get("PGHOST"),
  port: +(get("PGPORT") || 5432),
  database: get("PGDATABASE"),
  user: get("PG_USER"),
  password: get("PG_PASSWORD"),
  ssl: { rejectUnauthorized: false },
});

const sanitize = (n) => String(n).replace(/[^a-zA-Z0-9._-]/g, "_");
const utcDate = () => new Date().toISOString().slice(0, 10);
const thumbKeyFor = (userId, scopeId, baseName) =>
  `thumbnails/${userId}/${utcDate()}/${scopeId}/${crypto.randomUUID()}-${sanitize(baseName)}.jpg`;
const publicUrl = (key) => {
  const cdn = get("DO_SPACES_CDN_ENDPOINT");
  return cdn ? `${cdn}/${key}` : `${get("DO_SPACES_ENDPOINT")}/${BUCKET}/${key}`;
};

async function download(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Midpoint frame, scaled to 320px on its long edge — not frame zero, which is
 *  black on any clip that fades in. */
async function extractPoster(videoBuffer) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "clipper-mgmt-poster-"));
  const input = path.join(dir, "clip");
  const output = path.join(dir, "poster.jpg");
  try {
    await fsp.writeFile(input, videoBuffer);
    let seek = 0;
    try {
      const { stdout } = await execFileAsync(FFPROBE, [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", input,
      ]);
      const d = parseFloat(stdout.trim());
      if (Number.isFinite(d) && d > 0) seek = d / 2;
    } catch {
      /* unknown duration — take the first frame */
    }
    await execFileAsync(FFMPEG, [
      "-ss", String(seek), "-i", input, "-frames:v", "1",
      "-vf", "scale=min(320\\,iw):-2", "-q:v", "4", "-y", output,
    ]);
    const buf = await fsp.readFile(output);
    if (buf.byteLength === 0) throw new Error("ffmpeg produced an empty frame");
    return buf;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

(async () => {
  if (!BUCKET) throw new Error("DO_SPACES_BUCKET is not set in .env.local");
  await db.connect();

  // The item, its primary media, and any poster its source export already has.
  const { rows } = await db.query(
    `SELECT i.id,
            i.user_id,
            i.title,
            i.source_type,
            i.source_asset_id,
            a.storage_key      AS asset_storage_key,
            ua.thumbnail_key   AS source_thumbnail_key
       FROM management_content_items i
       LEFT JOIN LATERAL (
            SELECT storage_key
              FROM management_content_assets
             WHERE management_content_id = i.id
             ORDER BY created_at ASC
             LIMIT 1
       ) a ON TRUE
       -- ::text on both sides: management_content_items.source_asset_id is TEXT
       -- (migration 021) while uploaded_assets.id may be uuid, and Postgres will
       -- not compare those directly.
       LEFT JOIN uploaded_assets ua ON ua.id::text = i.source_asset_id::text
      WHERE i.removed_at IS NULL
        AND i.thumbnail_storage_key IS NULL
        AND i.media_deleted_at IS NULL
      ORDER BY i.created_at DESC
      ${LIMIT ? `LIMIT ${LIMIT}` : ""}`
  );

  console.log(
    `Found ${rows.length} library item(s) with no preview image.` +
      (DRY_RUN ? " (dry run — nothing will be written)" : "")
  );

  let reused = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `${row.title} [${row.source_type}]`;
    try {
      // 1. The cheap path: the source export already has a poster.
      if (row.source_thumbnail_key) {
        if (!DRY_RUN) {
          await db.query(
            "UPDATE management_content_items SET thumbnail_storage_key = $1, updated_at = NOW() WHERE id = $2",
            [row.source_thumbnail_key, row.id]
          );
        }
        reused += 1;
        console.log(`  ↺ ${label} — reused the source export's poster`);
        continue;
      }

      // 2. No media to extract from (purged, or an upload that never completed).
      if (!row.asset_storage_key) {
        skipped += 1;
        console.log(`  – ${label} — no media on file, skipped`);
        continue;
      }

      if (DRY_RUN) {
        generated += 1;
        console.log(`  · ${label} — would generate from ${row.asset_storage_key}`);
        continue;
      }

      const poster = await extractPoster(await download(row.asset_storage_key));
      const key = thumbKeyFor(row.user_id, row.id, "poster-backfill");
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: poster,
          ContentType: "image/jpeg",
          ACL: "public-read",
        })
      );

      await db.query(
        "UPDATE management_content_items SET thumbnail_storage_key = $1, updated_at = NOW() WHERE id = $2",
        [key, row.id]
      );

      // Push it back onto the source export as well, so the generator's own UI
      // stops showing a blank preview for the same video and a future transfer
      // takes the cheap path above.
      if (row.source_asset_id) {
        await db.query(
          `UPDATE uploaded_assets
              SET thumbnail_key = $1, thumbnail_url = $2
            WHERE id = $3 AND (thumbnail_key IS NULL OR thumbnail_key = '')`,
          [key, publicUrl(key), row.source_asset_id]
        );
      }

      generated += 1;
      console.log(`  ✓ ${label} (${generated} generated)`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${label}: ${err.message}`);
    }
  }

  console.log(
    `Done. Reused ${reused}, generated ${generated}, skipped ${skipped}, failed ${failed}.`
  );
  await db.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
