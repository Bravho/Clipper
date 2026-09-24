/**
 * The extra-shape chain of a phone-rendered request: each chosen shape is
 * rendered montage → master → final from the originals, one task at a time,
 * and the last final finalizes the job.
 */

import {
  firstDeviceRatioLink,
  nextDeviceRatioLink,
  readDeviceRatioLink,
} from "@/lib/mobile/deviceRatioChain";

describe("deviceRatioChain", () => {
  it("starts the first chosen shape at its montage", () => {
    expect(firstDeviceRatioLink(["16:9", "4:5"])).toEqual({
      deviceChain: true,
      ratio: "16:9",
      stage: "montage",
      queue: ["4:5"],
    });
  });

  it("has nothing to start when no valid shape was chosen", () => {
    expect(firstDeviceRatioLink([])).toBeNull();
    expect(firstDeviceRatioLink(["travy", "3:2"])).toBeNull();
  });

  it("walks every chosen shape through montage, master and final, then finalizes", () => {
    const stages: string[] = [];
    let link = firstDeviceRatioLink(["16:9", "4:5"]);
    let asset = 0;
    while (link) {
      stages.push(`${link.ratio}/${link.stage}`);
      const next = nextDeviceRatioLink(link, `asset_${++asset}`);
      if (next === "finalize") {
        stages.push("finalize");
        break;
      }
      link = next;
    }
    expect(stages).toEqual([
      "16:9/montage",
      "16:9/master",
      "16:9/final",
      "4:5/montage",
      "4:5/master",
      "4:5/final",
      "finalize",
    ]);
  });

  it("hands a shape's own montage to its master", () => {
    const montage = firstDeviceRatioLink(["4:5"])!;
    const master = nextDeviceRatioLink(montage, "montage_asset");
    expect(master).toMatchObject({ ratio: "4:5", stage: "master", baseAssetId: "montage_asset" });
    // …and does not carry it on to the final, which composes from the master.
    const final = nextDeviceRatioLink(master as Exclude<typeof master, "finalize">, "master_asset");
    expect(final).not.toHaveProperty("baseAssetId");
  });

  it("round-trips through a task payload", () => {
    const link = nextDeviceRatioLink(firstDeviceRatioLink(["16:9", "4:5"])!, "m1");
    const stored = JSON.parse(JSON.stringify(link));
    expect(readDeviceRatioLink(stored)).toEqual(link);
  });

  it("ignores payloads it did not write", () => {
    expect(readDeviceRatioLink(null)).toBeNull();
    expect(readDeviceRatioLink({ sceneIndex: 2 })).toBeNull();
    expect(readDeviceRatioLink({ ratio: "16:9", stage: "montage", queue: [] })).toBeNull();
    expect(readDeviceRatioLink({ deviceChain: true, ratio: "16:9", stage: "render" })).toBeNull();
  });
});
