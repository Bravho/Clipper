/**
 * Binding-level tests of the production deleter wiring. The REAL storage modules
 * are replaced by mocks (no device, no OPFS, no plugin). These tests check which
 * storage calls the binding makes, in what order, and what it reports.
 */
const mockState = {
  supported: true,
  materialProbe: null as null | (() => Promise<void>),
  materialRemoveFile: null as null | (() => Promise<void>),
  materialRemoveIndex: null as null | (() => Promise<void>),
  outputStat: null as null | (() => Promise<void>),
  outputRemove: null as null | (() => Promise<void>),
  native: true,
  calls: [] as string[],
};

jest.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockState.native },
}));

jest.mock("@/features/requests/localMediaStore", () => ({
  localMaterialsSupported: () => mockState.supported,
  probeLocalMaterial: async (id: string) => {
    mockState.calls.push(`probe:${id}`);
    return mockState.materialProbe!();
  },
  removeLocalMaterialFile: async (id: string) => {
    mockState.calls.push(`removeFile:${id}`);
    return mockState.materialRemoveFile!();
  },
  removeLocalMaterialIndexEntry: async (id: string) => {
    mockState.calls.push(`removeIndex:${id}`);
    return mockState.materialRemoveIndex!();
  },
}));

jest.mock("@/lib/mobile/finishedVideoCache", () => ({
  probeFinishedVideo: async (id: string) => {
    mockState.calls.push(`stat:${id}`);
    return mockState.outputStat!();
  },
  removeFinishedVideo: async (id: string) => {
    mockState.calls.push(`removeOutput:${id}`);
    return mockState.outputRemove!();
  },
}));

import { labProductionDeviceFiles } from "@/lib/lab/labDevicePortsWiring";

const notFoundDom = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
const pluginError = (code: string) => Object.assign(new Error("plugin said no"), { code });
const ok = async () => undefined;

/** Resets the mock device to "file present, removal works" unless a test overrides it. */
function reset(over: Partial<typeof mockState> = {}) {
  Object.assign(mockState, {
    supported: true,
    native: true,
    materialProbe: ok,
    materialRemoveFile: ok,
    materialRemoveIndex: ok,
    outputStat: ok,
    outputRemove: ok,
    calls: [],
  }, over);
}

describe("material deletion (real-storage binding, mocked)", () => {
  beforeEach(() => reset());

  it("unsupported storage: unknown, nothing is removed, the index is kept", async () => {
    reset({ supported: false });
    await expect(labProductionDeviceFiles.deleteMaterial("m1")).rejects.toThrow(/presence unknown/);
    expect(mockState.calls).toEqual([]);
  });

  it("a genuine missing file (OPFS NotFoundError): false, the stale index entry is cleaned, no file removal", async () => {
    reset({ materialProbe: async () => { throw notFoundDom(); } });
    expect(await labProductionDeviceFiles.deleteMaterial("m1")).toBe(false);
    expect(mockState.calls).toEqual(["probe:m1", "removeIndex:m1"]);
  });

  it("a permission or other storage error on the probe: unknown, nothing removed, index kept", async () => {
    reset({ materialProbe: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } });
    await expect(labProductionDeviceFiles.deleteMaterial("m1")).rejects.toThrow(/presence unknown/);
    expect(mockState.calls).toEqual(["probe:m1"]);
  });

  it("successful removal: file removed, confirmed absent, THEN the index entry removed, true", async () => {
    let present = true;
    reset({
      materialProbe: async () => {
        if (!present) throw notFoundDom();
      },
      materialRemoveFile: async () => {
        present = false;
      },
    });
    expect(await labProductionDeviceFiles.deleteMaterial("m1")).toBe(true);
    expect(mockState.calls).toEqual(["probe:m1", "removeFile:m1", "probe:m1", "removeIndex:m1"]);
  });

  it("a removal that throws: the error propagates and the index entry is kept", async () => {
    reset({ materialRemoveFile: async () => { throw new Error("permission denied"); } });
    await expect(labProductionDeviceFiles.deleteMaterial("m1")).rejects.toThrow("permission denied");
    expect(mockState.calls).not.toContain("removeIndex:m1");
  });

  it("a silent removal (file still there afterwards): refused, the index entry is kept", async () => {
    reset({ materialRemoveFile: ok }); // resolves, but the probe still finds the file
    await expect(labProductionDeviceFiles.deleteMaterial("m1")).rejects.toThrow(/removal not confirmed/);
    expect(mockState.calls).toEqual(["probe:m1", "removeFile:m1", "probe:m1"]);
  });

  it("the index update fails after the file is gone: the error propagates", async () => {
    let present = true;
    reset({
      materialProbe: async () => {
        if (!present) throw notFoundDom();
      },
      materialRemoveFile: async () => {
        present = false;
      },
      materialRemoveIndex: async () => {
        throw new Error("index write failed");
      },
    });
    await expect(labProductionDeviceFiles.deleteMaterial("m1")).rejects.toThrow("index write failed");
  });
});

describe("finished-video deletion (real-storage binding, mocked)", () => {
  beforeEach(() => reset());

  it("a plugin that is not available (UNIMPLEMENTED): unknown, nothing removed", async () => {
    reset({ outputStat: async () => { throw pluginError("UNIMPLEMENTED"); } });
    await expect(labProductionDeviceFiles.deleteOutput("o1")).rejects.toThrow(/presence unknown/);
    expect(mockState.calls).toEqual(["stat:o1"]);
  });

  it("a permission error (OS-PLUG-FILE-0007): unknown, nothing removed", async () => {
    reset({ outputStat: async () => { throw pluginError("OS-PLUG-FILE-0007"); } });
    await expect(labProductionDeviceFiles.deleteOutput("o1")).rejects.toThrow(/presence unknown/);
    expect(mockState.calls).toEqual(["stat:o1"]);
  });

  it("a genuine missing copy (OS-PLUG-FILE-0008): false, no removal call", async () => {
    reset({ outputStat: async () => { throw pluginError("OS-PLUG-FILE-0008"); } });
    expect(await labProductionDeviceFiles.deleteOutput("o1")).toBe(false);
    expect(mockState.calls).toEqual(["stat:o1"]);
  });

  it("the web fallback (no structured code) is unknown, not absent", async () => {
    reset({ native: false, outputStat: async () => { throw new Error("File does not exist."); } });
    await expect(labProductionDeviceFiles.deleteOutput("o1")).rejects.toThrow(/presence unknown/);
  });

  it("successful removal: present, removed, confirmed absent afterwards, true", async () => {
    let present = true;
    reset({
      outputStat: async () => {
        if (!present) throw pluginError("OS-PLUG-FILE-0008");
      },
      outputRemove: async () => {
        present = false;
      },
    });
    expect(await labProductionDeviceFiles.deleteOutput("o1")).toBe(true);
    expect(mockState.calls).toEqual(["stat:o1", "removeOutput:o1", "stat:o1"]);
  });

  it("a failed copy removal propagates", async () => {
    reset({ outputRemove: async () => { throw new Error("plugin error"); } });
    await expect(labProductionDeviceFiles.deleteOutput("o1")).rejects.toThrow("plugin error");
  });
});
