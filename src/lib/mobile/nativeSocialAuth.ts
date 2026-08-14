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

/**
 * The **web** client ID. Credential Manager takes it as its `serverClientId`.
 *
 * It must be the *web* client — not the Android one. Both live in the same
 * Google Cloud project and look identical (`<project>-<hash>.apps.google...`),
 * so the two are easy to swap; the Android client exists only so Google can
 * match the package name + signing certificate, and has no client secret, so
 * Credential Manager rejects it as a `serverClientId`. The symptom is a bare
 * rejection with no account sheet — indistinguishable from a dead button.
 */
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

/**
 * A snapshot of everything that decides which sign-in path runs.
 *
 * Every native sign-in failure looks the same from the outside, and the shells
 * load their JS from `server.url`, so the running code is whatever was last
 * deployed — you cannot tell from the app which branch it took. Logging this on
 * every attempt makes `adb logcat` answer that in one line instead of a guess.
 *
 * The client ID is truncated: it is not a secret (it ships in the bundle), but a
 * full ID in a log invites copy-pasting the wrong one back into config. The tail
 * is what differs between the web and Android clients, so it is the useful part.
 */
export function nativeSignInDiagnostics(provider: NativeProvider) {
  const clientId =
    provider === "google" && getMobilePlatform() === "ios"
      ? googleIosClientId()
      : googleWebClientId();

  return {
    provider,
    platform: getMobilePlatform(),
    capacitorPlatform: Capacitor.getPlatform(),
    pluginAvailable: nativePluginAvailable(),
    supportsNative: supportsNativeSignIn(provider),
    clientIdTail: clientId ? `…${clientId.slice(-28)}` : "(unset)",
  };
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
 * Thrown when the user dismisses the native account sheet.
 *
 * Both Credential Manager and ASAuthorizationController reject on dismissal, and
 * that rejection is otherwise indistinguishable from a genuine failure. Callers
 * need the distinction: a dismissal must stay silent, anything else must be
 * shown to the user rather than swallowed.
 */
export class NativeSignInCancelled extends Error {
  constructor(message = "Native sign-in was cancelled.") {
    super(message);
    this.name = "NativeSignInCancelled";
  }
}

/**
 * Android throws `GetCredentialCancellationException` ("activity is cancelled by
 * the user"); iOS throws `ASAuthorizationError.canceled`, surfaced as code 1001.
 */
function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cancell?ed|\b1001\b/i.test(message);
}

async function runNativeLogin<T>(login: () => Promise<T>): Promise<T> {
  try {
    return await login();
  } catch (error) {
    if (isCancellation(error)) throw new NativeSignInCancelled();
    throw error;
  }
}

/**
 * Run the native account picker and return the resulting ID token.
 *
 * The token is opaque to the client: it is verified server-side
 * (`src/lib/auth/oidcVerify.ts`) before any account is created or linked.
 *
 * @throws NativeSignInCancelled when the user dismisses the account sheet.
 * @throws Error when misconfigured or when the provider returns no token.
 */
export async function getNativeIdToken(
  provider: NativeProvider
): Promise<NativeSignInResult> {
  await ensureInitialised();

  if (provider === "google") {
    const { result } = await runNativeLogin(() =>
      SocialLogin.login({
        provider: "google",
        options: {
          scopes: ["email", "profile"],
          // Always show the picker. Without these, Credential Manager silently
          // reuses the last account, so a signed-out user cannot switch accounts.
          filterByAuthorizedAccounts: false,
          autoSelectEnabled: false,
        },
      })
    );

    // `offline` mode would return only a serverAuthCode; we stay online.
    if (!("idToken" in result) || !result.idToken) {
      throw new Error("Google sign-in returned no ID token.");
    }
    return { idToken: result.idToken };
  }

  const { result } = await runNativeLogin(() =>
    SocialLogin.login({
      provider: "apple",
      options: { scopes: ["name", "email"] },
    })
  );

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
