import {
  classifyFilesystemError,
  classifyOpfsError,
  presenceOf,
  verifiedDelete,
  FILESYSTEM_NOT_FOUND_CODE,
  type Presence,
} from "@/lib/lab/labDevicePresence";

const plugin = (code: string) => Object.assign(new Error("reason text"), { code });
const dom = (name: string) => Object.assign(new Error("x"), { name });

describe("classifyFilesystemError: only the structured not-found code proves absence", () => {
  it("a genuine missing file (structured code) is absent", () => {
    expect(classifyFilesystemError(plugin(FILESYSTEM_NOT_FOUND_CODE))).toBe("absent");
  });
  it("a plugin that is not available is unknown", () => {
    expect(classifyFilesystemError(plugin("UNIMPLEMENTED"))).toBe("unknown");
  });
  it("a permission error is unknown", () => {
    expect(classifyFilesystemError(plugin("OS-PLUG-FILE-0007"))).toBe("unknown");
  });
  it("a plain error with the 'does not exist' words but no code is unknown (no text matching)", () => {
    expect(classifyFilesystemError(new Error("File does not exist."))).toBe("unknown");
  });
  it("a non-error value is unknown", () => {
    expect(classifyFilesystemError(undefined)).toBe("unknown");
    expect(classifyFilesystemError("boom")).toBe("unknown");
  });
});

describe("classifyOpfsError", () => {
  it("only NotFoundError is absent", () => {
    expect(classifyOpfsError(dom("NotFoundError"))).toBe("absent");
    expect(classifyOpfsError(dom("TypeMismatchError"))).toBe("unknown");
    expect(classifyOpfsError(dom("SecurityError"))).toBe("unknown");
    expect(classifyOpfsError(new Error("disk gone"))).toBe("unknown");
  });
});

describe("presenceOf", () => {
  it("unsupported storage is unknown, and the probe is never run", async () => {
    const probe = jest.fn(async () => undefined);
    expect(await presenceOf(false, probe, classifyOpfsError)).toBe("unknown");
    expect(probe).not.toHaveBeenCalled();
  });
  it("a successful probe is present", async () => {
    expect(await presenceOf(true, async () => undefined, classifyOpfsError)).toBe("present");
  });
  it("a failed probe is classified by the given rule", async () => {
    expect(await presenceOf(true, async () => { throw dom("NotFoundError"); }, classifyOpfsError)).toBe("absent");
    expect(await presenceOf(true, async () => { throw plugin("OS-PLUG-FILE-0007"); }, classifyFilesystemError)).toBe("unknown");
  });
});

describe("verifiedDelete", () => {
  function fakeFile(initial: Presence = "present", opts: { failRemove?: boolean; silentFail?: boolean } = {}) {
    let state: Presence = initial;
    const removes: number[] = [];
    return {
      removes,
      get state() {
        return state;
      },
      presence: async () => state,
      remove: async () => {
        removes.push(1);
        if (opts.failRemove) throw new Error("permission denied");
        if (!opts.silentFail) state = "absent";
      },
    };
  }

  it("a present file is removed and the absence afterwards is verified: true", async () => {
    const f = fakeFile("present");
    expect(await verifiedDelete(f)).toBe(true);
    expect(f.removes).toHaveLength(1);
  });

  it("an absent file is a harmless no-op: false, nothing removed", async () => {
    const f = fakeFile("absent");
    expect(await verifiedDelete(f)).toBe(false);
    expect(f.removes).toHaveLength(0);
  });

  it("unknown presence: throws, and nothing is removed", async () => {
    const f = fakeFile("unknown");
    await expect(verifiedDelete(f)).rejects.toThrow(/presence unknown/);
    expect(f.removes).toHaveLength(0);
  });

  it("a delete that throws is reported", async () => {
    const f = fakeFile("present", { failRemove: true });
    await expect(verifiedDelete(f)).rejects.toThrow("permission denied");
  });

  it("a delete that fails silently (still present afterwards) is reported, not counted as success", async () => {
    const f = fakeFile("present", { silentFail: true });
    await expect(verifiedDelete(f)).rejects.toThrow(/delete not verified/);
  });

  it("a delete after which presence is unknown is not counted as success", async () => {
    let calls = 0;
    const result = verifiedDelete({
      presence: async () => (calls++ === 0 ? "present" : "unknown"),
      remove: async () => undefined,
    });
    await expect(result).rejects.toThrow(/delete not verified/);
  });
});
