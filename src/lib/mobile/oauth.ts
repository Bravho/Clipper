"use client";

import { signIn } from "next-auth/react";
import { Browser } from "@capacitor/browser";
import { isNativeMobile } from "@/lib/mobile/platform";
import {
  getNativeIdToken,
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
 * Start a third-party sign-in.
 *
 * Two paths, because the cookie jar differs per surface:
 *
 *  - **Web** — ordinary NextAuth redirect.
 *  - **Native app** — in-app sign-in (Android Credential Manager, iOS
 *    ASAuthorizationController). A Custom Tab / SFSafariViewController cannot be
 *    used: each has its own cookie jar, so the session cookie would land in the
 *    browser and the app WebView would stay signed out.
 *
 * The browser redirect remains as a fallback for any native combination that is
 * not configured (e.g. Google on iOS without NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID),
 * so a missing env var degrades rather than hard-fails.
 */
export async function startOAuth(
  provider: NativeProvider,
  callbackUrl: string
): Promise<void> {
  if (!isNativeMobile()) {
    await signIn(provider, { callbackUrl });
    return;
  }

  if (supportsNativeSignIn(provider)) {
    await startNativeSignIn(provider, callbackUrl);
    return;
  }

  const result = await signIn(provider, {
    callbackUrl,
    redirect: false,
  });
  if (!result?.url) throw new Error("OAuth provider returned no authorization URL.");
  await Browser.open({
    url: result.url,
    presentationStyle: "popover",
    toolbarColor: "#0f172a",
  });
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
  window.location.assign(result.url ?? callbackUrl);
}
