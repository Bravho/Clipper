"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { isNativeMobile } from "@/lib/mobile/platform";

/**
 * Browser (Web Push / VAPID) notification registration — the web counterpart of
 * NativePushRegistration. On a normal browser it asks permission, subscribes via
 * the PushManager against the service worker (public/sw.js), and posts the
 * subscription to /api/mobile/push-device with platform "web". The server then
 * delivers pipeline-step notices to it exactly like the native channels.
 *
 * Renders nothing on native (handled by NativePushRegistration), when Web Push is
 * unsupported, or when VAPID isn't configured.
 */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const OPT_IN_KEY = "rclipper-webpush-opt-in";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function webPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  await fetch("/api/mobile/push-device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: json.endpoint,
      platform: "web",
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
}

export function WebPushRegistration() {
  const { status } = useSession();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    if (!VAPID_PUBLIC_KEY) return;
    setBusy(true);
    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setShow(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: TS 5.7 types Uint8Array as generic over ArrayBufferLike, which
          // doesn't structurally match BufferSource without a widening cast.
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }));
      await postSubscription(sub);
      window.localStorage.setItem(OPT_IN_KEY, "yes");
      setShow(false);
    } catch (err) {
      console.error("[webpush] subscribe failed:", err);
      setShow(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    if (isNativeMobile()) return; // native path handles push
    if (!webPushSupported() || !VAPID_PUBLIC_KEY) return;
    if (Notification.permission === "denied") return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (existing) {
          // Already subscribed — keep the server in sync, don't prompt again.
          await postSubscription(existing);
          return;
        }
      } catch {
        /* ignore — fall through to prompt */
      }
      if (cancelled) return;
      // Opted in before (e.g. subscription was cleared): re-subscribe silently.
      // Otherwise show the opt-in prompt (which supplies the required gesture).
      if (window.localStorage.getItem(OPT_IN_KEY) === "yes") {
        void subscribe();
      } else {
        setShow(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated" || !show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-blue-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-semibold text-slate-900">
        แจ้งเตือนเมื่อวิดีโอพร้อมตรวจสอบ
      </p>
      <p className="mt-1 text-xs text-slate-600">
        รับการแจ้งเตือนบนเบราว์เซอร์นี้เมื่อแต่ละขั้นตอนการสร้างเสร็จและต้องการให้คุณตรวจสอบ
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
          onClick={subscribe}
        >
          {busy ? "กำลังเปิด..." : "เปิดการแจ้งเตือน"}
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-xs text-slate-600"
          onClick={() => setShow(false)}
        >
          ไว้ภายหลัง
        </button>
      </div>
    </div>
  );
}
