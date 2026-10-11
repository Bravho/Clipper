/**
 * Picked media survives the app closing before Submit: the list of private
 * copies is saved per request and read back.
 */
const snapshotFile = jest.fn();
jest.mock("@/features/requests/fileSnapshot", () => ({
  snapshotFile: (...args: unknown[]) => snapshotFile(...args),
}));
jest.mock("@/features/device-render/clipPreview", () => ({
  prepareClip: jest.fn(async () => ({ durationSeconds: 7, posterUrl: "data:p", previewUrl: "blob:c" })),
}));
jest.mock("@/features/device-render/editorState", () => ({
  readImagePoster: jest.fn(async () => "data:i"),
}));

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}
(globalThis as unknown as { window: unknown }).window = { localStorage: new MemoryStorage() };
(globalThis as { URL: typeof URL }).URL.createObjectURL = () => "blob:x";

import {
  clearDraftSources,
  loadDraftSources,
  saveDraftSources,
} from "@/features/device-render/studioDraftMedia";

const source = (id: string, kind: "image" | "clip", snapshotKey: string | null) => ({
  id,
  kind,
  file: new File([new Uint8Array(10)], `${id}.${kind === "clip" ? "mp4" : "jpg"}`, {
    type: kind === "clip" ? "video/mp4" : "image/jpeg",
  }),
  previewUrl: "blob:old",
  posterUrl: null,
  durationSeconds: kind === "clip" ? 7 : null,
  fileName: `${id}.${kind === "clip" ? "mp4" : "jpg"}`,
  snapshotKey,
});

describe("studio draft media", () => {
  beforeEach(() => snapshotFile.mockReset());

  it("reads the picked media back after the app reopens", async () => {
    saveDraftSources("req1", [source("a", "clip", "studio-a"), source("b", "image", "studio-b")]);
    snapshotFile.mockImplementation(async (s: { name: string; type: string }) =>
      new File([new Uint8Array(10)], s.name, { type: s.type })
    );
    const back = await loadDraftSources("req1");
    expect(back.map((s) => [s.id, s.kind, s.snapshotKey])).toEqual([
      ["a", "clip", "studio-a"],
      ["b", "image", "studio-b"],
    ]);
    expect(back[0].posterUrl).toBe("data:p");
  });

  it("skips a copy that is gone and keeps the rest", async () => {
    saveDraftSources("req2", [source("a", "clip", "studio-a"), source("b", "image", "studio-b")]);
    snapshotFile
      .mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotFoundError" }))
      .mockResolvedValueOnce(new File([new Uint8Array(1)], "b.jpg", { type: "image/jpeg" }));
    expect((await loadDraftSources("req2")).map((s) => s.id)).toEqual(["b"]);
  });

  it("forgets the list after Submit", async () => {
    saveDraftSources("req3", [source("a", "clip", "studio-a")]);
    clearDraftSources("req3");
    expect(await loadDraftSources("req3")).toEqual([]);
  });

  it("does not list a source without a private copy", async () => {
    saveDraftSources("req4", [source("a", "clip", null)]);
    expect(await loadDraftSources("req4")).toEqual([]);
  });
});
