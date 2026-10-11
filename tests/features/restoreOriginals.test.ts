/**
 * Reopening the studio after Submit: a clip whose PREVIEW cannot be made is
 * not a lost original (it was reported as gone, and the person was told to
 * start again, while the file was still kept). Only a file that is really not
 * there — or past its keep window — counts as missing.
 */
const readLocalMaterial = jest.fn();
class LocalMaterialExpiredError extends Error {}
jest.mock("@/features/requests/localMediaStore", () => ({
  readLocalMaterial: (...args: unknown[]) => readLocalMaterial(...args),
  LocalMaterialExpiredError,
  createLocalAnalysisFrame: jest.fn(),
  restoreLocalMaterial: jest.fn(),
  retainLocalFile: jest.fn(),
}));
const prepareClip = jest.fn();
jest.mock("@/features/device-render/clipPreview", () => ({
  prepareClip: (...args: unknown[]) => prepareClip(...args),
}));
jest.mock("@/lib/mobile/deviceRenderBridge", () => ({
  describeDeviceRenderCapability: jest.fn(),
  supportsManifestRender: jest.fn(),
}));

import { restoreStudioSources } from "@/features/device-render/studioPipeline";

(globalThis as { URL: typeof URL }).URL.createObjectURL = () => "blob:x";

const clip = (n: number) => ({
  localId: `req--clip${n}`,
  fileName: `1586${n}.mp4`,
  mimeType: "video/mp4" as const,
  fileSizeBytes: 1000,
  durationSeconds: 5,
});

describe("restoreStudioSources", () => {
  beforeEach(() => {
    readLocalMaterial.mockReset();
    prepareClip.mockReset();
  });

  it("keeps a clip whose preview could not be made", async () => {
    readLocalMaterial.mockResolvedValue(new File([new Uint8Array(4)], "a.mp4", { type: "video/mp4" }));
    prepareClip.mockRejectedValue(new Error("clip unreadable in the browser"));
    const out = await restoreStudioSources([clip(1), clip(2)]);
    expect(out.missingMedia).toEqual([]);
    expect(out.sources).toHaveLength(2);
    expect(out.sources[0]).toMatchObject({ kind: "clip", posterUrl: null, durationSeconds: 5 });
  });

  it("reports a file that is really not there", async () => {
    const notFound = Object.assign(new Error("gone"), { name: "NotFoundError" });
    readLocalMaterial.mockRejectedValue(notFound);
    const out = await restoreStudioSources([clip(1)]);
    expect(out.missing).toEqual(["15861.mp4"]);
    expect(readLocalMaterial).toHaveBeenCalledTimes(1);
  });

  it("tries a passing read error again before giving up", async () => {
    readLocalMaterial
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(new File([new Uint8Array(4)], "a.mp4", { type: "video/mp4" }));
    prepareClip.mockResolvedValue({ durationSeconds: 5, posterUrl: "data:x", previewUrl: "blob:y" });
    const out = await restoreStudioSources([clip(1)]);
    expect(out.missingMedia).toEqual([]);
    expect(readLocalMaterial).toHaveBeenCalledTimes(2);
  });

  it("counts an original past its keep window as missing", async () => {
    readLocalMaterial.mockRejectedValue(new LocalMaterialExpiredError("old"));
    const out = await restoreStudioSources([clip(1)]);
    expect(out.missing).toEqual(["15861.mp4"]);
  });
});
