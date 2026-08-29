import {
  describeError,
  diagDump,
  diagLog,
  diagReset,
  isUnreadableFileError,
  startHandleMonitor,
} from "@/features/requests/uploadDiagnostics";

// The module reports page visibility alongside every liveness tick; jest's node
// environment has no document.
beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = { visibilityState: "visible" };
});

beforeEach(() => {
  diagReset();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Verbatim from Chromium, as seen in the field report. */
const CHROMIUM_MESSAGE =
  "The requested file could not be read, typically due to permission problems " +
  "that have occurred after a reference to a file was acquired.";

/**
 * This classifier decides whether an upload failure is worth retrying.
 *
 * Wrong in one direction and a dead file handle is retried for ever (the
 * reported bug: eight of nine clips failing every attempt). Wrong in the other
 * and a dropped mobile part stops being retried, which is the one failure the
 * retry machinery exists for. Both directions are asserted.
 */
describe("isUnreadableFileError", () => {
  it("matches a real DOMException from a lapsed Android content:// grant", () => {
    expect(isUnreadableFileError(new DOMException(CHROMIUM_MESSAGE, "NotReadableError"))).toBe(true);
  });

  it("matches NotFoundError — the file was moved or deleted after being picked", () => {
    expect(
      isUnreadableFileError(new DOMException("A requested file could not be found", "NotFoundError"))
    ).toBe(true);
  });

  it("matches on the message alone, for an error re-wrapped on its way up", () => {
    expect(isUnreadableFileError(new Error(CHROMIUM_MESSAGE))).toBe(true);
  });

  it("matches a duck-typed error carrying only a name", () => {
    expect(isUnreadableFileError({ name: "NotReadableError" })).toBe(true);
  });

  it("does NOT match transient network failures, which must stay retryable", () => {
    for (const message of [
      "Failed to fetch",
      "upload timeout",
      "network error",
      "Load failed",
      "net::ERR_CONNECTION_RESET",
      "upload HTTP 403",
      "upload HTTP 500",
    ]) {
      expect(isUnreadableFileError(new Error(message))).toBe(false);
    }
  });

  it("does NOT match a server business rejection", () => {
    expect(isUnreadableFileError(new Error("ขนาดไฟล์รวมเกิน 500 MB ต่อคำขอ"))).toBe(false);
  });

  it("tolerates null, undefined and non-error values", () => {
    expect(isUnreadableFileError(null)).toBe(false);
    expect(isUnreadableFileError(undefined)).toBe(false);
    expect(isUnreadableFileError("")).toBe(false);
    expect(isUnreadableFileError(42)).toBe(false);
  });
});

describe("describeError", () => {
  it("keeps the error NAME, which is what separates the two causes", () => {
    // NotReadableError (grant lapsed / file re-stated) and NotFoundError (file
    // moved or deleted) are indistinguishable to a user and point at completely
    // different fixes, so the name has to survive into the log.
    expect(describeError(new DOMException("x", "NotReadableError"))).toMatch(/^NotReadableError: /);
    expect(describeError(new DOMException("x", "NotFoundError"))).toMatch(/^NotFoundError: /);
  });

  it("degrades safely for values that are not errors", () => {
    expect(describeError(null)).toBe("<none>");
    expect(describeError("boom")).toContain("boom");
  });
});

describe("diagnostic timeline", () => {
  it("timestamps entries and keeps them in order", () => {
    diagLog("SELECT", "a.mp4");
    diagLog("UPLOAD-START", "a.mp4");
    const lines = diagDump().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^t=\d+\.\d+s SELECT a\.mp4$/);
    expect(lines[1]).toContain("UPLOAD-START");
  });

  it("starts empty after a reset, so each selection is its own timeline", () => {
    diagLog("SELECT", "a.mp4");
    diagReset();
    expect(diagDump()).toBe("");
  });
});

/** A File whose reads start failing after `reads` successful ones. */
function fileThatDiesAfter(reads: number, name: string): File {
  let seen = 0;
  return {
    name,
    size: 4096,
    type: "video/mp4",
    slice() {
      seen += 1;
      const failed = seen > reads;
      return {
        arrayBuffer: () =>
          failed
            ? Promise.reject(new DOMException(CHROMIUM_MESSAGE, "NotReadableError"))
            : Promise.resolve(new ArrayBuffer(16)),
      };
    },
  } as unknown as File;
}

describe("startHandleMonitor", () => {
  it("records when a handle dies, how many died together, and how many survive", async () => {
    // "How many at once" is the discriminator the whole investigation rests on:
    // several dying together means a process-wide reclaim, one at a time means
    // the model is wrong.
    const files = [
      { id: "1", file: fileThatDiesAfter(99, "alive.mp4") },
      { id: "2", file: fileThatDiesAfter(1, "dies.mp4") },
    ];
    const stop = startHandleMonitor(() => files, 20);
    await new Promise((r) => setTimeout(r, 150));
    stop();

    const dump = diagDump();
    expect(dump).toContain("HANDLES-OK 2/2 readable");
    expect(dump).toContain("HANDLES-DIED 1 died");
    expect(dump).toContain("dies.mp4");
    expect(dump).toContain("NotReadableError");
    // The survivor keeps being reported, and the dead file is not re-reported.
    expect(dump).toContain("1/2 still readable");
    expect(dump.match(/HANDLES-DIED/g)).toHaveLength(1);
  });

  it("stops polling once stopped", async () => {
    const files = [{ id: "1", file: fileThatDiesAfter(99, "alive.mp4") }];
    const stop = startHandleMonitor(() => files, 20);
    await new Promise((r) => setTimeout(r, 60));
    stop();
    const afterStop = diagDump().split("\n").length;
    await new Promise((r) => setTimeout(r, 80));
    expect(diagDump().split("\n")).toHaveLength(afterStop);
  });
});
