/**
 * reset-job-to-video-approval.js
 *
 * One-off repair: a job whose scene-1 (or scene-N) video was generated but whose
 * current_step got pushed back to a script-approval step (stale-build bug) is
 * reset to awaiting_video_approval so the existing generated video can be
 * approved without regenerating it.
 *
 * It only resets jobs that actually have a generated cumulative video
 * (base_video_asset_id present) and are currently sitting on a script step.
 *
 * Usage (from project root):
 *   node scripts/reset-job-to-video-approval.js <requestId>
 *   node scripts/reset-job-to-video-approval.js            (most recent job)
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
  const job = (
    await client.query(
      requestId
        ? `SELECT * FROM video_generation_jobs WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1`
        : `SELECT * FROM video_generation_jobs ORDER BY created_at DESC LIMIT 1`,
      requestId ? [requestId] : []
    )
  ).rows[0];

  if (!job) {
    console.log("No job found.");
    return client.end();
  }

  console.log("Before:", { id: job.id, current_step: job.current_step, current_scene_index: job.current_scene_index, base_video_asset_id: job.base_video_asset_id });

  if (!job.base_video_asset_id) {
    console.log("Job has no generated base video — nothing to reset.");
    return client.end();
  }
  const scriptSteps = ["awaiting_scene_design_approval", "awaiting_scene_script_approval", "generating_base_video"];
  if (!scriptSteps.includes(job.current_step)) {
    console.log(`current_step is "${job.current_step}" — no reset needed.`);
    return client.end();
  }

  // Number of scenes whose cumulative video has been produced so far.
  let producedScenes = 1;
  try {
    const arr = JSON.parse(job.scene_video_asset_ids || "[]");
    producedScenes = Math.max(1, arr.filter(Boolean).length);
  } catch {}
  const sceneIndex = producedScenes - 1; // index of the scene awaiting approval

  await client.query(
    `UPDATE video_generation_jobs
        SET current_step = 'awaiting_video_approval',
            current_scene_index = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [job.id, sceneIndex]
  );

  const after = (await client.query(`SELECT current_step, current_scene_index FROM video_generation_jobs WHERE id = $1`, [job.id])).rows[0];
  console.log("After: ", after);
  console.log("Done. Reload the request page — the generated video should be back for approval.");
  await client.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
