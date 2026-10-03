import { appCanUseStudio, isAppUserAgent, parseAppUserAgent } from "@/lib/mobile/appUserAgent";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("appUserAgent", () => {
  it("treats a browser as not the app", () => {
    expect(parseAppUserAgent(SAFARI)).toEqual({ platform: null, renderPluginVersion: 0 });
    expect(isAppUserAgent(SAFARI)).toBe(false);
    expect(appCanUseStudio(SAFARI)).toBe(false);
    expect(isAppUserAgent(null)).toBe(false);
  });

  it("recognises an older store build that announces no render plugin", () => {
    const ua = `${SAFARI} RClipperNative/android`;
    expect(parseAppUserAgent(ua)).toEqual({ platform: "android", renderPluginVersion: 0 });
    expect(isAppUserAgent(ua)).toBe(true);
    expect(appCanUseStudio(ua)).toBe(false);
  });

  it("lets a build with render plugin v6 use the studio", () => {
    const ua = `${SAFARI} RClipperNative/ios RClipperRender/6`;
    expect(parseAppUserAgent(ua)).toEqual({ platform: "ios", renderPluginVersion: 6 });
    expect(appCanUseStudio(ua)).toBe(true);
  });

  it("refuses a build whose render plugin is older than the studio needs", () => {
    expect(appCanUseStudio(`${SAFARI} RClipperNative/ios RClipperRender/5`)).toBe(false);
  });
});
