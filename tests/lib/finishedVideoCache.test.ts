/**
 * Finished videos kept on the phone for instant downloads: what is kept, what
 * is found, and what the clean-up removes.
 */
const files = new Map<string, { size: number; mtime: number }>();
const deleted: string[] = [];

jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
jest.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Cache: "CACHE" },
  Filesystem: {
    mkdir: jest.fn(async () => undefined),
    copy: jest.fn(async ({ to }: { to: string }) => {
      files.set(to, { size: 50_000_000, mtime: Date.now() });
    }),
    deleteFile: jest.fn(async ({ path }: { path: string }) => {
      deleted.push(path);
      files.delete(path);
    }),
    stat: jest.fn(async ({ path }: { path: string }) => {
      const file = files.get(path);
      if (!file) throw new Error("does not exist");
      return { size: file.size };
    }),
    getUri: jest.fn(async ({ path, directory }: { path: string; directory: string }) => ({
      uri: `file:///${directory}/${path}`,
    })),
    readdir: jest.fn(async ({ path }: { path: string }) => ({
      files: [...files.entries()]
        .filter(([name]) => name.startsWith(`${path}/`))
        .map(([name, file]) => ({
          name: name.slice(path.length + 1),
          type: "file",
          size: file.size,
          mtime: file.mtime,
        })),
    })),
  },
}));

import {
  finishedVideoUri,
  keepFinishedVideo,
  sweepFinishedVideos,
} from "@/lib/mobile/finishedVideoCache";

beforeEach(() => {
  files.clear();
  deleted.length = 0;
});

describe("finishedVideoCache", () => {
  it("keeps a finished video under its asset id and finds it again", async () => {
    expect(await finishedVideoUri("asset-1")).toBeNull();
    await keepFinishedVideo("asset-1", "/data/user/0/com.rclipper.app/cache/device-render/out.mp4");
    expect(await finishedVideoUri("asset-1")).toBe(
      "file:///DATA/rclipper-finished-videos/asset-1.mp4"
    );
  });

  it("removes copies older than 8 days", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    files.set("rclipper-finished-videos/old.mp4", { size: 10, mtime: now - 9 * day });
    files.set("rclipper-finished-videos/new.mp4", { size: 10, mtime: now - day });
    await sweepFinishedVideos(now);
    expect(deleted).toEqual(["rclipper-finished-videos/old.mp4"]);
  });

  it("keeps the folder under 0.8 GB, dropping the oldest first", async () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      files.set(`rclipper-finished-videos/v${i}.mp4`, { size: 50_000_000, mtime: now - i * 1000 });
    }
    await sweepFinishedVideos(now);
    // 16 × 50 MB = 0.8 GB fits; the 9 oldest go.
    expect(deleted.sort()).toEqual(
      ["v16", "v17", "v18", "v19", "v20", "v21", "v22", "v23", "v24"]
        .map((v) => `rclipper-finished-videos/${v}.mp4`)
        .sort()
    );
  });
});
