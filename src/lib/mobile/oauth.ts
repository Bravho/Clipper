"use client";

import { signIn } from "next-auth/react";
import { isNativeMobile } from "@/lib/mobile/platform";
import {
  getNativeIdToken,
  nativeSignInDiagnostics,
  NativeSignInCancelled,
  supportsNativeSignIn,
  type NativeProvider,
} from "@/lib/mobile/nativeSocialAuth";

/**
 * Must match GOOGLE_NATIVE_PROVIDER_ID / APPLE_NATIVE_PROVIDER_ID in
 * src/lib/auth/authOptions.ts. Duplicated rather than imported so this client
 * module does not pull the server auth config into the browser bundle.
 */
const NATIVE_PROVIDER_IDS: Record<NativeProvider, string> = {
  google: "google-native",
  apple: "apple-native",
};

/**
 * Thrown when a third-party provider cannot be handled natively on this device.
 *
 * There used to be a fallback here: open the provider in a Custom Tab /
 * SFSafariViewController and hope for the best. It never actually worked — the
 * browser has its own cookie jar, so the session landed there and the app stayed
 * signed out — and App Store review rejected the iOS build for it under
 * **Guideline 4 (Design)**: "the user is taken to the default web browser to sign
 * in or register for an account".
 *
 * So there is no browser path any more. A provider that cannot sign in *inside*
 * the app does not offer to sign in at all: the button is hidden up front (see
 * `useSignInAvailability`), and this error exists for the race where support
 * disappears between render and tap.
 */
export class NativeSignInUnavailableError extends Error {
  constructor(public readonly provider: NativeProvider) {
    super(`Native sign-in is unavailable for "${provider}" on this device.`);
    this.name = "NativeSignInUnavailableError";
  }
}

/**
 * Start a third-party sign-in.
 *
 * Two paths, because the cookie jar differs per surface:
 *
 *  - **Web** — ordinary NextAuth redirect.
 *  - **Native app** — in-app sign-in (Android Credential Manager, iOS
 *    ASAuthorizationController). A Custom Tab / SFSafariViewController cannot be
 *    used: each has its own cookie jar, so the session cookie would land in the
 *    browser and the app WebView would stay signed out — and Apple rejects it.
 *
 * There is deliberately **no browser fallback**. On a native platform this either
 * signs in without leaving the app or throws.
 */
export async function startOAuth(
  provider: NativeProvider,
  callbackUrl: string
): Promise<void> {
  if (!isNativeMobile()) {
    await signIn(provider, { callbackUrl });
    return;
  }

  // One line in `adb logcat` (filter `chromium:`) that says which branch ran and
  // with which client ID. Without it every failure below is a silent guess,
  // because the shell runs whatever JS was last deployed to `server.url`.
  console.info("[auth] sign-in attempt", await nativeSignInDiagnostics(provider));

  if (!(await supportsNativeSignIn(provider))) {
    throw new NativeSignInUnavailableError(provider);
  }

  await startNativeSignIn(provider, callbackUrl);
}

/**
 * Get an ID token natively, then exchange it for a NextAuth session.
 *
 * `signIn` runs inside the WebView, so the resulting Set-Cookie applies to the
 * WebView — the app is genuinely signed in, with no browser hop.
 */
async function startNativeSignIn(
  provider: NativeProvider,
  callbackUrl: string
): Promise<void> {
  const { idToken, name } = await getNativeIdToken(provider);

  const result = await signIn(NATIVE_PROVIDER_IDS[provider], {
    idToken,
    // Apple only sends a name on first authorization; pass it through so a new
    // account is not created with the email address as its display name.
    ...(name ? { name } : {}),
    callbackUrl,
    redirect: false,
  });

  if (!result || result.error) {
    throw new Error(result?.error ?? "Native sign-in failed.");
  }

  // `redirect: false` means NextAuth set the cookie but did not navigate.
  window.location.assign(sameOriginPath(result.url, callbackUrl));
}

/**
 * Reduce a post-login target to a path, so the WebView stays on its own origin.
 *
 * NextAuth builds `result.url` from `NEXTAUTH_URL`, which need not be the host
 * the shell is actually running on — the web app is canonical on the apex while
 * `capacitor.config.ts` pins `server.url` to `app.rclipper.com`. Navigating to
 * the absolute URL then hands the app two failures at once: `allowNavigation`
 * does not match the bare apex, so Capacitor punts to the system browser; and
 * the session cookie was just set on the WebView's host, so the browser shows a
 * signed-out page. Keeping only the path sidesteps both, and is correct even
 * when the hosts do agree.
 */
function sameOriginPath(url: string | null | undefined, fallback: string): string {
  try {
    const parsed = new URL(url ?? fallback, window.location.origin);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Turn a `startOAuth` rejection into something a user can act on.
 *
 * Returns `null` when the user simply dismissed the account sheet — that is not
 * an error and must not be shown. Everything else returns a message, because a
 * silently swallowed rejection makes the sign-in button look like it does
 * nothing at all, which is indistinguishable from a dead button.
 *
 * The raw detail is appended deliberately: the common Credential Manager
 * failures differ only by code, and a device-side string is the fastest way to
 * tell "this build's SHA-1 is not registered" from "no Google account here".
 */
export function describeSignInFailure(error: unknown): string | null {
  if (error instanceof NativeSignInCancelled) return null;

  // Not a misconfiguration the user can do anything about — point them at the
  // sign-in methods that do work in-app rather than showing a diagnostic.
  if (error instanceof NativeSignInUnavailableError) {
    return "วิธีเข้าสู่ระบบนี้ยังใช้ไม่ได้บนอุปกรณ์นี้ กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน";
  }

  const detail = error instanceof Error ? error.message : String(error ?? "");

  // Credential Manager's "developer console is not set up correctly": the
  // package name + signing-certificate SHA-1 of *this* build has no matching
  // Android OAuth client. Debug builds from Android Studio are signed with the
  // debug keystore, so they need their own client even when release works.
  if (/developer console|DEVELOPER_ERROR|\b10:|\b28444\b/i.test(detail)) {
    return `แอปเวอร์ชันนี้ยังไม่ได้ลงทะเบียนกับ Google (ลายนิ้วมือ SHA-1 ของบิลด์นี้ไม่ตรง) — ${detail}`;
  }

  if (/no credential|NoCredentialException|\b28433\b/i.test(detail)) {
    return `ไม่พบบัญชี Google บนอุปกรณ์นี้ กรุณาเพิ่มบัญชีในการตั้งค่า Android ก่อน — ${detail}`;
  }

  if (/not implemented|unavailable|UNIMPLEMENTED/i.test(detail)) {
    return `แอปเวอร์ชันนี้ยังไม่รองรับการเข้าสู่ระบบแบบในแอป กรุณาอัปเดตแอป — ${detail}`;
  }

  return `เข้าสู่ระบบไม่สำเร็จ — ${detail || "unknown error"}`;
}
