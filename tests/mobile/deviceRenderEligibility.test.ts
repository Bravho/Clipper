import { assessDeviceRenderEligibility } from "@/lib/mobile/deviceRenderEligibility";

const device = {
  platform: "ios" as const,
  nativePluginVersion: 1,
  freeBytes: 4_000_000_000,
  supportsH264Encode: true,
  supportsAacEncode: true,
  appInForeground: true,
  lowPowerMode: false,
};
const workload = {
  totalInputBytes: 300_000_000,
  estimatedOutputBytes: 100_000_000,
  durationSeconds: 15,
  width: 1080,
  height: 1920,
  fps: 30,
};

describe("device render admission", () => {
  it("accepts a supported foreground device with enough scratch space", () => {
    expect(assessDeviceRenderEligibility(device, workload).eligible).toBe(true);
  });

  it("rejects a device that cannot keep inputs and output safely", () => {
    expect(assessDeviceRenderEligibility({ ...device, freeBytes: 900_000_000 }, workload))
      .toMatchObject({ eligible: false, reason: "insufficient_storage" });
  });

  it("rejects an older native binary even when the web page is current", () => {
    expect(assessDeviceRenderEligibility({ ...device, nativePluginVersion: 0 }, workload))
      .toMatchObject({ eligible: false, reason: "unsupported_app_build" });
  });
});
