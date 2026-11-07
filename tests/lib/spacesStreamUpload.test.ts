/**
 * Tests for spacesUploadStream.
 * Uses a fake S3 client — never calls the real network.
 */

jest.mock("@/lib/spaces", () => ({
  spacesClient: {},
  SPACES_BUCKET: "test-bucket",
  spacesSendWithRetry: jest.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

import { spacesUploadStream } from "@/lib/spacesStreamUpload";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});

// ---------------------------------------------------------------------------
// Helpers

function makeFakeS3() {
  const calls: { command: string; params: Record<string, unknown> }[] = [];

  let partNumber = 0;
  let uploadId = "fake-upload-id";

  const send = jest.fn(async (cmd: object) => {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    calls.push({ command: name, params: cmd as Record<string, unknown> });

    if (name === "PutObjectCommand") return {};
    if (name === "CreateMultipartUploadCommand") return { UploadId: uploadId };
    if (name === "UploadPartCommand") return { ETag: `etag-${++partNumber}` };
    if (name === "CompleteMultipartUploadCommand") return {};
    if (name === "AbortMultipartUploadCommand") return {};
    return {};
  });

  return { send, calls };
}

function toStream(data: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
}

async function* toAsyncIterable(data: Buffer): AsyncIterable<Uint8Array> {
  yield new Uint8Array(data);
}

// ---------------------------------------------------------------------------

describe("spacesUploadStream — small body (< 5 MB)", () => {
  it("uses a single PutObject for a small body", async () => {
    const fake = makeFakeS3();
    const body = Buffer.alloc(1024, "x");

    const result = await spacesUploadStream({
      key: "test/small.mp4",
      body: toStream(body),
      contentType: "video/mp4",
      acl: "private",
      client: fake as unknown as import("@aws-sdk/client-s3").S3Client,
      bucket: "test-bucket",
    });

    const putCalls = fake.calls.filter((c) => c.command === "PutObjectCommand");
    const mpuCalls = fake.calls.filter((c) => c.command === "CreateMultipartUploadCommand");
    expect(putCalls).toHaveLength(1);
    expect(mpuCalls).toHaveLength(0);
    expect(result.sizeBytes).toBe(1024);
  });
});

describe("spacesUploadStream — large body (> 5 MB)", () => {
  it("uses multipart upload with sequential parts", async () => {
    const fake = makeFakeS3();
    // 11 MB: should split into 2 parts (5 MB + 6 MB, but 5+5+1 in our chunker)
    const body = Buffer.alloc(11 * 1024 * 1024, "y");

    const result = await spacesUploadStream({
      key: "test/large.mp4",
      body: toStream(body),
      contentType: "video/mp4",
      acl: "private",
      client: fake as unknown as import("@aws-sdk/client-s3").S3Client,
      bucket: "test-bucket",
    });

    const initCalls = fake.calls.filter((c) => c.command === "CreateMultipartUploadCommand");
    const partCalls = fake.calls.filter((c) => c.command === "UploadPartCommand");
    const completeCalls = fake.calls.filter((c) => c.command === "CompleteMultipartUploadCommand");
    expect(initCalls).toHaveLength(1);
    expect(partCalls.length).toBeGreaterThanOrEqual(2);
    expect(completeCalls).toHaveLength(1);
    expect(result.sizeBytes).toBe(11 * 1024 * 1024);
  });

  it("aborts the multipart upload on part failure", async () => {
    const fake = makeFakeS3();
    let partCount = 0;
    fake.send.mockImplementation(async (cmd: object) => {
      const name = (cmd as { constructor: { name: string } }).constructor.name;
      fake.calls.push({ command: name, params: cmd as Record<string, unknown> });
      if (name === "CreateMultipartUploadCommand") return { UploadId: "upload-fail-test" };
      if (name === "UploadPartCommand") {
        partCount++;
        if (partCount === 2) throw new Error("network error");
        return { ETag: "etag-1" };
      }
      if (name === "AbortMultipartUploadCommand") return {};
      return {};
    });

    const body = Buffer.alloc(11 * 1024 * 1024, "z");
    await expect(
      spacesUploadStream({
        key: "test/fail.mp4",
        body: toStream(body),
        contentType: "video/mp4",
        client: fake as unknown as import("@aws-sdk/client-s3").S3Client,
        bucket: "test-bucket",
      })
    ).rejects.toThrow("network error");

    const abortCalls = fake.calls.filter((c) => c.command === "AbortMultipartUploadCommand");
    expect(abortCalls).toHaveLength(1);
  });
});

describe("spacesUploadStream — maxBytes enforcement", () => {
  it("throws when the stream exceeds maxBytes", async () => {
    const fake = makeFakeS3();
    const body = Buffer.alloc(2048, "m");

    await expect(
      spacesUploadStream({
        key: "test/overflow.mp4",
        body: toStream(body),
        contentType: "video/mp4",
        maxBytes: 1000,
        client: fake as unknown as import("@aws-sdk/client-s3").S3Client,
        bucket: "test-bucket",
      })
    ).rejects.toThrow(/maxBytes/);
  });
});

describe("spacesUploadStream — AsyncIterable input", () => {
  it("accepts an AsyncIterable body", async () => {
    const fake = makeFakeS3();
    const body = Buffer.alloc(512, "a");

    const result = await spacesUploadStream({
      key: "test/iter.mp4",
      body: toAsyncIterable(body),
      contentType: "video/mp4",
      client: fake as unknown as import("@aws-sdk/client-s3").S3Client,
      bucket: "test-bucket",
    });

    expect(result.sizeBytes).toBe(512);
  });
});
