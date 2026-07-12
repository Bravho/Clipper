/**
 * backfill-video-thumbnails.js — generate poster thumbnails for video assets
 * that were uploaded before upload-time poster generation existed.
 *
 * For each `uploaded_assets` row that is a video, is Uploaded, and has no
 * thumbnail yet, this downloads the clip from DO Spaces, extracts a midpoint
 * frame with ffmpeg, uploads a small JPEG to thumbnails/, and updates the row's
 * thumbnail_key / thumbnail_url. After running, clips render as <img> posters
 * everywhere instead of a placeholder (and no live <video> is needed for them).
 *
 * Usage (from the project root):
 *   node scripts/backfill-video-thumbnails.js
 *
 * Requires ffmpeg/ffprobe on PATH (or FFMPEG_PATH set in .env.local) and the
 * same PG_* / DO_SPACES_* env vars the app uses.
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
  credentials: { accessKeyId: get("DO_SPACES_KEY"), secretAccessKey: get("DO_SPACES_SECRET") },
  forcePathStyle: true,
  // @aws-sdk/client-s3 >= 3.729 sends CRC32 integrity checksums by default;
  // DigitalOcean Spaces rejects them with an opaque 400 "UnknownError".
  // Only send/validate checksums when the API actually requires them.
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

const sanitize = (n) => n.replace(/[^a-zA-Z0-9._-]/g, "_");
const utcDate = () => new Date().toISOString().slice(0, 10);
const thumbKeyFor = (userId, requestId, baseName) =>
  `thumbnails/${userId}/${utcDate()}/${requestId}/${crypto.randomUUID()}-${sanitize(baseName)}.jpg`;
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

async function extractPoster(videoBuffer) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "clipper-backfill-"));
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
    } catch {}
    await execFileAsync(FFMPEG, [
      "-ss", String(seek), "-i", input, "-frames:v", "1",
      "-vf", "scale=min(320\\,iw):-2", "-q:v", "4", "-y", output,
    ]);
    return await fsp.readFile(output);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

(async () => {
  await db.connect();
  const { rows } = await db.query(
    `SELECT id, user_id, request_id, file_name, storage_key
       FROM uploaded_assets
      WHERE asset_type = 'video'
        AND upload_status = 'uploaded'
        AND (thumbnail_key IS NULL OR thumbnail_key = '')`
  );
  console.log(`Found ${rows.length} video asset(s) needing a poster.`);

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const video = await download(row.storage_key);
      const poster = await extractPoster(video);
      const baseName = row.file_name.replace(/\.[^.]+$/, "");
      const key = thumbKeyFor(row.user_id, row.request_id, baseName);
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
        "UPDATE uploaded_assets SET thumbnail_key = $1, thumbnail_url = $2 WHERE id = $3",
        [key, publicUrl(key), row.id]
      );
      done += 1;
      console.log(`  ✓ ${row.file_name} (${done}/${rows.length})`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${row.file_name}: ${err.message}`);
    }
  }

  console.log(`Done. Generated ${done}, failed ${failed}.`);
  await db.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
