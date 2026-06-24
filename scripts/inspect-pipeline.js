/**
 * inspect-pipeline.js — show the persisted state of a request's video pipeline.
 *
 * Usage (from project root):
 *   node scripts/inspect-pipeline.js <requestId>
 *   node scripts/inspect-pipeline.js            (uses the most recent job)
 */
const { Client } = require("pg");
const fs = require("fs");

function loadEnv() {
  const content = fs.readFileSync(".env.local", "utf8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
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

  const requestId = process.argv[2];

  // 1) All jobs for the request (or the most recent job overall).
  const jobsQ = requestId
    ? `SELECT * FROM video_generation_jobs WHERE request_id = $1 ORDER BY created_at DESC`
    : `SELECT * FROM video_generation_jobs ORDER BY created_at DESC LIMIT 1`;
  const jobs = (await client.query(jobsQ, requestId ? [requestId] : [])).rows;

  console.log(`\n=== JOBS (${jobs.length}) ===`);
  for (const j of jobs) {
    console.log({
      id: j.id,
      request_id: j.request_id,
      status: j.status,
      current_step: j.current_step,
      current_scene_index: j.current_scene_index,
      base_video_asset_id: j.base_video_asset_id,
      video_gen_task_ids: j.video_gen_task_ids,
      scene_video_asset_ids: j.scene_video_asset_ids,
      updated_at: j.updated_at,
    });

    // 2) Does the base video asset still exist?
    if (j.base_video_asset_id) {
      const a = (
        await client.query(
          `SELECT id, asset_type, upload_status, storage_url FROM uploaded_assets WHERE id = $1`,
          [j.base_video_asset_id]
        )
      ).rows[0];
      console.log("  base video asset:", a || "(MISSING from uploaded_assets!)");
    }

    // 3) Full step history for this job (oldest first).
    const hist = (
      await client.query(
        `SELECT step, scene_index, created_at FROM video_generation_step_history
          WHERE job_id = $1 ORDER BY created_at ASC`,
        [j.id]
      )
    ).rows;
    console.log(`  step history (${hist.length}):`);
    for (const h of hist) {
      console.log(`    ${h.created_at.toISOString()}  ${h.step}  scene=${h.scene_index}`);
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
