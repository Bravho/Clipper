/**
 * test-spaces.js — verify the DO Spaces credentials in .env.local
 *
 * Usage (from the project root):
 *   node scripts/test-spaces.js
 */
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")) || [])[1]?.trim();

const client = new S3Client({
  endpoint: get("DO_SPACES_ENDPOINT"),
  region: get("DO_SPACES_REGION") || "sgp1",
  credentials: {
    accessKeyId: get("DO_SPACES_KEY"),
    secretAccessKey: get("DO_SPACES_SECRET"),
  },
  forcePathStyle: true,
  // @aws-sdk/client-s3 >= 3.729 sends CRC32 integrity checksums by default;
  // DigitalOcean Spaces rejects them with an opaque 400 "UnknownError".
  // Only send/validate checksums when the API actually requires them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

(async () => {
  console.log("Endpoint:", get("DO_SPACES_ENDPOINT"));
  console.log("Bucket:  ", get("DO_SPACES_BUCKET"));
  console.log("Key ID:  ", (get("DO_SPACES_KEY") || "").slice(0, 8) + "...");
  try {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: get("DO_SPACES_BUCKET"), MaxKeys: 3 })
    );
    console.log("\n✅ Credentials OK — sample keys:");
    (r.Contents || []).forEach((o) => console.log("  -", o.Key));
  } catch (err) {
    console.error("\n❌ FAILED:", err.name, "-", err.message);
    if (err.Code === "InvalidAccessKeyId") {
      console.error(
        "\nThe access key was rejected by DigitalOcean. Generate a new Spaces key:\n" +
          "  DO control panel → API → Spaces Keys → Generate New Key\n" +
          "then update DO_SPACES_KEY and DO_SPACES_SECRET in .env.local and restart the dev server."
      );
    }
    process.exit(1);
  }
})();
