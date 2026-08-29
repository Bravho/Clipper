/**
 * Exercises the vault against a fake origin-private filesystem.
 *
 * The vault is what stands between a picked Android file and an upload that
 * reads it minutes later, so the properties that matter are: the copy is exact,
 * a failed copy leaves nothing behind, and the sweep never removes a file that
 * is still in use. None of that needs a real browser to verify.
 */

const VAULT_INDEX_KEY = "clipper:newreq:vault";

// ── Fake OPFS ─────────────────────────────────────────────────────────────
class FakeFileHandle {
  bytes = new Uint8Array(0);
  constructor(public name: string) {}

  async createWritable() {
    const chunks: Uint8Array[] = [];
    const self = this;
    return {
      async write(chunk: Uint8Array) {
        // Emulate a truncating filesystem on demand, to prove the size check
        // catches it. Writes past this many chunks are silently dropped — which
        // is how a quota that runs out mid-copy behaves.
        if (shortWriteAfter !== null && chunks.length >= shortWriteAfter) return;
        chunks.push(chunk);
      },
      async close() {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.byteLength;
        }
        self.bytes = out;
      },
      async abort() {
        chunks.length = 0;
      },
    };
  }

  async getFile() {
    return new File([this.bytes], this.name);
  }
}

class FakeDir {
  files = new Map<string, FakeFileHandle>();
  dirs = new Map<string, FakeDir>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException("no dir", "NotFoundError");
      d = new FakeDir();
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMException("no file", "NotFoundError");
      f = new FakeFileHandle(name);
      this.files.set(name, f);
    }
    return f;
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException("no entry", "NotFoundError");
  }
}

let root: FakeDir;
let shortWriteAfter: number | null = null;
let quota = { usage: 0, quota: 10 * 1024 * 1024 * 1024 };
let store: Record<string, string> = {};

function vaultDirOf(): FakeDir {
  return root.dirs.get("upload-vault") as FakeDir;
}

/** A File whose stream dies partway, like a lapsed content:// grant. */
function dyingFile(name: string, size: number): File {
  return {
    name,
    size,
    type: "video/mp4",
    stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8));
          controller.error(new DOMException("The requested file could not be read", "NotReadableError"));
        },
      });
    },
  } as unknown as File;
}

