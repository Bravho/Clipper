export interface DeviceRenderCapabilities {
  platform: "ios" | "android";
  nativePluginVersion: number;
  freeBytes: number;
  supportsH264Encode: boolean;
  supportsAacEncode: boolean;
  appInForeground: boolean;
  lowPowerMode: boolean;
}

export interface DeviceRenderWorkload {
  totalInputBytes: number;
  estimatedOutputBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export type DeviceRenderEligibility =
  | { eligible: true; requiredFreeBytes: number }
  | { eligible: false; reason: string; requiredFreeBytes: number };

/**
 * Conservative admission check. Native devices can still fail after admission;
 * the render-task lease sends that work back to the server worker.
 */
export function assessDeviceRenderEligibility(
  device: DeviceRenderCapabilities,
  workload: DeviceRenderWorkload
): DeviceRenderEligibility {
  const requiredFreeBytes = Math.max(
    1_000_000_000,
    workload.totalInputBytes * 2 + workload.estimatedOutputBytes * 2
  );
  const reject = (reason: string): DeviceRenderEligibility => ({
    eligible: false,
    reason,
    requiredFreeBytes,
  });

  if (device.nativePluginVersion < 1) return reject("unsupported_app_build");
  if (!device.supportsH264Encode || !device.supportsAacEncode) {
    return reject("unsupported_encoder");
  }
  if (!device.appInForeground) return reject("app_not_foreground");
  if (device.lowPowerMode) return reject("low_power_mode");
  if (!Number.isFinite(workload.durationSeconds) || workload.durationSeconds <= 0 || workload.durationSeconds > 90) {
    return reject("unsupported_duration");
  }
  if (workload.width * workload.height > 1920 * 1080 || workload.fps > 30) {
    return reject("unsupported_output_size");
  }
  if (device.freeBytes < requiredFreeBytes) return reject("insufficient_storage");
  return { eligible: true, requiredFreeBytes };
}
