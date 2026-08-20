"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  ANDROID_CHANNEL_DESCRIPTION,
  ANDROID_CHANNEL_ID,
  ANDROID_CHANNEL_NAME,
  PUSH_OPT_IN_STORAGE_KEY,
  PUSH_TOKEN_STORAGE_KEY,
} from "@/config/push";
import { getMobilePlatform, isNativeMobile } from "@/lib/mobile/platform";
import { isNativePushAvailable } from "@/lib/mobile/pushSupport";

/**
 * Native (FCM / APNs) push registration — the native counterpart of
 * WebPushRegistration.
 *
 * The server side of push has existed since migration 015, but nothing on the
 * phone ever asked for a token, so `push_devices` only ever held browser
 * subscriptions and the apps were silent. This component closes that gap: it
 * asks permission, registers with FCM/APNs, posts the token to
 * /api/mobile/push-device, and routes a tapped notification to the request it
 * belongs to.
 *
 * Renders nothing (and touches no plugin) on the web — the browser path is
 * WebPushRegistration.
 *
 * **The in-app pre-prompt is deliberate, not decoration.** iOS grants exactly one
 * `requestPermissions()` per install: once the user declines the system sheet it
 * can never be shown again, only re-enabled by hand in Settings. So we explain
 * what the notifications are for and let the user opt in first, and only then
 * trigger the OS prompt — which is also what Apple's HIG and Play's policy on
 * runtime permissions ask for.
 */
