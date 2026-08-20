const isPluginAvailable = jest.fn();
const isAvailable = jest.fn();

jest.mock("@capacitor/core", () => ({
  Capacitor: { isPluginAvailable },
  registerPlugin: () => ({ isAvailable }),
}));

jest.mock("@/lib/mobile/platform", () => ({
  getMobilePlatform: () => "android",
}));

describe("isNativePushAvailable", () => {
  beforeEach(() => {
    jest.resetModules();
    isPluginAvailable.mockReset();
    isAvailable.mockReset();
  });

  it("fails closed for an older Android binary without the safety probe", async () => {
    isPluginAvailable.mockReturnValue(false);

    const { isNativePushAvailable } = await import("@/lib/mobile/pushSupport");

    await expect(isNativePushAvailable()).resolves.toBe(false);
    expect(isAvailable).not.toHaveBeenCalled();
  });

  it("uses the native Firebase readiness result when the probe is packaged", async () => {
    isPluginAvailable.mockReturnValue(true);
    isAvailable.mockResolvedValue({ available: true });

    const { isNativePushAvailable } = await import("@/lib/mobile/pushSupport");

    await expect(isNativePushAvailable()).resolves.toBe(true);
    expect(isAvailable).toHaveBeenCalledTimes(1);
  });
});
