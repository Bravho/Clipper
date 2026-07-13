/**
 * test-spaces-upload.js — isolate the DO Spaces PutObject 400 "UnknownError"
 * that stalls the `overlay_composition` step.
 *
 * It PUTs to the SAME key shape the overlay step uses
 * (final_exports/.../9-16/<uuid>.mp4) with several variants, so we can see
 * WHICH factor triggers the 400: the ACL, the ContentType, the object size,
 * or the path itself. It prints the FULL error (Code + raw body) that the
 * pipeline log hides behind "UnknownError".
 *
 * Run on the Mac worker (from the repo root, .env.local populated):
 *   node scripts/test-spaces-upload.js
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")) || [])[1]?.trim();

const BUCKET = get("DO_SPACES_BUCKET");
const client = new S3Client({
  endpoint: get("DO_SPACES_ENDPOINT"),
  region: get("DO_SPACES_REGION") || "sgp1",
  credentials: { accessKeyId: get("DO_SPACES_KEY"), secretAccessKey: get("DO_SPACES_SECRET") },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// Capture the raw error response body the SDK swallows for unmodeled errors.
client.middlewareStack.add(
  (next) => async (args) => {
    try {
      return await next(args);
    } catch (err) {
      const resp = err && err.$response;
      if (resp && resp.body && typeof resp.body.transformToString !== "function") {
        try {
          const chunks = [];
          for await (const c of resp.body) chunks.push(c);
          err.__rawBody = Buffer.concat(chunks).toString("utf8").slice(0, 600);
        } catch {}
      }
      throw err;
    }
  },
  { step: "deserialize", priority: "low", name: "captureRawBody" }
);

function keyFor(ratio) {
  const date = new Date().toISOString().slice(0, 10);
  return `final_exports/_diag/${date}/${ratio}/${crypto.randomUUID()}.mp4`;
}

async function attempt(label, size, cmdExtra) {
  const Key = keyFor("9-16");
  const Body = Buffer.alloc(size, 7);
  const base = { Bucket: BUCKET, Key, Body, ContentType: "video/mp4", ACL: "public-read" };
  const input = Object.assign(base, cmdExtra);
  const t0 = Date.now();
  try {
    await client.send(new PutObjectCommand(input));
    console.log(`✅ ${label} (${(size / 1048576).toFixed(1)}MB) → OK in ${Date.now() - t0}ms  key=${Key}`);
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch(() => {});
  } catch (err) {
    console.log(
      `❌ ${label} (${(size / 1048576).toFixed(1)}MB) → FAILED in ${Date.now() - t0}ms\n` +
        `   name=${err.name} Code=${err.Code} http=${err.$metadata?.httpStatusCode}\n` +
        `   message=${err.message}\n` +
        (err.__rawBody ? `   rawBody=${err.__rawBody}\n` : "")
    );
  }
}

(async () => {
  console.log("Endpoint:", get("DO_SPACES_ENDPOINT"), " Bucket:", BUCKET, "\n");
  // Vary ONE factor at a time against the exact overlay key shape.
  await attempt("small, ACL public-read, video/mp4", 64 * 1024, {});
  await attempt("small, NO ACL", 64 * 1024, { ACL: undefined });
  await attempt("small, NO ContentType", 64 * 1024, { ContentType: undefined });
  await attempt("200MB, ACL public-read", 200 * 1024 * 1024, {});
  await attempt("1GB, ACL public-read", 1024 * 1024 * 1024, {});
  console.log(
    "\nReading: if ALL fail → path/ACL/credential issue. If only the big ones fail → size (>5GB needs multipart Upload)."
  );
  console.log("If NO-ACL succeeds but ACL fails → the bucket now rejects x-amz-acl (Object Ownership enforced).");
})();
