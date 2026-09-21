import { canUseLocalMediaIntake } from "@/lib/mobile/localMediaPolicy";

const capable = {
  nativePlatform: true,
  nativePluginVersion: 2,
  privateStorageAvailable: true,
  hasLegacyUploadedAssets: false,
  hasLegacyMultipartSession: false,
};

describe("local media intake compatibility", () => {
  it("uses local originals on a capable new mobile build", () => {
    expect(canUseLocalMediaIntake(capable)).toBe(true);
  });

  it("keeps an older mobile build on the server upload flow", () => {
    expect(canUseLocalMediaIntake({ ...capable, nativePluginVersion: null })).toBe(false);
    expect(canUseLocalMediaIntake({ ...capable, nativePluginVersion: 1 })).toBe(false);
  });

  it("continues existing legacy drafts through upload", () => {
    expect(canUseLocalMediaIntake({ ...capable, hasLegacyUploadedAssets: true })).toBe(false);
    expect(canUseLocalMediaIntake({ ...capable, hasLegacyMultipartSession: true })).toBe(false);
  });

  it("uses upload when app-private storage is unavailable", () => {
    expect(canUseLocalMediaIntake({ ...capable, privateStorageAvailable: false })).toBe(false);
    expect(canUseLocalMediaIntake({ ...capable, nativePlatform: false })).toBe(false);
  });
});
