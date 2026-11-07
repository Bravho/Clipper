import { createProductionDeviceFiles, type DevicePorts } from "@/lib/lab/labDeviceFilesPorts";
import type { RemovalPresence } from "@/lib/lab/labStrictRemoval";

/** Fake device: a file set and an index map, with switches to make each step fail. */
function device(opts: {
  files?: string[];
  index?: string[];
  presenceOverride?: RemovalPresence;
  failRemove?: boolean;
  silentRemove?: boolean;
  failIndex?: boolean;
} = {}) {
  const files = new Set(opts.files ?? []);
  const index = new Set(opts.index ?? []);
  const log: string[] = [];
  const ports: DevicePorts = {
    material: {
      presence: async (id) => {
        log.push(`presence:${id}`);
        if (opts.presenceOverride) return opts.presenceOverride;
        return files.has(id) ? "present" : "absent";
      },
      removeFile: async (id) => {
        log.push(`removeFile:${id}`);
        if (opts.failRemove) throw Object.assign(new Error("permission denied"), { name: "NotAllowedError" });
        if (!opts.silentRemove) files.delete(id);
      },
      removeIndexEntry: async (id) => {
        log.push(`removeIndex:${id}`);
        if (opts.failIndex) throw new Error("index write failed");
        index.delete(id);
      },
    },
    output: {
      presence: async (id) => (files.has(id) ? "present" : "absent"),
      removeFile: async (id) => {
        log.push(`removeOutput:${id}`);
        files.delete(id);
      },
    },
  };
  return { ports, files, index, log };
}

describe("material removal: the index is kept until the file is confirmed gone", () => {
  it("a removal failure propagates, and BOTH the file and its index entry are kept", async () => {
    const d = device({ files: ["m1"], index: ["m1"], failRemove: true });
    await expect(createProductionDeviceFiles(d.ports).deleteMaterial("m1")).rejects.toThrow("permission denied");
    expect(d.files.has("m1")).toBe(true);
    expect(d.index.has("m1")).toBe(true);
    expect(d.log).not.toContain("removeIndex:m1");
  });

  it("a silent removal (file still present afterwards) is refused, and the index is kept", async () => {
    const d = device({ files: ["m1"], index: ["m1"], silentRemove: true });
    await expect(createProductionDeviceFiles(d.ports).deleteMaterial("m1")).rejects.toThrow(/removal not confirmed/);
    expect(d.files.has("m1")).toBe(true);
    expect(d.index.has("m1")).toBe(true);
    expect(d.log).not.toContain("removeIndex:m1");
  });

  it("unknown presence throws before anything is removed; the file and index are kept", async () => {
    const d = device({ files: ["m1"], index: ["m1"], presenceOverride: "unknown" });
    await expect(createProductionDeviceFiles(d.ports).deleteMaterial("m1")).rejects.toThrow(/presence unknown/);
    expect(d.log).toEqual(["presence:m1"]);
    expect(d.index.has("m1")).toBe(true);
  });

  it("genuine absence is handled: the stale index entry is removed and the result is nothing-removed (false)", async () => {
    const d = device({ files: [], index: ["m1"] });
    expect(await createProductionDeviceFiles(d.ports).deleteMaterial("m1")).toBe(false);
    expect(d.index.has("m1")).toBe(false);
    expect(d.log).not.toContain("removeFile:m1");
  });

  it("a successful removal updates the metadata: file gone, index entry gone, true", async () => {
    const d = device({ files: ["m1"], index: ["m1"] });
    expect(await createProductionDeviceFiles(d.ports).deleteMaterial("m1")).toBe(true);
    expect(d.files.has("m1")).toBe(false);
    expect(d.index.has("m1")).toBe(false);
    expect(d.log).toEqual(["presence:m1", "removeFile:m1", "presence:m1", "removeIndex:m1"]);
  });

  it("an index failure AFTER the file is gone propagates; the next run sees the file absent and cleans the entry", async () => {
    const d = device({ files: ["m1"], index: ["m1"], failIndex: true });
    const ops = createProductionDeviceFiles(d.ports);
    await expect(ops.deleteMaterial("m1")).rejects.toThrow("index write failed");
    expect(d.files.has("m1")).toBe(false);
    // The retry: the file is absent, so the stale entry is removed.
    d.ports.material.removeIndexEntry = async (id) => void d.index.delete(id);
    expect(await ops.deleteMaterial("m1")).toBe(false);
    expect(d.index.has("m1")).toBe(false);
  });
});

describe("finished-video copies", () => {
  it("removes one copy and reports true; another copy is untouched", async () => {
    const d = device({ files: ["o1", "o2"] });
    expect(await createProductionDeviceFiles(d.ports).deleteOutput("o1")).toBe(true);
    expect([...d.files]).toEqual(["o2"]);
  });

  it("a missing copy is a harmless no-op (false)", async () => {
    const d = device({ files: ["o2"] });
    expect(await createProductionDeviceFiles(d.ports).deleteOutput("o1")).toBe(false);
    expect([...d.files]).toEqual(["o2"]);
  });

  it("a failed copy removal propagates and the copy stays", async () => {
    const d = device({ files: ["o1"] });
    d.ports.output.removeFile = async () => {
      throw new Error("plugin error");
    };
    await expect(createProductionDeviceFiles(d.ports).deleteOutput("o1")).rejects.toThrow("plugin error");
    expect(d.files.has("o1")).toBe(true);
  });
});
