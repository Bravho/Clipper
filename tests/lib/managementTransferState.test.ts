import { areAllChannelVideosTransferred } from "@/lib/management/transferState";

describe("areAllChannelVideosTransferred", () => {
  it("returns true when every channel-video asset is in Management", () => {
    expect(
      areAllChannelVideosTransferred(
        [{ assetId: "asset-1" }, { assetId: "asset-2" }],
        { "asset-1": "content-1", "asset-2": "content-2" }
      )
    ).toBe(true);
  });

  it("returns false while any channel-video asset still needs transfer", () => {
    expect(
      areAllChannelVideosTransferred(
        [{ assetId: "asset-1" }, { assetId: "asset-2" }],
        { "asset-1": "content-1" }
      )
    ).toBe(false);
  });

  it("does not report completion when there are no transferable assets", () => {
    expect(
      areAllChannelVideosTransferred([{ assetId: null }], {})
    ).toBe(false);
  });

  it("counts a shared export asset only once", () => {
    expect(
      areAllChannelVideosTransferred(
        [{ assetId: "shared-asset" }, { assetId: "shared-asset" }],
        { "shared-asset": "content-1" }
      )
    ).toBe(true);
  });
});
