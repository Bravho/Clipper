const { Client } = require('pg');
const fs = require('fs');

function loadEnv() {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PG_USER.trim(),
    password: process.env.PG_PASSWORD.trim(),
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log("Connected to database successfully");

  const res = await client.query("SELECT id, title, status, user_id FROM clip_requests WHERE title LIKE '%Smith%'");
  console.log("Found requests:", res.rows);

  await client.end();
}

main().catch(console.error);
