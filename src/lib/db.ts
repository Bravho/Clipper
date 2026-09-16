import { Pool } from "pg";

const pgSslMode = (process.env.PGSSLMODE ?? "require").trim().toLowerCase();
const pgSsl = pgSslMode === "disable" ? false : { rejectUnauthorized: false };
const databaseUrl = process.env.DATABASE_URL?.trim();

/**
 * Shared PostgreSQL connection pool.
 *
 * Reads connection config from environment variables.
 * The `pg` package natively reads PGHOST, PGDATABASE, PGPORT but NOT PG_USER /
 * PG_PASSWORD (those require PGUSER / PGPASSWORD), so we pass them explicitly.
 *
 * SSL is required for Amazon RDS — rejectUnauthorized is false because the
 * RDS CA cert is not bundled; traffic is still encrypted in transit.
 */
const poolConfig = {
  ...(databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        port: parseInt(process.env.PGPORT ?? "5432", 10),
        user: process.env.PG_USER?.trim(),
        password: process.env.PG_PASSWORD?.trim(),
      }),
  // Hosted databases default to encrypted connections. Local/LAN PostgreSQL
  // instances that do not offer SSL can opt out with PGSSLMODE=disable.
  ssl: pgSsl,
  // Keep connection pool small — Next.js runs many serverless-like workers
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 12_000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
};

// Next.js reloads server modules frequently in development. Reusing the pool
// prevents abandoned pools from opening competing connections to a hosted DB.
const globalForPostgres = globalThis as typeof globalThis & {
  rclipperPostgresPool?: Pool;
};

const pool = globalForPostgres.rclipperPostgresPool ?? new Pool(poolConfig);

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.rclipperPostgresPool = pool;
}

export { pool };
