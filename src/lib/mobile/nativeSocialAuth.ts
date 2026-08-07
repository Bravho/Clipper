"use client";

import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { getMobilePlatform } from "@/lib/mobile/platform";

/**
 * Native (in-app) social sign-in for the Capacitor shells.
 *
 * Why native rather than a Custom Tab / SFSafariViewController redirect: those
 * browsers have their own cookie jars, separate from the Capacitor WebView.
 * Completing OAuth there sets the NextAuth session cookie *in the browser* and
 * leaves the app signed out — the "it logged me in in another browser" bug.
 * Android Credential Manager and iOS ASAuthorizationController both return an
 * ID token in-process, so no browser is involved and the session cookie is set
 * on a request the WebView makes itself.
 *
 * Setup requirements are in docs/NATIVE_SIGN_IN.md.
 */

export type NativeProvider = "google" | "apple";

/** The *web* client ID. Credential Manager uses it as its serverClientId. */
export function googleWebClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}

/** The iOS OAuth client ID. Native Google on iOS is skipped when unset. */
export function googleIosClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? "";
}

/**
 * Whether the SocialLogin native plugin is compiled into the installed binary.
 *
 * This matters because the shells load the site from `server.url`: a web deploy
 * reaches app versions that were built *before* the plugin was added. Their
 * Capacitor bridge has no SocialLogin implementation, so calling it would reject
 * with "not implemented" and break the sign-in button outright. Checking first
 * lets those older installs keep the browser redirect (broken sign-in, but no
 * worse than before) while updated installs get the native flow — so the server
 * can be deployed without waiting for the store releases.
 */
function nativePluginAvailable(): boolean {
  try {
    return Capacitor.isPluginAvailable("SocialLogin");
  } catch {
    return false;
  }
}

/**
 * Whether a provider can be handled natively on the current platform.
 *
 * Anything that returns `false` falls back to the browser redirect flow, so a
 * missing env var — or an app build without the plugin — degrades to today's
 * behaviour instead of a hard failure.
 */
export function supportsNativeSignIn(provider: NativeProvider): boolean {
  if (!nativePluginAvailable()) return false;

  const platform = getMobilePlatform();
  if (provider === "google") {
    if (platform === "android") return Boolean(googleWebClientId());
    if (platform === "ios") return Boolean(googleIosClientId());
    return false;
  }
  // Sign in with Apple is only native on iOS; Android keeps the web flow.
  return platform === "ios";
}

let initialised: Promise<void> | undefined;

function ensureInitialised(): Promise<void> {
  initialised ??= SocialLogin.initialize({
    google: {
      webClientId: googleWebClientId(),
      iOSClientId: googleIosClientId() || undefined,
    },
    apple: {
      // Empty string tells the plugin to use native ASAuthorizationController
      // on iOS rather than a redirect. `aud` is then the app's bundle ID.
      redirectUrl: "",
    },
  }).catch((error) => {
    // Reset so one transient failure does not permanently poison the singleton.
    initialised = undefined;
    throw error;
  });
  return initialised;
}

export interface NativeSignInResult {
  idToken: string;
  /**
   * Apple only. Apple omits names from the identity token and returns one to the
   * client *only* on the very first authorization — so it must be captured here
   * and forwarded, or the account is created with the email as its name.
   */
  name?: string;
}

/**
 * Run the native account picker and return the resulting ID token.
 *
 * The token is opaque to the client: it is verified server-side
 * (`src/lib/auth/oidcVerify.ts`) before any account is created or linked.
 *
 * @throws Error when misconfigured, when the provider returns no token, or when
 *         the user cancels (the plugin rejects on cancellation).
 */
export async function getNativeIdToken(
  provider: NativeProvider
): Promise<NativeSignInResult> {
  await ensureInitialised();

  if (provider === "google") {
    const { result } = await SocialLogin.login({
      provider: "google",
      options: {
        scopes: ["email", "profile"],
        // Always show the picker. Without these, Credential Manager silently
        // reuses the last account, so a signed-out user cannot switch accounts.
        filterByAuthorizedAccounts: false,
        autoSelectEnabled: false,
      },
    });

    // `offline` mode would return only a serverAuthCode; we stay online.
    if (!("idToken" in result) || !result.idToken) {
      throw new Error("Google sign-in returned no ID token.");
    }
    return { idToken: result.idToken };
  }

  const { result } = await SocialLogin.login({
    provider: "apple",
    options: { scopes: ["name", "email"] },
  });

  if (!result.idToken) {
    throw new Error("Sign in with Apple returned no identity token.");
  }

  const name = [result.profile?.givenName, result.profile?.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return { idToken: result.idToken, name: name || undefined };
}

/**
 * Clear native credential state on sign-out.
 *
 * Without this, NextAuth's signOut only clears the WebView cookie: Credential
 * Manager still holds the Google account, so the next sign-in silently reuses it
 * and the user can neither switch accounts nor truly sign out.
 *
 * Best-effort by design — a provider that was never used, or Apple (which has no
 * sign-out API and rejects here), must not block the session teardown.
 */
export async function clearNativeSignIn(): Promise<void> {
  if (getMobilePlatform() === "web" || !nativePluginAvailable()) return;

  await ensureInitialised().catch(() => undefined);

  await Promise.all(
    (["google", "apple"] as const).map((provider) =>
      SocialLogin.logout({ provider }).catch(() => undefined)
    )
  );
}
