/**
 * Picking lost originals again: which picked file is which original.
 */
import { matchOriginals } from "@/features/device-render/studioPipeline";
import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";

const original = (localId: string, fileName: string, size: number): LocalMediaDescriptor => ({
  localId,
  fileName,
  mimeType: "video/mp4",
  fileSizeBytes: size,
  durationSeconds: 5,
});
const picked = (name: string, size: number) => new File([new Uint8Array(size)], name);

describe("matchOriginals", () => {
  it("prefers name and size, then name, then size, each file once", () => {
    const missing = [
      original("a", "15283.mp4", 10),
      original("b", "15281.mp4", 20),
      original("c", "15284.mp4", 30),
    ];
    const files = [
      picked("renamed.mp4", 30), // size only → c
      picked("15281.mp4", 21), // name only → b
      picked("15283.mp4", 10), // exact → a
      picked("other.jpg", 5), // nothing
    ];
    const { pairs, unused } = matchOriginals(missing, files);
    const byId = Object.fromEntries(pairs.map((pair) => [pair.descriptor.localId, pair.file.name]));
    expect(byId).toEqual({ a: "15283.mp4", b: "15281.mp4", c: "renamed.mp4" });
    expect(unused.map((file) => file.name)).toEqual(["other.jpg"]);
  });

  it("never gives one file to two originals", () => {
    const missing = [original("a", "x.mp4", 10), original("b", "x.mp4", 10)];
    const { pairs } = matchOriginals(missing, [picked("x.mp4", 10)]);
    expect(pairs).toHaveLength(1);
  });
});