export function NativePushRegistration() {
  const { status, data: session } = useSession();
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ title: string; body: string; path: string } | null>(
    null
  );

  // The token last posted for the signed-in user, so a token-refresh event or a
  // remount does not re-POST the same row on every render.
  const postedRef = useRef<string | null>(null);
  const userId = session?.user?.id ?? null;

  const registerToken = useCallback(
    async (token: string) => {
      if (!token || postedRef.current === token) return;
      const platform = getMobilePlatform();
      if (platform === "web") return; // not a native token — nothing to register
      try {
        const response = await fetch("/api/mobile/push-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, platform }),
        });
        if (!response.ok) throw new Error(`register failed (${response.status})`);
        postedRef.current = token;
        // signOutEverywhere() reads this back to unregister the device, so a
        // signed-out phone stops receiving the previous account's notices.
        window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
      } catch (err) {
        // Offline or a server hiccup: leave postedRef unset so the next
        // 'registration' event (Capacitor re-emits on every app start) retries.
        console.error("[push] token registration failed:", err);
      }
    },
    []
  );

  /** Ask the OS, then hand the token to the server. Safe to call repeatedly. */
  const enable = useCallback(async () => {
    setBusy(true);
    try {
      // Probe before showing the OS sheet too. Apart from preventing the fatal
      // register() call below, this avoids leaving notification permission
      // granted on a binary that cannot obtain a token or deliver anything.
      if (!(await isNativePushAvailable())) {
        setShowPrompt(false);
        return;
      }
      const current = await PushNotifications.checkPermissions();
      const permission =
        current.receive === "granted"
          ? current
          : await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") {
        setShowPrompt(false);
        return;
      }
      window.localStorage.setItem(PUSH_OPT_IN_STORAGE_KEY, "yes");
      // Never call register() without this check. On a build with no
      // google-services.json it throws inside Firebase, and Capacitor rethrows
      // that on its HandlerThread — which kills the process rather than
      // rejecting this promise, so the catch below would never run. The user
      // sees the app restart and, because the session cookie had not been
      // flushed to disk, comes back signed out. See @/lib/mobile/pushSupport.
      // Fires the 'registration' listener with the FCM/APNs token.
      await PushNotifications.register();
      setShowPrompt(false);
    } catch (err) {
      console.error("[push] enable failed:", err);
      setShowPrompt(false);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!isNativeMobile()) return; // web path handles itself

    let cancelled = false;
    const handles: PluginListenerHandle[] = [];
    // A different account signed in on this device — force a re-POST so the
    // token is re-pointed at the new user rather than left on the old one.
    postedRef.current = null;

    const navigateTo = (path: unknown) => {
      const target = typeof path === "string" && path.startsWith("/") ? path : "/dashboard/requests";
      window.location.assign(target);
    };

    (async () => {
      try {
        // Android 8+ drops any notification whose channel does not exist, so the
        // channel must be created before the first message can arrive. The id
        // has to match what the server sends — see @/config/push.
        if (getMobilePlatform() === "android") {
          await PushNotifications.createChannel({
            id: ANDROID_CHANNEL_ID,
            name: ANDROID_CHANNEL_NAME,
            description: ANDROID_CHANNEL_DESCRIPTION,
            importance: 4, // HIGH — heads-up; these are "your turn to act" notices
            visibility: 1, // public on the lock screen (titles carry no private data)
            sound: "default",
            lights: true,
            vibration: true,
          }).catch(() => undefined);
        }

        handles.push(
          await PushNotifications.addListener("registration", (token) => {
            if (cancelled) return;
            void registerToken(token.value);
          })
        );
        handles.push(
          await PushNotifications.addListener("registrationError", (err) => {
            // Almost always a missing google-services.json / APNs capability.
            console.error("[push] registration error:", err);
          })
        );
        handles.push(
          await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            if (cancelled) return;
            navigateTo(action.notification.data?.path);
          })
        );
        handles.push(
          await PushNotifications.addListener("pushNotificationReceived", (notification) => {
            if (cancelled) return;
            // Delivered while the app is open. Android does not show a tray
            // notification in that case and iOS only does with
            // presentationOptions, so surface an in-app banner instead of
            // letting the event vanish.
            const path =
              typeof notification.data?.path === "string"
                ? notification.data.path
                : "/dashboard/requests";
            // Already looking at the request the notice is about — no banner needed.
            if (window.location.pathname === path) return;
            setBanner({
              title: notification.title ?? "RClipper",
              body: notification.body ?? "",
              path,
            });
          })
        );

        // A notification tapped while the app was terminated is delivered before
        // any listener exists; Capacitor replays it through the delivered list.
        // Asked before anything else touches the push plugin: a build that
        // cannot service push must not prompt for a permission it will not use,
        // and must never reach register() (which would take the process down —
        // see @/lib/mobile/pushSupport).
        const pushAvailable = await isNativePushAvailable();
        if (cancelled) return;
        if (!pushAvailable) return;

        const permission = await PushNotifications.checkPermissions();
        if (cancelled) return;

        if (permission.receive === "granted") {
          // Already allowed — register silently, no prompt.
          await PushNotifications.register();
        } else if (permission.receive === "denied") {
          // iOS never re-asks; only Settings can undo this. Stay quiet.
        } else if (window.localStorage.getItem(PUSH_OPT_IN_STORAGE_KEY) === "yes") {
          // Opted in before (reinstall / permission reset) — re-ask directly.
          void enable();
        } else {
          setShowPrompt(true);
        }
      } catch (err) {
        console.error("[push] native setup failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      for (const handle of handles) void handle.remove();
    };
  }, [status, userId, enable, registerToken]);

  if (status !== "authenticated") return null;

  if (banner) {
    return (
      <button
        type="button"
        onClick={() => window.location.assign(banner.path)}
        className="fixed inset-x-3 top-3 z-[60] rounded-xl border border-blue-200 bg-white p-3 text-left shadow-lg"
      >
        <p className="text-sm font-semibold text-slate-900">{banner.title}</p>
        <p className="mt-0.5 text-xs text-slate-600">{banner.body}</p>
      </button>
    );
  }

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-blue-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-semibold text-slate-900">
        แจ้งเตือนเมื่อวิดีโอพร้อมตรวจสอบ
      </p>
      <p className="mt-1 text-xs text-slate-600">
        การสร้างวิดีโอใช้เวลาหลายนาทีต่อขั้นตอน
        เปิดการแจ้งเตือนเพื่อให้เราบอกคุณทันทีที่แต่ละขั้นตอนเสร็จและถึงคิวที่คุณต้องตรวจสอบ
        คุณไม่ต้องเปิดแอปค้างไว้
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
          onClick={() => void enable()}
        >
          {busy ? "กำลังเปิด..." : "เปิดการแจ้งเตือน"}
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-xs text-slate-600"
          onClick={() => setShowPrompt(false)}
        >
          ไว้ภายหลัง
        </button>
      </div>
    </div>
  );
}
