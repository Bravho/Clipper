/**
 * Regression tests for runDeviceRender's completion branch. Mocked: the
 * phone bridge (native render, upload, local-file release), the server (fetch,
 * routed by URL), and the manifest contract (pass-through). Real: the
 * claim → render → authorise → PUT → finish → complete → cleanup sequence.
 */

jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } }));

jest.mock("@/lib/mobile/deviceRenderContract", () => ({
  validateDeviceRenderManifest: (m: unknown) => m,
}));

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
  getNativeRenderCapabilities: jest.fn(async () => ({
    nativePluginVersion: 6,
    freeBytes: 5_000_000_000,
    supportsH264Encode: true,
    supportsAacEncode: true,
  })),
}));

jest.mock("@/lib/mobile/finishedVideoCache", () => ({ keepFinishedVideo: jest.fn(async () => undefined) }));

jest.mock("@/lib/mobile/renderProgressDetail", () => ({
  describeRenderPosition: () => "",
  englishProgressText: (key: string) => key,
  planFromManifest: () => ({}),
}));

import { isUsableAssetId, runDeviceRender } from "@/lib/mobile/deviceRenderClient";
import * as bridge from "@/lib/mobile/deviceRenderBridge";

const MANIFEST = {
  jobId: "job-1",
  step: "overlay",
  stage: "montage",
  ratio: "9:16",
  version: 1,
  width: 1080,
  height: 1920,
  scenes: [],
  sources: [],
  captions: [],
  buildFromSources: false,
};

const RENDERED = {
  path: "/cache/out-1.mp4",
  coverPath: null,
  durationSeconds: 10,
  fileSizeBytes: 1_000_000,
  width: 1080,
  height: 1920,
  hasAudioTrack: true,
  crossDissolved: false,
};

type Routes = {
  complete?: () => { status: number; body: unknown };
};

/** Routes every server call used by runDeviceRender. */
function serve(routes: Routes = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const json = (status: number, payload: unknown) =>
      ({ ok: status < 400, status, json: async () => payload }) as Response;
    if (url.endsWith("/api/device-render/claim")) {
      return json(200, { claimed: true, attemptId: "attempt-1", manifest: MANIFEST, heartbeatSeconds: 60 });
    }
    if (url.includes("/progress")) return json(200, { ok: true, cancelled: false });
    if (url.includes("/upload") && body?.action === "authorize") {
      return json(200, {
        storageKey: "k/1.mp4",
        uploadId: "u-1",
        partSizeBytes: 5_000_000,
        parts: [{ partNumber: 1, url: "https://put/1" }],
        coverStorageKey: null,
        coverUrl: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.includes("/upload") && body?.action === "finish") return json(200, { ok: true });
    if (url.includes("/complete")) {
      const r = routes.complete ? routes.complete() : { status: 200, body: { ok: true, assetId: "asset-1" } };
      return json(r.status, r.body);
    }
    if (url.includes("/release")) return json(200, { released: true });
    return json(404, { error: "unexpected route " + url });
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return { calls, fetchMock };
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { document: unknown }).document = { visibilityState: "visible" };
  (bridge.renderManifestOnDevice as jest.Mock).mockImplementation(async () => RENDERED);
});

const run = (shouldCancel?: () => boolean) =>
  runDeviceRender({ requestId: "req-1", shouldCancel: shouldCancel ?? (() => false) });

describe("isUsableAssetId", () => {
  it.each([undefined, null, "", "   ", "\t\n", 42, {}])("rejects %p", (value) => {
    expect(isUsableAssetId(value)).toBe(false);
  });
  it("accepts a real id", () => {
    expect(isUsableAssetId("asset-1")).toBe(true);
    expect(isUsableAssetId(" a ")).toBe(true);
  });
});

describe("runDeviceRender completion branch", () => {
  it("valid completion: completed, asset id returned, local output released once", async () => {
    serve();
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "completed", assetId: "asset-1" });
    expect(bridge.releaseRenderedOutput).toHaveBeenCalledTimes(1);
    expect(bridge.releaseRenderedOutput).toHaveBeenCalledWith("/cache/out-1.mp4");
  });

  it.each([
    ["missing", () => ({ status: 200, body: { ok: true } })],
    ["null", () => ({ status: 200, body: { ok: true, assetId: null } })],
    ["empty", () => ({ status: 200, body: { ok: true, assetId: "" } })],
    ["whitespace-only", () => ({ status: 200, body: { ok: true, assetId: "   " } })],
  ])("%s asset id: failed as complete_without_asset, local output kept", async (_name, complete) => {
    const { calls } = serve({ complete });
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "failed", reason: "complete_without_asset" });
    expect(bridge.releaseRenderedOutput).not.toHaveBeenCalled();
    // The phone releases its claim on the server; the server ignores it once the attempt is completed.
    expect(calls.some((c) => c.url.includes("/release"))).toBe(true);
  });

  it("failed complete (server error): failed, local output kept", async () => {
    serve({ complete: () => ({ status: 500, body: { error: "boom" } }) });
    const outcome = await run();
    expect(outcome.status).toBe("failed");
    expect(bridge.releaseRenderedOutput).not.toHaveBeenCalled();
  });

  it("cancellation after render, before upload: released, local output kept", async () => {
    const { calls } = serve();
    let rendered = false;
    (bridge.renderManifestOnDevice as jest.Mock).mockImplementation(async () => {
      rendered = true;
      return RENDERED;
    });
    const outcome = await run(() => rendered);
    expect(outcome.status).toBe("released");
    expect(bridge.releaseRenderedOutput).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/complete"))).toBe(false);
  });

  it("cancellation before render: nothing rendered, nothing deleted, nothing completed", async () => {
    const { calls } = serve();
    const outcome = await run(() => true);
    expect(outcome.status).toBe("released");
    expect(bridge.renderManifestOnDevice).not.toHaveBeenCalled();
    expect(bridge.releaseRenderedOutput).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/complete"))).toBe(false);
  });

  it("does not authorise an upload when the render was cancelled", async () => {
    const { calls } = serve();
    let rendered = false;
    (bridge.renderManifestOnDevice as jest.Mock).mockImplementation(async () => {
      rendered = true;
      return RENDERED;
    });
    await run(() => rendered);
    expect(calls.some((c) => c.url.includes("/upload"))).toBe(false);
  });
});
