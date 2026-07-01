/**
 * One-off data fix (Phase 7): reset requests that were marked Complete/Delivered
 * under the OLD pipeline — i.e. before the subtitle + motion-graphic overlay step
 * existed. Those jobs reached `current_step = 'complete'` straight from the
 * merged-video review, so they have NO captioned exports. They should not be
 * shown as "delivered"; they need to go through the new subtitle step.
 *
 * This moves each such job back to the merged-approval gate
 * (`awaiting_final_approval`) and its request back to `editing`, so it reappears
 * as in-progress and the requester can re-approve and continue through the
 * subtitle/Travy steps. Masters (final_export_*) are kept; the stale Travy alias
 * is cleared so Travy re-renders cleanly.
 *
 * It first ENSURES the Phase-7 columns exist (idempotent ADD COLUMN IF NOT
 * EXISTS) so it works even if migration 007 didn't take effect. Safe to run
 * repeatedly: a job that already has captioned exports is never touched.
 *
 * Run:  node scripts/reset-presubtitle-deliveries.js
 */
const { Client } = require("pg");
const fs = require("fs");

function loadEnv() {
  const content = fs.readFileSync(".env.local", "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}

const PHASE7_COLUMNS = [
  "captioned_export_9_16_asset_id",
  "captioned_export_16_9_asset_id",
  "captioned_export_1_1_asset_id",
  "captioned_export_4_5_asset_id",
  "tvent_video_status",
];

const NO_CAPTIONS =
  "captioned_export_9_16_asset_id IS NULL AND " +
  "captioned_export_16_9_asset_id IS NULL AND " +
  "captioned_export_1_1_asset_id IS NULL AND " +
  "captioned_export_4_5_asset_id IS NULL";

async function main() {
  loadEnv();
  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || "5432"),
    database: process.env.PGDATABASE,
    user: process.env.PG_USER.trim(),
    password: process.env.PG_PASSWORD.trim(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to", process.env.PGDATABASE, "\n");

  // 1. Ensure the Phase-7 columns exist (idempotent — no-op if already there).
  await client.query(
    `ALTER TABLE video_generation_jobs
       ADD COLUMN IF NOT EXISTS captioned_export_9_16_asset_id TEXT,
       ADD COLUMN IF NOT EXISTS captioned_export_16_9_asset_id TEXT,
       ADD COLUMN IF NOT EXISTS captioned_export_1_1_asset_id  TEXT,
       ADD COLUMN IF NOT EXISTS captioned_export_4_5_asset_id  TEXT,
       ADD COLUMN IF NOT EXISTS tvent_video_status TEXT NOT NULL DEFAULT 'idle'`
  );
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'video_generation_jobs' AND column_name = ANY($1)`,
    [PHASE7_COLUMNS]
  );
  console.log("Phase-7 columns present:", cols.map((r) => r.column_name).join(", "));
  if (cols.length !== PHASE7_COLUMNS.length) {
    throw new Error("Failed to create Phase-7 columns — check DB permissions / connection.");
  }
  console.log("");

  // 2. Preview what will be reset.
  const preview = await client.query(
    `SELECT j.id AS job_id, j.request_id, r.title, r.status AS request_status, j.current_step
       FROM video_generation_jobs j
       JOIN clip_requests r ON r.id = j.request_id
      WHERE j.current_step = 'complete' AND ${NO_CAPTIONS}`
  );

  if (preview.rows.length === 0) {
    console.log("No pre-subtitle deliveries found — nothing to reset.");
    await client.end();
    return;
  }

  console.log(`Resetting ${preview.rows.length} pre-subtitle request(s):`);
  for (const r of preview.rows) {
    console.log(`  • "${r.title}" (request ${r.request_id}) ${r.request_status} -> editing`);
  }

  // 3. Reset in a transaction.
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE video_generation_jobs
          SET current_step = 'awaiting_final_approval',
              status = 'active',
              failed_at_step = NULL,
              final_approved_by = NULL,
              tvent_video_status = 'idle',
              final_export_tvent_asset_id = NULL,
              updated_at = NOW()
        WHERE current_step = 'complete' AND ${NO_CAPTIONS}`
    );

    await client.query(
      `UPDATE clip_requests
          SET status = 'editing', updated_at = NOW()
        WHERE status = 'delivered'
          AND id IN (
            SELECT request_id FROM video_generation_jobs
             WHERE current_step = 'awaiting_final_approval'
               AND ${NO_CAPTIONS}
          )`
    );

    await client.query("COMMIT");
    console.log("\nDone. These requests are now in-progress at the merged-video review step.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
