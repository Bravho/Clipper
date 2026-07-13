import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * DigitalOcean Spaces S3-compatible client.
 *
 * DO Spaces is fully compatible with the AWS S3 API.
 * The endpoint must point to the region base (e.g. https://sgp1.digitaloceanspaces.com).
 *
 * Required env vars:
 *   DO_SPACES_ENDPOINT  — e.g. https://sgp1.digitaloceanspaces.com
 *   DO_SPACES_REGION    — e.g. sgp1
 *   DO_SPACES_KEY       — Spaces access key ID
 *   DO_SPACES_SECRET    — Spaces secret access key
 *   DO_SPACES_BUCKET    — bucket (Space) name
 */
export const spacesClient = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: process.env.DO_SPACES_REGION ?? "sgp1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
  },
  // forcePathStyle generates https://{endpoint}/{bucket}/{key} instead of
  // https://{bucket}.{endpoint}/{key}. Required for DO Spaces — the virtual-hosted
  // subdomain format causes ERR_CERT_COMMON_NAME_INVALID in browsers because
  // the bucket subdomain is not covered by the DO Spaces SSL certificate.
  forcePathStyle: true,
  // @aws-sdk/client-s3 >= 3.729 adds CRC32 integrity checksums by default
  // (x-amz-checksum-* headers + aws-chunked trailing checksums on streaming
  // PUTs). DigitalOcean Spaces rejects these with an opaque 400 "UnknownError",
  // which surfaces on large streaming uploads (e.g. the montage merge step).
  // Only send/validate checksums when the API actually requires them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const SPACES_BUCKET = process.env.DO_SPACES_BUCKET!;

/**
 * Diagnostic tap: when a request to Spaces returns a 4xx/5xx, the AWS SDK often
 * can't map the body to a known S3 error and throws a generic "UnknownError"
 * that hides WHAT actually rejected the request. This wraps the HTTP handler to
 * stash the RAW response body + response headers onto the response object (which
 * the thrown error references via `error.$response`), so `describeSpacesError`
 * can log them. That is how we identified the real cause of the
 * `overlay_composition` stall: a network intermediary (proxy/firewall on the
 * worker's path — NOT Spaces) returning an HTML `400 Bad request — "Your browser
 * sent an invalid request."` page for any single request body over ~8-15 MB.
 * The `Server`/`Via` response headers name the intermediary.
 */
function attachSpacesErrorTap(client: S3Client): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const handler: any = (client as any).config.requestHandler;
  if (!handler || typeof handler.handle !== "function" || handler.__spacesTapped) return;
  const original = handler.handle.bind(handler);
  handler.handle = async (request: any, options: any) => {
    const result = await original(request, options);
    const resp = result?.response;
    try {
      if (
        resp &&
        typeof resp.statusCode === "number" &&
        resp.statusCode >= 400 &&
        resp.body &&
        typeof resp.body[Symbol.asyncIterator] === "function"
      ) {
        const chunks: Buffer[] = [];
        for await (const c of resp.body) chunks.push(Buffer.from(c));
        const buf = Buffer.concat(chunks);
        resp.__rawBody = buf.toString("utf8").slice(0, 800);
        // Restore a fresh readable so the SDK's own deserializer still works.
        const { Readable } = await import("stream");
        resp.body = Readable.from(buf);
      }
    } catch {
      /* best-effort diagnostics only */
    }
    return result;
  };
  handler.__spacesTapped = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
attachSpacesErrorTap(spacesClient);

/**
 * Run a single DO Spaces operation with bounded exponential-backoff retries.
 *
 * DO Spaces intermittently throttles or resets a request (especially under the
 * concurrent up/downloads the render pipeline generates) and the AWS SDK
 * surfaces these transient failures as an anonymous 400 "UnknownError" whose
 * `String(err)` hides the HTTP status and cause. Retrying absorbs the transient
 * case; on genuine failure we throw an error naming the operation and the SDK
 * metadata so the worker log actually identifies what went wrong.
 *
 * Every heavy-step Spaces send (upload/download in remotionService,
 * animationService, ffmpegService, …) should go through this so a single
 * transient 400 never fails a whole pipeline step. The compose step already had
 * this resilience via a private copy in `ffmpegService`; this is the shared,
 * reusable version.
 */
