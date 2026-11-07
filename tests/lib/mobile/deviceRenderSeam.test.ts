/**
 * Mocked regression for the device-render seam. The default path (no `post`)
 * and the injected path must make the same server calls, in the same order,
 * with the same bodies. A completed result carries its attempt id.
 */
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } }));
jest.mock("@/lib/mobile/deviceRenderContract", () => ({ validateDeviceRenderManifest: (m: unknown) => m }));
jest.mock("@/lib/mobile/deviceRenderBridge", () => {
  class NativeRenderError extends Error {
    log: string[] = [];
  }
  return {
    NativeRenderError,
    cancelDeviceRender: jest.fn(async () => undefined),
    observeManifestProgress: jest.fn(async () => async () => undefined),
    releaseRenderedOutput: jest.fn(async () => undefined),
    renderManifestOnDevice: jest.fn(),
    stageManifestSources: jest.fn(async () => []),
    supportsManifestRender: jest.fn(async () => true),
    uploadRenderedOutput: jest.fn(async () => [{ partNumber: 1, eTag: "e1" }]),
  };
});
jest.mock("@/lib/mobile/deviceVideoRender", () => ({
  getNativeRenderCapabilities: jest.fn(async () => ({ nativePluginVersion: 6, freeBytes: 5_000_000_000, supportsH264Encode: true, supportsAacEncode: true })),
}));
jest.mock("@/lib/mobile/finishedVideoCache", () => ({ keepFinishedVideo: jest.fn(async () => undefined) }));
jest.mock("@/lib/mobile/renderProgressDetail", () => ({
  describeRenderPosition: () => "",
  englishProgressText: (key: string) => key,
  planFromManifest: () => ({}),
}));

import { runDeviceRender, type DeviceRenderPost } from "@/lib/mobile/deviceRenderClient";
import * as bridge from "@/lib/mobile/deviceRenderBridge";

const MANIFEST = {
  jobId: "job-1", step: "overlay", stage: "montage", ratio: "9:16", version: 1,
  width: 1080, height: 1920, scenes: [], sources: [], captions: [], buildFromSources: false,
};
const RENDERED = { path: "/cache/out-1.mp4", coverPath: null, durationSeconds: 10, fileSizeBytes: 1_000_000, width: 1080, height: 1920, hasAudioTrack: true, crossDissolved: false };

/** One place that answers every server call the lifecycle makes. */
function answer(url: string, body: Record<string, unknown> | undefined, opts: { completeStatus?: number } = {}): { status: number; payload: unknown } {
  if (url.endsWith("/api/device-render/claim")) return { status: 200, payload: { claimed: true, attemptId: "attempt-1", manifest: MANIFEST, heartbeatSeconds: 60 } };
  if (url.includes("/progress")) return { status: 200, payload: { ok: true, cancelled: false } };
  if (url.includes("/upload") && body?.action === "authorize") {
    return { status: 200, payload: { storageKey: "k/1.mp4", uploadId: "u-1", partSizeBytes: 5_000_000, parts: [{ partNumber: 1, url: "https://put/1" }], coverStorageKey: null, coverUrl: null, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  }
  if (url.includes("/upload") && body?.action === "finish") return { status: 200, payload: { ok: true } };
  if (url.includes("/complete")) {
    if (opts.completeStatus && opts.completeStatus >= 400) return { status: opts.completeStatus, payload: { error: "boom" } };
    return { status: 200, payload: { ok: true, assetId: "asset-1" } };
  }
  if (url.includes("/release")) return { status: 200, payload: { released: true } };
  return { status: 404, payload: { error: "unexpected " + url } };
}

/** The same answers, served through the default fetch path. Records every call. */
function fetchPath(opts: { completeStatus?: number } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const a = answer(url, body, opts);
    return { ok: a.status < 400, status: a.status, json: async () => a.payload } as Response;
  });
  return calls;
}

/** The same answers, served through an injected `post`. Records every call. */
function injectedPath(opts: { completeStatus?: number } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const post: DeviceRenderPost = (async (url: string, body: unknown) => {
    calls.push({ url, body });
    const a = answer(url, body as Record<string, unknown>, opts);
    if (a.status >= 400) throw new Error(String((a.payload as { error?: string }).error));
    return a.payload;
  }) as DeviceRenderPost;
  return { calls, post };
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { document: unknown }).document = { visibilityState: "visible" };
  (bridge.renderManifestOnDevice as jest.Mock).mockImplementation(async () => RENDERED);
});

const run = (post?: DeviceRenderPost) => runDeviceRender({ requestId: "req-1", shouldCancel: () => false, post });

describe("device-render seam: default and injected paths are the same", () => {
  it("the same server calls, in the same order, with the same bodies", async () => {
    const defaultCalls = fetchPath();
    const defaultOutcome = await run();
    const injected = injectedPath();
    const injectedOutcome = await run(injected.post);
    expect(injected.calls).toEqual(defaultCalls);
    expect(injectedOutcome).toMatchObject({ status: defaultOutcome.status, assetId: defaultOutcome.assetId });
  });

  it("with an injected post, the global fetch is never used for the lifecycle", async () => {
    fetchPath();
    const injected = injectedPath();
    (globalThis as unknown as { fetch: jest.Mock }).fetch.mockClear();
    await run(injected.post);
    expect((globalThis as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
  });

  it("a completed result carries the attempt id that produced it", async () => {
    fetchPath();
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "completed", assetId: "asset-1", attemptId: "attempt-1" });
  });

  it("a failed completion releases through the injected post, and keeps the local output", async () => {
    const injected = injectedPath({ completeStatus: 500 });
    const outcome = await run(injected.post);
    expect(outcome.status).toBe("failed");
    expect(injected.calls.some((c) => c.url === "/api/device-render/attempt-1/release")).toBe(true);
    expect(bridge.releaseRenderedOutput).not.toHaveBeenCalled();
  });
});
