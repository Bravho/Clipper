"use client";

import { signOut } from "next-auth/react";
import { ROUTES } from "@/config/routes";
import { clearNativeSignIn } from "@/lib/mobile/nativeSocialAuth";

const PUSH_TOKEN_STORAGE_KEY = "rclipper-push-token";

/**
 * The one sign-out path for every surface.
 *
 * `signOut()` alone only clears the NextAuth cookie, which is not a full sign-out
 * in the native apps:
 *
 *  1. **Native credential state persists.** Android Credential Manager keeps the
 *     Google account, so the next "Sign in with Google" silently reuses it — the
 *     user cannot switch accounts and never really signed out.
 *  2. **The push token stays registered**, so the device keeps receiving
 *     notifications for an account nobody is signed into.
 *
 * Both are cleared first, best-effort: a failure in either must not leave the
 * user stuck in a signed-in session.
 */
export async function signOutEverywhere(
  callbackUrl: string = ROUTES.HOME
): Promise<void> {
  await Promise.all([unregisterPushDevice(), clearNativeSignIn()]);
  await signOut({ callbackUrl });
}

async function unregisterPushDevice(): Promise<void> {
  if (typeof window === "undefined") return;

  const token = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) return;

  try {
    await fetch("/api/mobile/push-device", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    // Offline or server error — still drop the local copy so the next sign-in
    // registers cleanly. The server-side row is reconciled on re-registration.
  } finally {
    window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  }
}