export async function spacesSendWithRetry<T>(
  label: string,
  send: () => Promise<T>,
  attempts = 4
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await send();
    } catch (err) {
      lastErr = err;
      // DO Spaces sometimes returns a 400 whose XML body the SDK can't map to a
      // known error, surfacing it as name/message "UnknownError" and hiding the
      // real `<Code>`. Dump every field the SDK DID attach (Code, message, the
      // raw response body if present, $metadata) so the log actually names the
      // cause instead of "UnknownError".
      console.error(
        `[spaces] ${label} attempt ${i + 1}/${attempts} failed: ${describeSpacesError(err)}`
      );
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`Spaces ${label} failed after ${attempts} attempts: ${describeSpacesError(lastErr)}`);
}

/**
 * Upload an object to DO Spaces using a SEQUENTIAL, small-part MULTIPART upload.
 *
 * Root cause this works around: a network intermediary on the render worker's
 * path (a proxy / firewall / HTTPS-inspecting appliance — NOT DO Spaces) rejects
 * any single HTTP request whose body exceeds ~8-15 MB. It stalls the oversized
 * request and, after ~50 s, returns a generic HTML `400 Bad request — "Your
 * browser sent an invalid request."` page (which the AWS SDK, expecting S3 XML,
 * surfaces as the opaque 400 "UnknownError" that stalled `overlay_composition`).
 * Requests at/under 8 MB pass instantly. Confirmed with `scripts/test-spaces-
 * upload.js`: 8 MB single PUT OK in ~0.6 s, 16 MB PUT fails at ~50 s with the
 * HTML page.
 *
 * So every large export (compose masters, montage base, styled/overlay clips,
 * watermarked previews) must be sent as multiple SMALL requests, each under the
 * limit. `Upload` with a 5 MB part size (the S3 minimum) and `queueSize: 1`
 * sends the parts one at a time — each a ≤5 MB request that passes cleanly — so
 * neither a single part nor concurrent parts ever exceed the intermediary's
 * per-request cap. (An earlier 8 MB / parallel config made it WORSE: concurrent
 * parts summed over the limit.) Init/Complete are tiny requests that also pass.
 * Bodies under one part go up as a single request automatically.
 *
 * NOTE: this is a client-side mitigation. The proper fix is on the worker's
 * network — remove/relax the ~8 MB request-body limit (e.g. disable HTTPS body
 * inspection for `*.digitaloceanspaces.com`, or move the worker off that proxy).
 */
/** Parts smaller than this go up as a single PutObject; larger bodies multipart. */
const SPACES_PART_SIZE = 5 * 1024 * 1024; // 5 MB — the S3 minimum part size

