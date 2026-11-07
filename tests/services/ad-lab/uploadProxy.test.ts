/**
 * Tests for POST /api/ad-lab/avatar/twins/upload-proxy
 * Covers: param validation, Content-Length fast-fail, successful proxy, HeyGen PUT failure.
 */

jest.mock("@/app/api/ad-lab/_guard", () => ({
  requireAdLabUser: jest.fn(),
}));

jest.mock("@/app/api/ad-lab/avatar/_service", () => ({
  avatarService: {
    initiateTwinUpload: jest.fn(),
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/ad-lab/avatar/twins/upload-proxy/route";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { avatarService } from "@/app/api/ad-lab/avatar/_service";

const guardMock = requireAdLabUser as jest.Mock;
const initiateMock = avatarService.initiateTwinUpload as jest.Mock;

const AUTHED = { ok: true as const, user: { id: "u1", email: "u@test.com" } };

const INITIATE_RESULT = {
  assetId: "asset-xyz",
  uploadUrl: "https://s3.example.com/presigned",
  uploadHeaders: { "Content-Type": "video/mp4" },
};

const VALID_PARAMS = { fileName: "twin.mp4", contentType: "video/mp4", sizeBytes: "1024" };

function makeRequest(
  params: Record<string, string>,
  opts: { contentLength?: number; body?: ReadableStream<Uint8Array> | null } = {}
): NextRequest {
  const url = new URL("http://localhost/api/ad-lab/avatar/twins/upload-proxy");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.contentLength != null) headers["content-length"] = String(opts.contentLength);
  return new NextRequest(url.toString(), {
    method: "POST",
    headers,
    body: opts.body ?? null,
    // @ts-expect-error duplex is required for streaming in Node.js fetch
    duplex: "half",
  });
}

function smallStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new Uint8Array([1, 2, 3]));
      ctrl.close();
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  guardMock.mockResolvedValue(AUTHED);
  global.fetch = jest.fn();
});

// ---------------------------------------------------------------------------

describe("POST /api/ad-lab/avatar/twins/upload-proxy — auth", () => {
  it("passes through guard 404 when user is not allowed", async () => {
    guardMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Not found." }, { status: 404 }),
    });
    const res = await POST(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/ad-lab/avatar/twins/upload-proxy — param validation", () => {
  it("returns 400 when fileName is missing", async () => {
    const { fileName: _f, ...rest } = VALID_PARAMS;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/fileName/);
  });

  it("returns 400 when contentType is missing", async () => {
    const { contentType: _c, ...rest } = VALID_PARAMS;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it("returns 400 when sizeBytes is missing", async () => {
    const { sizeBytes: _s, ...rest } = VALID_PARAMS;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it("returns 400 when sizeBytes is zero", async () => {
    const res = await POST(makeRequest({ ...VALID_PARAMS, sizeBytes: "0" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when sizeBytes is not a number", async () => {
    const res = await POST(makeRequest({ ...VALID_PARAMS, sizeBytes: "abc" }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/ad-lab/avatar/twins/upload-proxy — Content-Length fast-fail", () => {
  it("returns 413 when Content-Length header exceeds 200 MB", async () => {
    const over200mb = 200 * 1024 * 1024 + 1;
    const res = await POST(makeRequest(VALID_PARAMS, { contentLength: over200mb }));
    expect(res.status).toBe(413);
  });

  it("does not reject when Content-Length is exactly 200 MB", async () => {
    initiateMock.mockResolvedValue(INITIATE_RESULT);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const exactly200mb = 200 * 1024 * 1024;
    const res = await POST(
      makeRequest(VALID_PARAMS, { contentLength: exactly200mb, body: smallStream() })
    );
    // Should proceed past the Content-Length check (may fail for other reasons but not 413)
    expect(res.status).not.toBe(413);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/ad-lab/avatar/twins/upload-proxy — successful upload", () => {
  it("returns 200 with assetId from initiateTwinUpload", async () => {
    initiateMock.mockResolvedValue(INITIATE_RESULT);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const res = await POST(makeRequest(VALID_PARAMS, { body: smallStream() }));
    expect(res.status).toBe(200);
    const data = await res.json() as { assetId: string };
    expect(data.assetId).toBe("asset-xyz");
  });

  it("calls initiateTwinUpload with the userId from the guard", async () => {
    initiateMock.mockResolvedValue(INITIATE_RESULT);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await POST(makeRequest(VALID_PARAMS, { body: smallStream() }));
    expect(initiateMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ fileName: "twin.mp4", contentType: "video/mp4", sizeBytes: 1024 })
    );
  });

  it("passes optional durationSec to initiateTwinUpload when provided", async () => {
    initiateMock.mockResolvedValue(INITIATE_RESULT);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await POST(
      makeRequest({ ...VALID_PARAMS, durationSec: "90" }, { body: smallStream() })
    );
    expect(initiateMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ durationSec: 90 })
    );
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/ad-lab/avatar/twins/upload-proxy — HeyGen PUT failure", () => {
  it("returns 502 when HeyGen presigned URL returns non-2xx", async () => {
    initiateMock.mockResolvedValue(INITIATE_RESULT);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      text: jest.fn(async () => "Forbidden"),
    });
    const res = await POST(makeRequest(VALID_PARAMS, { body: smallStream() }));
    expect(res.status).toBe(502);
  });
});
