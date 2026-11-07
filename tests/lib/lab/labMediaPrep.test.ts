import { prepareLabSource, LabMediaPrepError, type PrepareLabSourceDeps } from "@/lib/lab/labMediaPrep";

const file = new File(["x"], "clip.mp4", { type: "video/mp4" });

function deps(over: Partial<PrepareLabSourceDeps> = {}) {
  const revoked: string[] = [];
  const d: PrepareLabSourceDeps = {
    probe: async () => ({ durationSeconds: 12, posterUrl: "data:image/jpeg;base64,xx" }),
    createObjectURL: () => "blob:preview-1",
    revokeObjectURL: (url) => void revoked.push(url),
    timeoutMs: 1000,
    isCancelled: () => false,
    ...over,
  };
  return { d, revoked };
}

describe("prepareLabSource", () => {
  it("returns the studio's duration and poster, and a preview URL that release() revokes once", async () => {
    const { d, revoked } = deps();
    const prepared = await prepareLabSource(file, d);
    expect(prepared).toMatchObject({ previewUrl: "blob:preview-1", durationSeconds: 12, posterUrl: "data:image/jpeg;base64,xx" });
    expect(revoked).toEqual([]);
    prepared.release();
    prepared.release();
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("never revokes or deletes the file itself", async () => {
    const { d, revoked } = deps();
    const prepared = await prepareLabSource(file, d);
    prepared.release();
    expect(revoked).not.toContain(file as unknown as string);
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("a probe that never answers times out, revokes the preview URL, and rejects", async () => {
    const { d, revoked } = deps({ probe: () => new Promise(() => undefined), timeoutMs: 20 });
    await expect(prepareLabSource(file, d)).rejects.toMatchObject({ reason: "timeout" });
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("cancelled before it starts: nothing is created", async () => {
    const created = jest.fn(() => "blob:x");
    const { d } = deps({ isCancelled: () => true, createObjectURL: created });
    await expect(prepareLabSource(file, d)).rejects.toMatchObject({ reason: "cancelled" });
    expect(created).not.toHaveBeenCalled();
  });

  it("cancelled while probing: the result is discarded and the preview URL is revoked", async () => {
    let cancelled = false;
    const { d, revoked } = deps({
      isCancelled: () => cancelled,
      probe: async () => {
        cancelled = true;
        return { durationSeconds: 5, posterUrl: "data:x" };
      },
    });
    await expect(prepareLabSource(file, d)).rejects.toMatchObject({ reason: "cancelled" });
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("a probe failure is reported as probe_failed and revokes the preview URL", async () => {
    const { d, revoked } = deps({ probe: async () => { throw new Error("decode error"); } });
    await expect(prepareLabSource(file, d)).rejects.toMatchObject({ reason: "probe_failed" });
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("no poster frame: refused (the studio needs one for a clip) and revoked", async () => {
    const { d, revoked } = deps({ probe: async () => ({ durationSeconds: 5, posterUrl: null }) });
    await expect(prepareLabSource(file, d)).rejects.toMatchObject({ reason: "no_poster" });
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("no usable duration: refused and revoked", async () => {
    const { d, revoked } = deps({ probe: async () => ({ durationSeconds: 0, posterUrl: "data:x" }) });
    await expect(prepareLabSource(file, d)).rejects.toBeInstanceOf(LabMediaPrepError);
    expect(revoked).toEqual(["blob:preview-1"]);
  });
});
