"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { getMobilePlatform } from "@/lib/mobile/platform";

/**
 * Whether this Android binary can survive a push registration.
 *
 * `PushNotifications.register()` starts with `FirebaseMessaging.getInstance()`,
 * which throws `IllegalStateException` when no default FirebaseApp exists — and
 * Capacitor's `Bridge.callPluginMethod` rethrows that as a `RuntimeException` on
 * its own HandlerThread rather than rejecting the call. An uncaught exception
 * there **kills the process**. So on any build without
 * `android/app/google-services.json` (which `android/app/build.gradle`
 * deliberately allows, so a checkout with no Firebase credentials still
 * compiles), tapping "เปิดการแจ้งเตือน" terminates the app instead of failing.
 *
 * No amount of `try`/`catch` in this file can prevent that: the throw is native,
 * on another thread, and the awaited promise never settles because the process
 * is gone. The call has to not be made — hence a native probe that answers
 * before we commit. See android/…/PushSupportPlugin.java.
 */
interface PushSupportPlugin {
  isAvailable(): Promise<{ available: boolean }>;
}

const PushSupport = registerPlugin<PushSupportPlugin>("PushSupport");

let cached: Promise<boolean> | undefined;

/**
 * Can native push be registered on this device, in this build?
 *
 * **Fails closed when the probe itself is missing.** The shells load their JS
 * from `server.url`, so current JavaScript can run inside an older Android Studio
 * build made before `PushSupportPlugin` existed. Some of those builds also have
 * no `google-services.json`; assuming availability there recreates the fatal
 * Firebase call this guard exists to prevent. Disabling push until the binary is
 * rebuilt is preferable to making the application impossible to reopen.
 *
 * A build that *has* the probe and answers `false` is a real answer, and is
 * honoured: that is the local checkout with no Firebase credentials.
 */
export async function isNativePushAvailable(): Promise<boolean> {
  cached ??= probe();
  return cached;
}

async function probe(): Promise<boolean> {
  // iOS uses APNs through the same Capacitor plugin and has no FirebaseApp to
  // initialise, so there is nothing here to check.
  if (getMobilePlatform() !== "android") return true;

  if (!Capacitor.isPluginAvailable("PushSupport")) {
    console.warn("[push] no PushSupport probe in this Android build; skipping registration");
    return false;
  }

  try {
    const { available } = await PushSupport.isAvailable();
    if (!available) {
      console.warn(
        "[push] Firebase is not initialised in this build — skipping registration. " +
          "Add android/app/google-services.json and rebuild to enable notifications."
      );
    }
    return available;
  } catch (cause) {
    // The probe is cheap and total; a rejection here means something is wrong
    // enough that calling register() is not worth the risk.
    console.warn("[push] PushSupport probe failed; skipping registration", cause);
    return false;
  }
}
