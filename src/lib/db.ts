import { Pool } from "pg";

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
const pool = new Pool({
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  port: parseInt(process.env.PGPORT ?? "5432", 10),
  user: process.env.PG_USER?.trim(),
  password: process.env.PG_PASSWORD?.trim(),
  ssl: { rejectUnauthorized: false },
  // Keep connection pool small — Next.js runs many serverless-like workers
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export { pool };
