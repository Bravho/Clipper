import { LOCAL_FIRST_MEDIA_ENABLED } from "@/config/localMedia";
import { snapshotsSupported } from "@/features/requests/fileSnapshot";
import { getNativeRenderCapabilities } from "@/lib/mobile/deviceVideoRender";
import { getMobilePlatform } from "@/lib/mobile/platform";

export interface LocalMediaIntakeCheck {
  nativePlatform: boolean;
  nativePluginVersion: number | null;
  privateStorageAvailable: boolean;
  hasLegacyUploadedAssets: boolean;
  hasLegacyMultipartSession: boolean;
}

/** Remote web code is shared by current and older installed apps. */
export function canUseLocalMediaIntake(check: LocalMediaIntakeCheck): boolean {
  return (
    LOCAL_FIRST_MEDIA_ENABLED &&
    check.nativePlatform &&
    (check.nativePluginVersion ?? 0) >= 2 &&
    check.privateStorageAvailable &&
    !check.hasLegacyUploadedAssets &&
    !check.hasLegacyMultipartSession
  );
}

export async function canUseLocalMediaOnThisDevice(
  hasLegacyUploadedAssets: boolean,
  hasLegacyMultipartSession: boolean
): Promise<boolean> {
  if (!LOCAL_FIRST_MEDIA_ENABLED || getMobilePlatform() === "web") return false;
  const capabilities = await getNativeRenderCapabilities();
  return canUseLocalMediaIntake({
    nativePlatform: true,
    nativePluginVersion: capabilities?.nativePluginVersion ?? null,
    privateStorageAvailable: snapshotsSupported(),
    hasLegacyUploadedAssets,
    hasLegacyMultipartSession,
  });
}
