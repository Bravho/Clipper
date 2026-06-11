/**
 * apply-migration.js — run a SQL migration file against the database in .env.local
 *
 * Usage (from the project root):
 *   node scripts/apply-migration.js migrations/004_add_iapptts_and_animation_columns.sql
 */
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: node scripts/apply-migration.js <path-to-sql-file>");
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
  const sql = fs.readFileSync(migrationFile, "utf8");
  await client.query(sql);
  console.log(`Applied: ${migrationFile}`);

  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'video_generation_jobs'
       AND column_name IN ('jai_tts_task_id','subtitle_timeline','animation_spec','animated_video_asset_id')`
  );
  console.log("Columns now present:", rows.map((r) => r.column_name).join(", ") || "(none!)");
  await client.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