export async function spacesUpload(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  acl?: "public-read" | "private";
}): Promise<void> {
  const body = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
  const acl = params.acl ?? "public-read";

  // Small enough to clear the intermediary's per-request cap in one shot.
  if (body.length <= SPACES_PART_SIZE) {
    await spacesSendWithRetry(`upload ${params.key}`, () =>
      spacesClient.send(
        new PutObjectCommand({
          Bucket: SPACES_BUCKET,
          Key: params.key,
          Body: body,
          ContentType: params.contentType,
          ACL: acl,
        })
      )
    );
    return;
  }

  // Larger: SEQUENTIAL multipart with 5 MB parts. Each UploadPart is its own
  // ≤5 MB request that clears the cap; Init/Complete are tiny. Done manually
  // with client-s3 commands (no @aws-sdk/lib-storage — it skewed the SDK types).
  const created = await spacesSendWithRetry(`mpu-init ${params.key}`, () =>
    spacesClient.send(
      new CreateMultipartUploadCommand({
        Bucket: SPACES_BUCKET,
        Key: params.key,
        ContentType: params.contentType,
        ACL: acl,
      })
    )
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error(`Spaces mpu-init ${params.key}: no UploadId returned`);

  try {
    const parts: { ETag: string | undefined; PartNumber: number }[] = [];
    let partNumber = 1;
    for (let offset = 0; offset < body.length; offset += SPACES_PART_SIZE) {
      const chunk = body.subarray(offset, Math.min(offset + SPACES_PART_SIZE, body.length));
      const pn = partNumber++;
      // Await each part before starting the next — sequential, never concurrent,
      // so in-flight bytes never sum over the intermediary's per-request cap.
      const res = await spacesSendWithRetry(`mpu-part ${pn} ${params.key}`, () =>
        spacesClient.send(
          new UploadPartCommand({
            Bucket: SPACES_BUCKET,
            Key: params.key,
            UploadId: uploadId,
            PartNumber: pn,
            Body: chunk,
          })
        )
      );
      parts.push({ ETag: res.ETag, PartNumber: pn });
    }
    await spacesSendWithRetry(`mpu-complete ${params.key}`, () =>
      spacesClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: SPACES_BUCKET,
          Key: params.key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      )
    );
  } catch (err) {
    // Clean up the dangling multipart so a retry starts fresh and no partial
    // object lingers (best-effort — never mask the original failure).
    await spacesClient
      .send(new AbortMultipartUploadCommand({ Bucket: SPACES_BUCKET, Key: params.key, UploadId: uploadId }))
      .catch(() => {});
    throw err;
  }
}

/** Extract every diagnostic field an AWS SDK S3 error carries into one string. */
function describeSpacesError(err: unknown): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const e = err as any;
  const resp = e?.$response;
  // The error tap (attachSpacesErrorTap) stashes the raw body on the response;
  // fall back to a string body if the SDK left one there.
  const rawBody: string | undefined =
    typeof resp?.__rawBody === "string"
      ? resp.__rawBody
      : typeof resp?.body === "string"
      ? resp.body.slice(0, 800)
      : undefined;
  // Server/Via response headers identify a proxy/intermediary in the path.
  const h = resp?.headers ?? {};
  const via = h["via"] ?? h["Via"];
  const server = h["server"] ?? h["Server"];
  return JSON.stringify({
    name: e?.name,
    code: e?.Code,
    message: e?.message,
    http: e?.$metadata?.httpStatusCode ?? resp?.statusCode,
    server,
    via,
    rawBody,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Build a public URL for a stored object.
 *
 * Uses DO_SPACES_CDN_ENDPOINT if set (recommended for delivery performance).
 * Falls back to the standard Spaces URL format:
 *   https://{bucket}.{region}.digitaloceanspaces.com/{key}
 */
export function spacesPublicUrl(key: string): string {
  if (process.env.DO_SPACES_CDN_ENDPOINT) {
    return `${process.env.DO_SPACES_CDN_ENDPOINT}/${key}`;
  }
  // Path-style URL to match forcePathStyle: true on the S3 client
  const endpoint = process.env.DO_SPACES_ENDPOINT!;
  const bucket = process.env.DO_SPACES_BUCKET!;
  return `${endpoint}/${bucket}/${key}`;
}

/** Default lifetime for a presigned GET URL (1 hour). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Build a short-lived presigned GET URL for a private object.
 *
 * Use this for anything that should NOT be world-readable via a public URL —
 * raw uploads (`request_mat/`), base renders (`ai_videos/`), and final
 * deliverables served for the 7-day download window. Thumbnails remain public
 * and should keep using `spacesPublicUrl`.
 *
 * NOTE: privatising these prefixes also requires uploading their objects with
 * `ACL: "private"` (they are currently written with `ACL: "public-read"`, which
 * keeps them publicly reachable regardless of the bucket policy).
 */
export async function spacesSignedUrl(
  key: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  return getSignedUrl(
    spacesClient,
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
    { expiresIn: ttlSeconds }
  );
}
