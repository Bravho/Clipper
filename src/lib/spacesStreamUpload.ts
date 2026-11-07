import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { spacesClient, SPACES_BUCKET, spacesSendWithRetry } from "@/lib/spaces";

/** 5 MB — the S3 minimum multipart part size (and under the ~8 MB intermediary cap). */
const PART_SIZE = 5 * 1024 * 1024;

/**
 * Stream-upload a ReadableStream or AsyncIterable to DO Spaces.
 *
 * Unlike `spacesUpload` (which needs the whole Buffer), this never holds more
 * than about one part (5 MB, plus the chunk being read) in memory: each part is
 * uploaded as soon as it fills, sequentially, so no single request body exceeds
 * the ~8 MB per-request cap documented in src/lib/spaces.ts.
 *
 * A body that ends before filling one part goes up as a single PutObject.
 * On any failure (including exceeding `maxBytes`) an in-progress multipart
 * upload is aborted (best-effort) so no dangling partial object lingers.
 */
export async function spacesUploadStream(params: {
  key: string;
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
  contentType: string;
  acl?: "private" | "public-read";
  client?: S3Client;
  bucket?: string;
  maxBytes?: number;
}): Promise<{ sizeBytes: number }> {
  const client = params.client ?? spacesClient;
  const bucket = params.bucket ?? SPACES_BUCKET;
  const acl = params.acl ?? "private";
  const maxBytes = params.maxBytes ?? Infinity;

  const iter: AsyncIterable<Uint8Array> =
    Symbol.asyncIterator in params.body
      ? (params.body as AsyncIterable<Uint8Array>)
      : readableStreamToAsyncIterable(params.body as ReadableStream<Uint8Array>);

  let pending: Buffer[] = [];
  let pendingSize = 0;
  let totalSize = 0;
  let uploadId: string | undefined;
  const completedParts: { ETag: string | undefined; PartNumber: number }[] = [];

  const takePending = (size: number): Buffer => {
    const all = Buffer.concat(pending);
    const part = all.subarray(0, size);
    const rest = all.subarray(size);
    pending = rest.length ? [rest] : [];
    pendingSize = rest.length;
    return part;
  };

  const uploadPart = async (body: Buffer) => {
    if (!uploadId) {
      const created = await spacesSendWithRetry(`mpu-init ${params.key}`, () =>
        client.send(
          new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: params.key,
            ContentType: params.contentType,
            ACL: acl,
          })
        )
      );
      if (!created.UploadId) {
        throw new Error(`spacesUploadStream mpu-init ${params.key}: no UploadId`);
      }
      uploadId = created.UploadId;
    }
    const partNumber = completedParts.length + 1;
    const id = uploadId;
    const res = await spacesSendWithRetry(`mpu-part ${partNumber} ${params.key}`, () =>
      client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: params.key,
          UploadId: id,
          PartNumber: partNumber,
          Body: body,
        })
      )
    );
    completedParts.push({ ETag: res.ETag, PartNumber: partNumber });
  };

  try {
    for await (const chunk of iter) {
      totalSize += chunk.byteLength;
      if (totalSize > maxBytes) {
        throw new Error(`spacesUploadStream: stream exceeded maxBytes limit (${maxBytes})`);
      }
      pending.push(Buffer.from(chunk));
      pendingSize += chunk.byteLength;
      // Upload each full part immediately; the last (short) part waits for end-of-stream.
      while (pendingSize >= PART_SIZE) {
        await uploadPart(takePending(PART_SIZE));
      }
    }

    if (!uploadId) {
      // Whole body fit in less than one part: single PutObject (may be zero bytes).
      const body = takePending(pendingSize);
      await spacesSendWithRetry(`upload ${params.key}`, () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: params.key,
            Body: body,
            ContentType: params.contentType,
            ACL: acl,
          })
        )
      );
      return { sizeBytes: totalSize };
    }

    if (pendingSize > 0) await uploadPart(takePending(pendingSize));

    const id = uploadId;
    await spacesSendWithRetry(`mpu-complete ${params.key}`, () =>
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: params.key,
          UploadId: id,
          MultipartUpload: { Parts: completedParts },
        })
      )
    );
    return { sizeBytes: totalSize };
  } catch (err) {
    if (uploadId) {
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: params.key, UploadId: uploadId }))
        .catch(() => {});
    }
    throw err;
  }
}

function readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const reader = stream.getReader();
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done) return { done: true as const, value: undefined };
          return { done: false, value };
        },
        async return() {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}