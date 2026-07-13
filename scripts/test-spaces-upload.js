/**
 * test-spaces-upload.js — capture the REAL DO Spaces error behind the opaque
 * 400 "UnknownError" that stalls the `overlay_composition` step.
 *
 * The AWS SDK reports these failures as "UnknownError" and hides DO's actual
 * XML error body. This script:
 *   1. taps the HTTP layer to print the RAW response body (DO's <Code>/<Message>),
 *   2. prints the outgoing checksum/encoding headers actually sent,
 *   3. sweeps a range of sizes as single PutObjects to find where it flips,
 *   4. also tries one multipart upload.
 *
 * Run on the Mac worker (repo root, .env.local populated):
 *   node scripts/test-spaces-upload.js
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");
const { Readable } = require("stream");
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

// --- Tap 1: capture the outgoing request headers actually sent on the wire.
let lastReqHeaders = null;
client.middlewareStack.add(
  (next) => async (args) => {
    lastReqHeaders = { ...args.request.headers };
    return next(args);
  },
  { step: "finalizeRequest", priority: "low", name: "capReqHeaders" }
);

// --- Tap 2: tee the raw HTTP response body + headers (before the SDK consumes it).
let lastRawBody = null;
let lastStatus = null;
let lastRespHeaders = null;
const rh = client.config.requestHandler;
const origHandle = rh.handle.bind(rh);
rh.handle = async (request, options) => {
  const result = await origHandle(request, options);
  const resp = result.response;
  lastStatus = resp.statusCode;
  if (resp.statusCode >= 400) {
    lastRespHeaders = resp.headers || {};
    if (resp.body && typeof resp.body[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const c of resp.body) chunks.push(c);
      const buf = Buffer.concat(chunks);
      lastRawBody = buf.toString("utf8").slice(0, 1000);
      resp.body = Readable.from(buf); // restore so the SDK can still parse it
    }
  }
  return result;
};

// Which response headers identify the intermediary that answered.
function proxyHeaders() {
  const h = lastRespHeaders || {};
  const keys = ["server", "via", "x-cache", "x-served-by", "cf-ray", "x-squid-error", "proxy-connection", "x-amz-request-id"];
  const picked = {};
  for (const k of keys) {
    const v = h[k] ?? h[k.replace(/\b\w/g, (c) => c.toUpperCase())];
    if (v !== undefined) picked[k] = v;
  }
  return JSON.stringify(picked);
}

const CHK = ["content-length", "content-encoding", "x-amz-content-sha256", "x-amz-trailer", "x-amz-sdk-checksum-algorithm", "x-amz-decoded-content-length"];

function keyFor() {
  const date = new Date().toISOString().slice(0, 10);
  return `final_exports/_diag/${date}/9-16/${crypto.randomUUID()}.mp4`;
}

function showHeaders() {
  const h = lastReqHeaders || {};
  const picked = {};
  for (const k of CHK) if (h[k] !== undefined) picked[k] = String(h[k]).slice(0, 40);
  return JSON.stringify(picked);
}

async function singlePut(mb) {
  const size = Math.round(mb * 1024 * 1024);
  const Key = keyFor();
  lastReqHeaders = lastRawBody = lastStatus = null;
  const t0 = Date.now();
  try {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: Buffer.alloc(size, 7), ContentType: "video/mp4", ACL: "public-read" }));
    console.log(`✅ single ${mb}MB OK (${Date.now() - t0}ms)  headers=${showHeaders()}`);
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch(() => {});
  } catch (err) {
    console.log(`❌ single ${mb}MB FAILED (${Date.now() - t0}ms) http=${err.$metadata?.httpStatusCode || lastStatus} name=${err.name} Code=${err.Code}`);
    console.log(`     out headers=${showHeaders()}`);
    console.log(`     responder headers=${proxyHeaders()}`);
    console.log(`     raw body=${lastRawBody || "(empty / none captured)"}`);
  }
}

// Manual SEQUENTIAL 5 MB multipart — the exact shape the fix uses (spacesUpload).
async function multipart(mb) {
  const size = Math.round(mb * 1024 * 1024);
  const body = Buffer.alloc(size, 7);
  const Key = keyFor();
  const PART = 5 * 1024 * 1024;
  lastReqHeaders = lastRawBody = lastStatus = null;
  const t0 = Date.now();
  let uploadId;
  try {
    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key, ContentType: "video/mp4", ACL: "public-read" }));
    uploadId = created.UploadId;
    const parts = [];
    let pn = 1;
    for (let off = 0; off < body.length; off += PART) {
      const chunk = body.subarray(off, Math.min(off + PART, body.length));
      const res = await client.send(new UploadPartCommand({ Bucket: BUCKET, Key, UploadId: uploadId, PartNumber: pn, Body: chunk }));
      parts.push({ ETag: res.ETag, PartNumber: pn });
      pn++;
    }
    await client.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    console.log(`✅ multipart ${mb}MB (5MB sequential parts) OK (${Date.now() - t0}ms, ${parts.length} parts)`);
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch(() => {});
  } catch (err) {
    if (uploadId) await client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key, UploadId: uploadId })).catch(() => {});
    console.log(`❌ multipart ${mb}MB FAILED (${Date.now() - t0}ms) http=${err.$metadata?.httpStatusCode || lastStatus} name=${err.name} Code=${err.Code}`);
    console.log(`     out headers=${showHeaders()}`);
    console.log(`     responder headers=${proxyHeaders()}`);
    console.log(`     raw body=${lastRawBody || "(empty / none captured)"}`);
  }
}

(async () => {
  console.log("Endpoint:", get("DO_SPACES_ENDPOINT"), " Bucket:", BUCKET);
  console.log("env AWS_REQUEST_CHECKSUM_CALCULATION =", process.env.AWS_REQUEST_CHECKSUM_CALCULATION || "(unset)");
  console.log("env AWS_RESPONSE_CHECKSUM_VALIDATION =", process.env.AWS_RESPONSE_CHECKSUM_VALIDATION || "(unset)");
  console.log("Size sweep (single PutObject):\n");
  for (const mb of [0.1, 1, 2, 4, 8, 16, 26]) await singlePut(mb);
  console.log("\nManual sequential 5MB multipart (this is what the fix does):\n");
  await multipart(26);
  console.log("\n→ Expected: single PUT flips OK→FAILED between 8 and 16 MB with a proxy HTML 400,");
  console.log("  but the 5MB-part multipart SUCCEEDS (each request stays under the intermediary's cap).");
  console.log("  The 'responder headers' (Server/Via) on a failure name the proxy in your network path.");
})();
