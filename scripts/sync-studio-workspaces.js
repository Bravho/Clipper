/**
 * Upload locally pending Studio workspaces from SQLite to PostgreSQL.
 *
 * Usage:
 *   npm run studio:sync
 *   npm run studio:sync -- --dry-run
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

const projectRoot = path.join(__dirname, "..");
const logDirectory = path.join(projectRoot, "logs");
const logPath = path.join(logDirectory, "studio-sync.log");
const dryRun = process.argv.includes("--dry-run");

fs.mkdirSync(logDirectory, { recursive: true });

function sanitize(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function log(level, message) {
  const line = `[${new Date().toISOString()}] [studio-sync] [${level}] ${sanitize(message)}`;
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
  const configuredPath = env.RCLIPPER_STUDIO_DB_PATH?.trim();
  const sqlitePath = configuredPath
    ? path.resolve(projectRoot, configuredPath)
    : path.join(projectRoot, "data", "studio.sqlite");
  if (!fs.existsSync(sqlitePath)) throw new Error(`Local Studio database does not exist: ${sqlitePath}`);

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

    let failures = 0;
    for (const [index, row] of pending.entries()) {
      const ownerLabel = sanitize(row.owner_id).slice(0, 8) || "unknown";
      try {
        const workspace = JSON.parse(row.data);
        await cloud.query(
          `INSERT INTO studio_workspaces (owner_id, data)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [row.owner_id, JSON.stringify(workspace)]
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