beforeEach(() => {
  jest.resetModules();
  root = new FakeDir();
  shortWriteAfter = null;
  quota = { usage: 0, quota: 10 * 1024 * 1024 * 1024 };
  store = {};

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
  (globalThis as unknown as { navigator: unknown }).navigator = {
    storage: {
      getDirectory: async () => root,
      estimate: async () => quota,
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const load = () => require("@/features/requests/fileVault") as typeof import("@/features/requests/fileVault");

describe("file vault", () => {
  it("copies a file byte-for-byte and hands it back with its original identity", async () => {
    const { vaultPut, vaultFile } = load();
    const payload = new Uint8Array(200_000).map((_, i) => i % 251);
    const original = new File([payload], "13965.mp4", { type: "video/mp4" });

    const entry = await vaultPut("key-1", original);
    expect(entry).toEqual({ key: "key-1", name: "13965.mp4", type: "video/mp4", size: payload.byteLength });

    const copy = await vaultFile(entry);
    // Name and MIME type must survive: fileSig and the server's asset identity
    // are both built from them, so losing them would break multipart resume.
    expect(copy.name).toBe("13965.mp4");
    expect(copy.type).toBe("video/mp4");
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(payload);
  });

  it("supports ranged reads of the copy — the shape every multipart part uses", async () => {
    const { vaultPut, vaultFile } = load();
    const payload = new Uint8Array(50_000).map((_, i) => i % 97);
    const entry = await vaultPut("key-2", new File([payload], "clip.mp4", { type: "video/mp4" }));

    const copy = await vaultFile(entry);
    const chunk = new Uint8Array(await copy.slice(10_000, 20_000).arrayBuffer());
    expect(chunk).toEqual(payload.slice(10_000, 20_000));
  });

  it("leaves nothing behind when the source dies mid-copy", async () => {
    const { vaultPut, isUnreadableFileError } = load();

    let caught: unknown;
    try {
      await vaultPut("key-3b", dyingFile("13969.mp4", 40_000_000));
    } catch (err) {
      caught = err;
    }
    // The failure must be recognisable as "this file is gone", or the caller
    // would retry it as though it were a network blip.
    expect(isUnreadableFileError(caught)).toBe(true);
    // A half-written copy must not survive: it would later upload as a
    // truncated video that only fails at the server's ffprobe.
    expect(vaultDirOf().files.has("key-3b")).toBe(false);
    expect(store[VAULT_INDEX_KEY]).toBeUndefined();
  });

  it("rejects a short copy rather than uploading a truncated file", async () => {
    const { vaultPut } = load();
    shortWriteAfter = 0; // every write is silently dropped

    await expect(
      vaultPut("key-4", new File([new Uint8Array(300_000)], "big.mp4", { type: "video/mp4" }))
    ).rejects.toThrow(/short copy/);
    expect(vaultDirOf().files.has("key-4")).toBe(false);
  });

  it("refuses to start a copy the origin cannot hold", async () => {
    const { vaultPut } = load();
    quota = { usage: 0, quota: 1_000_000 };

    await expect(
      vaultPut("key-5", new File([new Uint8Array(900_000)], "big.mp4", { type: "video/mp4" }))
    ).rejects.toThrow(/not enough origin storage/);
    // Nothing was created, so nothing needs cleaning up.
    expect(root.dirs.get("upload-vault")).toBeUndefined();
  });

  it("proceeds when the browser reports no usable estimate", async () => {
    const { vaultPut } = load();
    (globalThis as unknown as { navigator: { storage: { estimate: () => Promise<unknown> } } }).navigator.storage.estimate =
      async () => ({});

    await expect(
      vaultPut("key-6", new File([new Uint8Array(1024)], "s.jpg", { type: "image/jpeg" }))
    ).resolves.toMatchObject({ key: "key-6" });
  });

  it("deletes a copy and forgets it", async () => {
    const { vaultPut, vaultDelete } = load();
    await vaultPut("key-7", new File([new Uint8Array(1024)], "a.jpg", { type: "image/jpeg" }));
    expect(vaultDirOf().files.has("key-7")).toBe(true);

    await vaultDelete("key-7");
    expect(vaultDirOf().files.has("key-7")).toBe(false);
    expect(store[VAULT_INDEX_KEY]).toBeUndefined();
    // Deleting again must not throw — removeFile can race a copy that never ran.
    await expect(vaultDelete("key-7")).resolves.toBeUndefined();
  });

  it("sweeps copies abandoned by an earlier visit but never a live one", async () => {
    const { vaultPut, vaultSweep } = load();

    // Simulate a previous session that died mid-upload: entries on disk, named
    // in the index, with no live File object left anywhere.
    const dir = await root.getDirectoryHandle("upload-vault", { create: true });
    await dir.getFileHandle("stale-a", { create: true });
    await dir.getFileHandle("stale-b", { create: true });
    store[VAULT_INDEX_KEY] = JSON.stringify(["stale-a", "stale-b"]);

    // ...and one this page instance is actively using.
    await vaultPut("live-1", new File([new Uint8Array(2048)], "live.mp4", { type: "video/mp4" }));

    await vaultSweep();

    expect(vaultDirOf().files.has("stale-a")).toBe(false);
    expect(vaultDirOf().files.has("stale-b")).toBe(false);
    expect(vaultDirOf().files.has("live-1")).toBe(true);
    expect(JSON.parse(store[VAULT_INDEX_KEY])).toEqual(["live-1"]);
  });

  it("reports remaining space, and null where the browser will not say", async () => {
    const { estimateFreeBytes } = load();
    quota = { usage: 400, quota: 1000 };
    expect(await estimateFreeBytes()).toBe(600);

    (globalThis as unknown as { navigator: { storage: { estimate: () => Promise<unknown> } } }).navigator.storage.estimate =
      async () => ({});
    // null means "unknown", which must not be read as "no space" — the form
    // shows no storage warning and the copy is simply attempted.
    expect(await estimateFreeBytes()).toBeNull();
  });

  it("never reports negative space when usage exceeds quota", async () => {
    const { estimateFreeBytes } = load();
    quota = { usage: 2000, quota: 1000 };
    expect(await estimateFreeBytes()).toBe(0);
  });

  it("accepts a copy it refused earlier, once space has been released", async () => {
    // The just-in-time path a storage-constrained phone depends on: the batch
    // does not fit at selection, but each file is copied before its own upload
    // and released after it. (Quota accounting is driven by hand here — the
    // fake filesystem has none — so what this pins down is that a refusal
    // leaves nothing sticky behind: no index entry, no half-written file.)
    const { vaultPut, vaultDelete } = load();
    const big = () => new File([new Uint8Array(700_000)], "a.mp4", { type: "video/mp4" });
    const next = () => new File([new Uint8Array(250_000)], "b.mp4", { type: "video/mp4" });

    quota = { usage: 0, quota: 1_000_000 };
    await vaultPut("first", big());

    // 150 KB free against a 250 KB file (plus headroom) — comfortably refused.
    quota = { usage: 850_000, quota: 1_000_000 };
    await expect(vaultPut("second", next())).rejects.toThrow(/not enough origin storage/);
    expect(JSON.parse(store[VAULT_INDEX_KEY])).toEqual(["first"]);

    await vaultDelete("first");
    quota = { usage: 0, quota: 1_000_000 };
    await expect(vaultPut("second", next())).resolves.toMatchObject({ key: "second" });
    expect(vaultDirOf().files.has("second")).toBe(true);
  });

  it("reports itself unsupported where OPFS is missing, so callers fall back", async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {};
    const { isFileVaultSupported, vaultPut } = load();
    expect(isFileVaultSupported()).toBe(false);
    await expect(
      vaultPut("key-8", new File([new Uint8Array(16)], "a.jpg", { type: "image/jpeg" }))
    ).rejects.toThrow(/OPFS unavailable/);
  });
});
