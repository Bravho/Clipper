/**
 * reset-voice-step.js — revert a stuck pipeline job back to the voice
 * generation step so the user can click "Retry" to regenerate the voice
 * via ElevenLabs.
 *
 * Sets the job to Failed with failedAtStep = generating_voice and clears the
 * stale iAppTTS task ID (which otherwise makes pipeline-status poll a dead
 * local server forever). From that state:
 *   - the requester sees the PipelineFailurePanel "ลองอีกครั้ง" button
 *     → POST /api/requests/[id]/retry-production → ElevenLabs TTS
 *   - regenerateVoice() also accepts this state (self-healing retry)
 *
 * Usage (from the project root):
 *   node scripts/reset-voice-step.js <requestId>
 *   node scripts/reset-voice-step.js aa1667c2-2548-451c-8a6a-b61a60de8fe3
 */
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const requestId = process.argv[2];
if (!requestId) {
  console.error("Usage: node scripts/reset-voice-step.js <requestId>");
  process.exit(1);
}

const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")) || [])[1]?.trim();

const client = new Client({
  host: get("PGHOST"),
  port: +(get("PGPORT") || 5432),
  database: get("PGDATABASE"),
  user: get("PG_USER"),
  password: get("PG_PASSWORD"),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();

  const before = await client.query(
    `SELECT id, status, current_step, failed_at_step, tts_task_id
     FROM video_generation_jobs WHERE request_id = $1`,
    [requestId]
  );
  if (before.rows.length === 0) {
    console.error(`No video_generation_job found for request ${requestId}`);
    process.exit(1);
  }
  console.log("Before:", before.rows[0]);

  const { rows } = await client.query(
    `UPDATE video_generation_jobs
     SET status = 'failed',
         current_step = 'failed',
         failed_at_step = 'generating_voice',
         tts_task_id = NULL,
         voice_recording_asset_id = NULL,
         processed_voice_asset_id = NULL,
         updated_at = NOW()
     WHERE request_id = $1
     RETURNING id, status, current_step, failed_at_step, tts_task_id`,
    [requestId]
  );
  console.log("After: ", rows[0]);
  console.log("\nDone. Reload the request page — the retry button will regenerate the voice via ElevenLabs.");

  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
