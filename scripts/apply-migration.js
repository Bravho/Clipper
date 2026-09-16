/**
 * apply-migration.js — run a SQL migration file against the database in .env.local
 *
 * Usage (from the project root):
 *   node scripts/apply-migration.js migrations/004_add_iapptts_and_animation_columns.sql
 */
const { Client } = require("pg");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: node scripts/apply-migration.js <path-to-sql-file>");
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync(path.join(__dirname, "..", ".env.local")));
const get = (key) => env[key]?.trim();
const databaseUrl = get("DATABASE_URL");

const client = new Client({
  ...(databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: get("PGHOST"),
        port: +(get("PGPORT") || 5432),
        database: get("PGDATABASE"),
        user: get("PG_USER"),
        password: get("PG_PASSWORD"),
      }),
  ssl: (get("PGSSLMODE") || "require").toLowerCase() === "disable"
    ? false
    : { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  const sql = fs.readFileSync(migrationFile, "utf8");
  await client.query(sql);
  console.log(`Applied: ${migrationFile}`);
  await client.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
