/**
 * One-off data fix (Phase 8): reset requests that were marked Complete/Delivered
 * under the OLD pipeline — i.e. before the distribution-review + publishing step
 * existed. Those jobs reached `current_step = 'complete'` (and their request was
 * marked `delivered`) straight from overlay approval, so they NEVER went through
 * the per-channel publishing-form review and their `publishing_drafts` is NULL.
 *
 * Such a request should not be shown as "delivered": the requester still needs
 * to review the auto-filled publishing form per channel and confirm publishing
 * (and their per-channel captioned videos should be re-verified). This moves
 * each such job back to the merged-video review gate (`awaiting_final_approval`)
 * and its request back to `editing`, so it reappears under "in progress" and the
 * requester can re-approve → subtitle/overlay → distribution review → publish
 * through the new (now complete) flow. Captioned exports + the Travy alias are
 * cleared so everything regenerates cleanly on the re-run (old jobs may carry
 * inconsistent per-ratio data). Masters (final_export_9_16 … 4_5) are kept.
 *
 * It first ENSURES the publishing_drafts column exists (idempotent ADD COLUMN IF
 * NOT EXISTS) so it works even if migration 009 didn't take effect. Safe to run
 * repeatedly: a request that already went through the new step (publishing_drafts
 * IS NOT NULL) is never touched.
 *
 * Run:  node scripts/reset-predistribution-deliveries.js
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

  // 1. Ensure the Phase-8 column exists (idempotent — no-op if already there).
  await client.query(
    `ALTER TABLE video_generation_jobs
       ADD COLUMN IF NOT EXISTS publishing_drafts JSONB`
  );

  // A "pre-distribution" delivery: the job completed WITHOUT ever populating the
  // distribution-review publishing drafts.
  const PRE_DISTRIBUTION = "j.current_step = 'complete' AND j.publishing_drafts IS NULL";

  // 2. Preview what will be reset.
  const preview = await client.query(
    `SELECT j.id AS job_id, j.request_id, r.title, r.status AS request_status, j.current_step
       FROM video_generation_jobs j
       JOIN clip_requests r ON r.id = j.request_id
      WHERE ${PRE_DISTRIBUTION}`
  );

  if (preview.rows.length === 0) {
    console.log("No pre-distribution deliveries found — nothing to reset.");
    await client.end();
    return;
  }

  console.log(`Resetting ${preview.rows.length} pre-distribution request(s):`);
  for (const r of preview.rows) {
    console.log(
      `  • "${r.title}" (request ${r.request_id}) ${r.request_status} -> editing @ awaiting_final_approval`
    );
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
              captioned_export_9_16_asset_id = NULL,
              captioned_export_16_9_asset_id = NULL,
              captioned_export_1_1_asset_id = NULL,
              captioned_export_4_5_asset_id = NULL,
              updated_at = NOW()
        WHERE current_step = 'complete' AND publishing_drafts IS NULL`
    );

    await client.query(
      `UPDATE clip_requests
          SET status = 'editing', updated_at = NOW()
        WHERE status = 'delivered'
          AND id IN (
            SELECT request_id FROM video_generation_jobs
             WHERE current_step = 'awaiting_final_approval'
               AND publishing_drafts IS NULL
          )`
    );

    await client.query("COMMIT");
    console.log(
      "\nDone. These requests are now in-progress at the merged-video review step; " +
        "re-approve to flow through subtitles → distribution review → publish."
    );
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
