/**
 * fix-scene-index-desync.js
 *
 * One-off repair for jobs whose `current_scene_index` ran ahead of the number
 * of cumulative scene videos actually produced. This happened when a later
 * scene's extension failed and the pipeline was retried: the old retry path
 * regenerated scene 1 from scratch but left current_scene_index pointing at a
 * later scene, so the next approval skipped a scene (e.g. the scene-3 script
 * gate showed while only scene 1's video existed).
 *
 * The fix re-aligns the job to a clean "awaiting scene-N script approval" state
 * where N = the number of cumulative videos produced so far, and trims any
 * in-flight task/asset bookkeeping to match. Approving that script then extends
 * the correct next scene.
 *
 * Usage (from project root):
 *   node scripts/fix-scene-index-desync.js <requestId>
 *   node scripts/fix-scene-index-desync.js            (most recent job)
 *
 * Add --dry to preview without writing:
 *   node scripts/fix-scene-index-desync.js <requestId> --dry
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

function parseJsonArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const requestId = args.find((a) => !a.startsWith("--"));

  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || "5432"),
    database: process.env.PGDATABASE,
    user: process.env.PG_USER.trim(),
    password: process.env.PG_PASSWORD.trim(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

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

  const taskIds = parseJsonArray(job.video_gen_task_ids);
  const sceneAssetIds = parseJsonArray(job.scene_video_asset_ids);
  const producedAssetIds = sceneAssetIds.filter(Boolean);
  const producedScenes = producedAssetIds.length;

  const totalScenes = parseJsonArray(job.approved_scene_plan || job.scene_plan).length;

  console.log("Before:", {
    id: job.id,
    request_id: job.request_id,
    current_step: job.current_step,
    current_scene_index: job.current_scene_index,
    producedScenes,
    totalScenes,
    base_video_asset_id: job.base_video_asset_id,
    video_gen_task_ids: taskIds,
    scene_video_asset_ids: sceneAssetIds,
  });

  if (producedScenes === 0) {
    console.log("No cumulative video produced yet — nothing to re-align.");
    return client.end();
  }

  // At a per-scene script gate, current_scene_index == the next scene to
  // generate == the number of scenes already produced.
  const correctSceneIndex = producedScenes;

  if (totalScenes > 0 && correctSceneIndex >= totalScenes) {
    console.log(
      `All ${totalScenes} scenes already produced — this isn't a script-gate desync. ` +
        `Use reset-job-to-video-approval.js to re-approve the final video instead.`
    );
    return client.end();
  }

  if (Number(job.current_scene_index) === correctSceneIndex) {
    console.log(`current_scene_index is already correct (${correctSceneIndex}) — no change needed.`);
    return client.end();
  }

  // Re-aligned, consistent bookkeeping for the resumed script gate.
  const alignedTaskIds = taskIds.slice(0, producedScenes);
  const alignedTaskId = alignedTaskIds[alignedTaskIds.length - 1] ?? null;
  const alignedAssetIds = producedAssetIds.slice(0, producedScenes);
  const alignedBaseAsset = alignedAssetIds[producedScenes - 1] ?? job.base_video_asset_id;

  const planned = {
    current_step: "awaiting_scene_script_approval",
    current_scene_index: correctSceneIndex,
    video_gen_task_ids: alignedTaskIds.length ? alignedTaskIds : null,
    video_gen_task_id: alignedTaskId,
    scene_video_asset_ids: alignedAssetIds.length ? alignedAssetIds : null,
    base_video_asset_id: alignedBaseAsset,
    video_gen_status: null,
    status: "active",
    failed_at_step: null,
  };

  console.log("Planned update:", planned);

  if (dryRun) {
    console.log("\n--dry: no changes written.");
    return client.end();
  }

  await client.query(
    `UPDATE video_generation_jobs
        SET current_step = $2,
            current_scene_index = $3,
            video_gen_task_ids = $4,
            video_gen_task_id = $5,
            scene_video_asset_ids = $6,
            base_video_asset_id = $7,
            video_gen_status = NULL,
            status = 'active',
            failed_at_step = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [
      job.id,
      planned.current_step,
      planned.current_scene_index,
      planned.video_gen_task_ids === null ? null : JSON.stringify(planned.video_gen_task_ids),
      planned.video_gen_task_id,
      planned.scene_video_asset_ids === null ? null : JSON.stringify(planned.scene_video_asset_ids),
      planned.base_video_asset_id,
    ]
  );

  const after = (
    await client.query(
      `SELECT current_step, current_scene_index, base_video_asset_id, video_gen_task_ids, scene_video_asset_ids
         FROM video_generation_jobs WHERE id = $1`,
      [job.id]
    )
  ).rows[0];
  console.log("After: ", after);
  console.log(
    `\nDone. Reload the request page — it should now show scene ${correctSceneIndex + 1}'s script gate, ` +
      `with scene ${producedScenes}'s cumulative video playable above it.`
  );
  await client.end();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
