"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  PushNotifications,
  Token,
  ActionPerformed,
} from "@capacitor/push-notifications";
import { getMobilePlatform, isNativeMobile } from "@/lib/mobile/platform";

export function NativePushRegistration() {
  const { status } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const isNative = isNativeMobile();
    setNative(isNative);
    if (isNative && window.localStorage.getItem("rclipper-push-opt-in") === "yes") {
      setEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !enabled || !isNativeMobile()) return;
    const platform = getMobilePlatform();
    if (platform === "web") return;
    let active = true;
    const listeners: Array<{ remove: () => Promise<void> }> = [];

    const register = async () => {
      const registration = await PushNotifications.addListener(
        "registration",
        (token: Token) => {
          if (!active) return;
          window.localStorage.setItem("rclipper-push-token", token.value);
          void fetch("/api/mobile/push-device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token.value, platform }),
          });
        }
      );
      listeners.push(registration);

      const action = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (event: ActionPerformed) => {
          const path = event.notification.data?.path;
          if (typeof path === "string" && path.startsWith("/dashboard/requests/")) {
            window.location.assign(path);
          }
        }
      );
      listeners.push(action);

      const current = await PushNotifications.checkPermissions();
      const permission =
        current.receive === "prompt"
          ? await PushNotifications.requestPermissions()
          : current;
      if (permission.receive === "granted") {
        await PushNotifications.register();
      }
    };

    void register().catch((err) => {
      console.error("[push] registration failed:", err);
    });

    return () => {
      active = false;
      for (const listener of listeners) void listener.remove();
    };
  }, [status, enabled]);

  if (!native || status !== "authenticated" || enabled) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-blue-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-semibold text-slate-900">
        แจ้งเตือนเมื่อวิดีโอพร้อมตรวจสอบ
      </p>
      <p className="mt-1 text-xs text-slate-600">
        RClipper จะส่งการแจ้งเตือนเฉพาะเมื่อขั้นตอนการสร้างเสร็จและต้องการให้คุณตรวจสอบ
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white"
          onClick={() => {
            window.localStorage.setItem("rclipper-push-opt-in", "yes");
            setEnabled(true);
          }}
        >
          เปิดการแจ้งเตือน
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-xs text-slate-600"
          onClick={() => setNative(false)}
        >
          ไว้ภายหลัง
        </button>
      </div>
    </div>
  );
}
