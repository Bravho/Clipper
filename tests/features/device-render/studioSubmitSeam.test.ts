/**
 * Mocked regression for the submit seam. Default behaviour must be unchanged;
 * an injected transport must receive exactly the same body.
 */
import {
  buildStudioSubmitBody,
  defaultStudioTransport,
  StudioQuotaError,
  submitStudioRequest,
} from "@/features/device-render/studioPipeline";

const CAPABILITY = { platform: "android", nativePluginVersion: 6, canRenderManifest: true } as never;
const MATERIALS = [{ localId: "m1", fileName: "a.mp4", mimeType: "video/mp4", fileSizeBytes: 10, durationSeconds: 3 }] as never;
const FRAMES = [{ localId: "m1", assetIndex: 0, mimeType: "image/jpeg", dataBase64: "AAAA" }] as never;

describe("buildStudioSubmitBody", () => {
  it("has the exact fields the studio has always sent", () => {
    expect(buildStudioSubmitBody({ materials: MATERIALS, analysisFrames: FRAMES, deviceRender: CAPABILITY })).toEqual({
      creditConfirmed: true,
      rightsConfirmed: true,
      aiProcessingConfirmed: true,
      localMedia: { mode: "local-first", materials: MATERIALS, analysisFrames: FRAMES, deviceRender: CAPABILITY, renderOnDevice: true },
    });
  });
});

describe("defaultStudioTransport", () => {
  it("posts JSON to the given URL, exactly as the studio's own fetch did", async () => {
    const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const body = { a: 1 };
    await defaultStudioTransport("/api/requests/r1/submit", body);
    expect(fetchMock).toHaveBeenCalledWith("/api/requests/r1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });
});

describe("submitStudioRequest: default and injected transport", () => {
  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => new Response("{}", { status: 201 }));
  });

  it("with no transport, the default fetch sends the built body to the submit route", async () => {
    await submitStudioRequest({ requestId: "r1", sources: [] });
    const [url, init] = ((globalThis as unknown as { fetch: jest.Mock }).fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/requests/r1/submit");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true, localMedia: { mode: "local-first", renderOnDevice: true } });
  });

  it("an injected transport receives the same body the default would send, and fetch is not used", async () => {
    // 1) the default run: capture the body it sends
    await submitStudioRequest({ requestId: "r1", sources: [] });
    const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch as jest.Mock;
    const defaultBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // 2) the injected run: fetch must not be touched, and the body must be identical
    fetchMock.mockClear();
    const transport = jest.fn(async () => new Response("{}", { status: 201 }));
    await submitStudioRequest({ requestId: "r1", sources: [], transport });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith("/api/requests/r1/submit", defaultBody);
  });

  it("a 402 quota answer is handled the same way through an injected transport", async () => {
    const transport = jest.fn(async () =>
      new Response(JSON.stringify({ code: "quota_exhausted", nextFreeSlotAt: null }), { status: 402 })
    );
    await expect(submitStudioRequest({ requestId: "r1", sources: [], transport })).rejects.toBeInstanceOf(StudioQuotaError);
  });
});
