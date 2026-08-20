"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import {
  markAppleReturnConsumed,
  takeLaunchAppleReturn,
} from "@/lib/mobile/appleAndroidReturn";
import { getMobilePlatform } from "@/lib/mobile/platform";

/**
 * Finish a Sign in with Apple that outlived the process that started it.
 *
 * On Android the Apple leg happens in a Chrome Custom Tab, with this app in the
 * background. If Android reclaims the process while Apple is on screen — routine
 * for a remote-URL WebView shell — the deep link carrying the identity token
 * *cold-starts* the app instead of resuming it, and everything that was waiting
 * for that token (the plugin's pending call, the promise behind the sign-in
 * button, this whole React tree) no longer exists. The user sees the app appear
 * to restart itself, still signed out, with nothing to explain why.
 *
 * Capacitor keeps the launch intent's URI, so the token is still reachable at
 * boot via `App.getLaunchUrl()`. This component reads it once and completes the
 * exchange that the button never got to make. See src/lib/mobile/appleAndroidReturn.ts.
 *
 * Renders nothing except while it is actually working, so it costs a signed-in
 * user nothing on an ordinary launch.
 */
export function AppleReturnRecovery() {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  // React 18 runs effects twice in development; the token must only be spent
  // once, and `takeLaunchAppleReturn` is itself one-shot per process.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // The launch URL only ever carries an apple-login result on Android; iOS
    // signs in through ASAuthorizationController without leaving the app.
    if (getMobilePlatform() !== "android") return;

    let active = true;

    void (async () => {
      const parked = await takeLaunchAppleReturn();
      if (!parked || !active) return;

      if (!parked.ok) {
        // The callback route already reported the failure to the tab; there is
        // no pending UI left to attach it to, so a console line is the honest
        // place for it rather than an alert on an unrelated screen.
        console.error("[auth] parked Apple return was a failure", parked.reason);
        return;
      }

      console.info("[auth] completing an Apple sign-in parked by an app restart");
      setState("working");
      // Claim it before the request, not after: a failure here must not leave a
      // spent token to be retried on the next reload.
      markAppleReturnConsumed(parked.idToken);

      try {
        const result = await signIn("apple-native", {
          idToken: parked.idToken,
          redirect: false,
        });

        if (!active) return;

        if (!result || result.error) {
          console.error("[auth] parked Apple sign-in was rejected", result?.error);
          setState("failed");
          return;
        }

        // Apple identity tokens are short-lived, so by the time a user gets back
        // to a cold-started app this may well be the second thing they see. Land
        // them where the button would have.
        window.location.assign("/dashboard");
      } catch (cause) {
        console.error("[auth] parked Apple sign-in failed", cause);
        if (active) setState("failed");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (state === "idle") return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-xs"
      role="status"
      aria-live="polite"
    >
      {state === "working" ? (
        <span className="inline-block rounded-md bg-slate-900/90 px-3 py-2 text-slate-100">
          กำลังเข้าสู่ระบบด้วย Apple…
        </span>
      ) : (
        <span className="inline-block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          เข้าสู่ระบบด้วย Apple ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </span>
      )}
    </div>
  );
}
