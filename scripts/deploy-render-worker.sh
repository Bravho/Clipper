#!/bin/bash
# deploy-render-worker.sh — steps 3-7 of the render_tasks queue cutover.
# Run from the Mac Mini host shell (NOT from a sandbox — needs Postgres + launchctl).
#
#   cd ~/Projects/Video_Processor_RClipper && bash scripts/deploy-render-worker.sh
#
# Steps 1 (sync) and 2 (deps) and 4 (type-check) are already verified.
# Stops at the first failure so nothing runs against a half-migrated DB.
set -euo pipefail
cd "$(dirname "$0")/.."

hr() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

hr "3a. Apply migration 025 (additive + idempotent)"
node scripts/apply-migration.js src/db/migrations/025_render_task_queue.sql

hr "3b. Confirm render_tasks + uq_render_tasks_active_job exist"
node -e '
const {Client}=require("pg"),fs=require("fs");
const env=fs.readFileSync(".env.local","utf8");
const get=k=>(env.match(new RegExp("^"+k+"\\s*=\\s*(.+)$","m"))||[])[1]?.trim();
const c=new Client({host:get("PGHOST"),port:+(get("PGPORT")||5432),database:get("PGDATABASE"),
  user:get("PG_USER"),password:get("PG_PASSWORD"),ssl:{rejectUnauthorized:false}});
(async()=>{
  await c.connect();
  const t=await c.query("SELECT to_regclass($1) AS t",["public.render_tasks"]);
  console.log("render_tasks table:", t.rows[0].t || "MISSING");
  const i=await c.query(
    "SELECT indexname FROM pg_indexes WHERE tablename=$1 ORDER BY indexname",["render_tasks"]);
  console.log("indexes:", i.rows.map(r=>r.indexname).join(", ") || "(none)");
  const u=i.rows.some(r=>r.indexname==="uq_render_tasks_active_job");
  console.log("uq_render_tasks_active_job:", u ? "PRESENT" : "MISSING");
  // Guardrail check: the OLD claim columns must still be there (left in place
  // intentionally for one release — migration 010).
  const o=await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='"'"'video_generation_jobs'"'"' AND column_name LIKE '"'"'render%'"'"'`);
  console.log("legacy render_* cols still present:", o.rows.map(r=>r.column_name).join(", ")||"(none)");
  const d=await c.query("SELECT state, count(*) FROM render_tasks GROUP BY state");
  console.log("current queue depth:", d.rows.length?JSON.stringify(d.rows):"empty");
  await c.end();
  if(!t.rows[0].t||!u){process.exit(1);}
})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
'

hr "5. Smoke test one claim cycle"
npm run worker:once

hr "6. Restart the LaunchAgent"
launchctl kickstart -k "gui/$(id -u)/com.rclipper.worker"
sleep 2
launchctl print "gui/$(id -u)/com.rclipper.worker" | grep -iE '^\s*(state|pid|program) ' || true

hr "7. Worker log tail (Ctrl-C to stop)"
LOG=$(launchctl print "gui/$(id -u)/com.rclipper.worker" \
  | awk '/standard out path/{print $NF}')
echo "log: ${LOG:-<not set — check the plist StandardOutPath>}"
[ -n "${LOG:-}" ] && [ -f "$LOG" ] && tail -n 40 -f "$LOG"
