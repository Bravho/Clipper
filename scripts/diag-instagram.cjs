/**
 * READ-ONLY diagnostic for Instagram in Channel Management.
 *
 *   node scripts/diag-instagram.cjs
 *
 * Prints (no secrets, no tokens):
 *   1. every social_connections row for instagram (status, has provider id)
 *   2. the last 10 instagram publication targets with their stored error
 *   3. what Post for Me itself says: instagram accounts in the project, and the
 *      RAW per-platform error for those last posts
 * Writes nothing anywhere.
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const PFM = (process.env.POST_FOR_ME_BASE_URL || "https://api.postforme.dev").replace(/\/$/, "");
const KEY = process.env.POST_FOR_ME_API_KEY;

async function pfm(path) {
  const res = await fetch(PFM + path, { headers: { Authorization: `Bearer ${KEY}` } });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text.slice(0, 500) }; }
}

function strip(o) {
  return JSON.parse(JSON.stringify(o, (k, v) => (/token|secret|password/i.test(k) ? "[hidden]" : v)));
}

(async () => {
  const host = process.env.PGHOST || "";
  const db = new Client({
    host, database: process.env.PGDATABASE, port: process.env.PGPORT,
    user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    ssl: /localhost|127\.0\.0\.1/.test(host) || !host ? undefined : { rejectUnauthorized: false },
  });
  await db.connect();

  console.log("\n=== 1. social_connections (instagram) ===");
  const conns = await db.query(`
    SELECT id, user_id, connection_status, provider_account_id,
           account_name, account_username, created_at, connected_at, disconnected_at, updated_at
      FROM social_connections WHERE platform = 'instagram'
     ORDER BY created_at DESC LIMIT 20`);
  console.table(conns.rows);

  console.log("\n=== 2. last instagram publication targets ===");
  const targets = await db.query(`
    SELECT t.id, t.status, t.error_code, left(t.error_message, 300) AS error_message,
           t.provider_post_id, a.aspect_ratio, a.width, a.height, a.file_size_bytes, t.created_at
      FROM management_publication_targets t
      LEFT JOIN management_content_assets a ON a.id = t.management_content_asset_id
     WHERE t.platform = 'instagram'
     ORDER BY t.created_at DESC LIMIT 10`).catch(async (e) => {
       console.log("(asset join failed: " + e.message + ")");
       return db.query(`SELECT id, status, error_code, left(error_message,300) AS error_message,
                               provider_post_id, created_at
                          FROM management_publication_targets WHERE platform='instagram'
                         ORDER BY created_at DESC LIMIT 10`);
     });
  for (const r of targets.rows) console.log(r);
  await db.end();

  if (!KEY) { console.log("\nPOST_FOR_ME_API_KEY not set; skipping provider checks."); return; }

  console.log("\n=== 3a. Post for Me: instagram accounts in this project ===");
  const accts = await pfm("/v1/social-accounts?platform=instagram&limit=50");
  console.log("HTTP", accts.status);
  for (const a of (accts.body && accts.body.data) || []) {
    console.log({ id: a.id, status: a.status, username: a.username, external_id: a.external_id,
                  metadata: strip(a.metadata || null) });
  }

  console.log("\n=== 3b. Post for Me: raw results of the last instagram posts ===");
  const postIds = [...new Set(targets.rows.map((r) => r.provider_post_id).filter(Boolean))].slice(0, 5);
  for (const id of postIds) {
    const r = await pfm(`/v1/social-post-results?post_id=${encodeURIComponent(id)}&limit=20`);
    console.log("post", id, "HTTP", r.status);
    for (const x of (r.body && r.body.data) || []) {
      console.log(JSON.stringify(strip({ account: x.social_account_id, success: x.success, error: x.error, details: x.details }), null, 1));
    }
  }

  console.log("\n=== 3c. Does auth-url need platform_data for instagram? (creates nothing durable) ===");
  for (const body of [
    { platform: "instagram", permissions: ["posts"] },
    { platform: "instagram", permissions: ["posts"], platform_data: { instagram: { connection_type: "instagram" } } },
  ]) {
    const res = await fetch(PFM + "/v1/social-accounts/auth-url", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(body.platform_data ? "WITH connection_type:" : "WITHOUT connection_type:", res.status, text.slice(0, 300));
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
