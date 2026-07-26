#!/usr/bin/env node
/**
 * One-shot: apply a CORS rule to the DO Spaces bucket so the browser can PUT
 * uploaded files directly to a presigned URL.
 *
 * Why: the request form (NewRequestForm.onSubmit) uploads each file with a
 * cross-origin `fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": ... } })`
 * straight to https://<region>.digitaloceanspaces.com. A PUT with a non-simple
 * Content-Type forces a CORS preflight; with no CORS rule on the Space the
 * browser blocks it and fetch throws "Failed to fetch" — which never reaches the
 * Next app (so the app logs look fine).
 *
 * Run:  node scripts/set-spaces-cors.js          # apply, then print current rules
 *       node scripts/set-spaces-cors.js --check   # print current rules only
 *
 * Reads DO_SPACES_* from .env.local. Override the allowed origins with
 * SPACES_CORS_ORIGINS="https://a.com,https://b.com".
 */
const fs = require("fs");
const path = require("path");

// Minimal .env.local loader (no dependency on dotenv).
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} = require("@aws-sdk/client-s3");

const BUCKET = process.env.DO_SPACES_BUCKET;
const client = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: process.env.DO_SPACES_REGION ?? "sgp1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  forcePathStyle: true,
});

const origins = (
  process.env.SPACES_CORS_ORIGINS ??
  "https://app.rclipper.com,https://rclipper.com,https://www.rclipper.com,http://localhost:3000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsRule = {
  AllowedOrigins: origins,
  // Browser PUTs the file; GET/HEAD covers any direct reads; OPTIONS is preflight.
  AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
  // Content-Type is what makes the PUT non-simple; "*" also covers any x-amz-* headers.
  AllowedHeaders: ["*"],
  ExposeHeaders: ["ETag"],
  MaxAgeSeconds: 3000,
};

async function main() {
  if (!BUCKET) throw new Error("DO_SPACES_BUCKET is not set");

  if (!process.argv.includes("--check")) {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: { CORSRules: [corsRule] },
      })
    );
    console.log(`Applied CORS to "${BUCKET}" for origins:\n  ${origins.join("\n  ")}\n`);
  }

  const current = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log("Current CORS rules:");
  console.log(JSON.stringify(current.CORSRules, null, 2));
}

main().catch((err) => {
  console.error("Failed to set/read CORS:", err?.message ?? err);
  process.exit(1);
});
