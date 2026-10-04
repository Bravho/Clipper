/**
 * Upload locally pending Ad Lab workspaces from SQLite to PostgreSQL.
 *
 * Usage:
 *   npm run adlab:sync
 *   npm run adlab:sync -- --dry-run
 *   npm run adlab:sync -- --as-email=you@example.com
 *
 * --as-email stores the local-login workspace ("studio-local-owner") under the
 * real RClipper account with that email, so it appears when you sign in to the
 * deployed site with that account. Without it, rows keep their local owner id.
 *
 * Progress is printed and appended to logs/ad-lab-sync.log.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

const projectRoot = path.join(__dirname, "..");
const logDirectory = path.join(projectRoot, "logs");
const logPath = path.join(logDirectory, "ad-lab-sync.log");
const dryRun = process.argv.includes("--dry-run");
const asEmailArg = process.argv.find((arg) => arg.startsWith("--as-email="));
const asEmail = asEmailArg ? asEmailArg.slice("--as-email=".length).trim().toLowerCase() : "";
const LOCAL_OWNER_ID = "studio-local-owner";

fs.mkdirSync(logDirectory, { recursive: true });

function sanitize(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function log(level, message) {
  const line = `[${new Date().toISOString()}] [ad-lab-sync] [${level}] ${sanitize(message)}`;
  console[level === "ERROR" ? "error" : "log"](line);
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

function errorDetails(error) {
  const details = [];
  let current = error;
  while (current instanceof Error) {
    const code = current.code ? ` code=${sanitize(current.code)}` : "";
    details.push(`${current.name}${code}: ${sanitize(current.message)}`);
    current = current.cause;
  }
  return details.join("; ") || sanitize(error);
}

function loadEnvironment() {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local was not found.");
  return { ...process.env, ...dotenv.parse(fs.readFileSync(envPath)) };
}

function postgresConfig(env) {
  const get = (key) => env[key]?.trim();
  const databaseUrl = get("DATABASE_URL");
  if (!databaseUrl && !["PGHOST", "PGDATABASE", "PG_USER", "PG_PASSWORD"].every((key) => get(key))) {
    throw new Error("PostgreSQL credentials are incomplete in .env.local.");
  }
  return {
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: get("PGHOST"),
          database: get("PGDATABASE"),
          port: Number(get("PGPORT") || 5432),
          user: get("PG_USER"),
          password: get("PG_PASSWORD"),
        }),
    ssl: (get("PGSSLMODE") || "require").toLowerCase() === "disable"
      ? false
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: Number(get("PG_CONNECTION_TIMEOUT_MS") || 12_000),
    keepAlive: true,
  };
}

async function main() {
  const env = loadEnvironment();
  const configuredPath = (env.RCLIPPER_AD_LAB_DB_PATH || env.RCLIPPER_STUDIO_DB_PATH)?.trim();
  const sqlitePath = configuredPath
    ? path.resolve(projectRoot, configuredPath)
    : path.join(projectRoot, "data", "studio.sqlite");
  if (!fs.existsSync(sqlitePath)) {
    // Nothing has been saved in Ad Lab on this computer yet (the file is
    // created on the first save while the dev server runs). Not an error.
    log("INFO", `No local Ad Lab data yet (${sqlitePath} not created). Nothing to sync.`);
    log("INFO", "Open /dashboard/ad-lab with `npm run dev`, save something, then run this again.");
    return;
  }

  const { DatabaseSync } = require("node:sqlite");
  const local = new DatabaseSync(sqlitePath);
  let cloud;
  try {
    local.exec(`
      CREATE TABLE IF NOT EXISTS studio_workspace_sync_state (
        owner_id TEXT PRIMARY KEY,
        pending INTEGER NOT NULL DEFAULT 1 CHECK (pending IN (0, 1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const pending = local.prepare(`
      SELECT workspace.owner_id, workspace.data
      FROM studio_workspaces AS workspace
      LEFT JOIN studio_workspace_sync_state AS sync ON sync.owner_id = workspace.owner_id
      WHERE COALESCE(sync.pending, 1) = 1
      ORDER BY workspace.updated_at ASC
    `).all();

    log("INFO", `Found ${pending.length} pending local workspace(s). Log file: ${logPath}`);
    if (pending.length === 0) return;
    if (dryRun) {
      log("INFO", "Dry run complete; no PostgreSQL data was changed.");
      return;
    }

    cloud = new Client(postgresConfig(env));
    log("INFO", "Connecting to PostgreSQL...");
    await cloud.connect();
    log("INFO", "PostgreSQL connection established.");

    const { rows: tableRows } = await cloud.query("SELECT to_regclass('public.studio_workspaces') AS name");
    if (!tableRows[0]?.name) {
      throw new Error("Table studio_workspaces is missing. Apply src/db/migrations/038_ad_lab_workspaces.sql first.");
    }

    let mappedOwnerId = null;
    if (asEmail) {
      const { rows } = await cloud.query("SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1", [asEmail]);
      if (!rows[0]) throw new Error(`No RClipper account found for ${asEmail}.`);
      mappedOwnerId = String(rows[0].id);
      log("INFO", `Local login workspace will be stored under the account for ${asEmail}.`);
    }

    let failures = 0;
    for (const [index, row] of pending.entries()) {
      const ownerLabel = sanitize(row.owner_id).slice(0, 8) || "unknown";
      try {
        const workspace = JSON.parse(row.data);
        await cloud.query(
          `INSERT INTO studio_workspaces (owner_id, data)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [mappedOwnerId && row.owner_id === LOCAL_OWNER_ID ? mappedOwnerId : row.owner_id, JSON.stringify(workspace)]
        );
        local.prepare(`
          INSERT INTO studio_workspace_sync_state (owner_id, pending)
          VALUES (?, 0)
          ON CONFLICT(owner_id) DO UPDATE SET pending = 0, updated_at = CURRENT_TIMESTAMP
        `).run(row.owner_id);
        log("INFO", `Synced workspace ${index + 1}/${pending.length} (owner ${ownerLabel}…).`);
      } catch (error) {
        failures += 1;
        log("ERROR", `Workspace ${index + 1}/${pending.length} failed: ${errorDetails(error)}`);
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} workspace(s) failed and remain pending.`);
    }
    log("INFO", `Sync complete: ${pending.length} workspace(s) uploaded successfully.`);
  } finally {
    if (cloud) await cloud.end().catch((error) => log("ERROR", `Closing PostgreSQL failed: ${errorDetails(error)}`));
    local.close();
  }
}

main().catch((error) => {
  log("ERROR", errorDetails(error));
  log("ERROR", "Sync stopped. Local data remains pending and can be retried safely.");
  process.exitCode = 1;
});
