"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { getMobilePlatform } from "@/lib/mobile/platform";
import {
  loadNativeAuthConfig,
  type NativeAuthConfig,
} from "@/lib/mobile/nativeAuthConfig";

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
 * The first iOS build whose `Info.plist` declares the reversed-client-ID URL
 * scheme that GoogleSignIn requires.
 *
 * This is not belt-and-braces — it is load-bearing. The shells load their JS
 * from `server.url`, so the running code is whatever was last deployed, but the
 * `Info.plist` inside an *installed* binary can never change. Build 9 shipped
 * with no `CFBundleURLTypes` key at all (verified in the archive), so the moment
 * the server started returning `iosClientId`, every build-9 install began
 * showing a Google button that cannot work.
 *
 * And it does not fail politely. `GIDSignIn.m` raises an **uncaught
 * NSException** — "Your app is missing support for the following URL schemes" —
 * which Swift cannot catch, so the app terminates. A crash on tap is a harder
 * App Store rejection (Guideline 2.1) than the browser hop that started all
 * this.
 *
 * So the button is offered only to binaries that can actually service it. Raise
 * this constant only if a later build changes the URL scheme again.
 */
const MIN_IOS_BUILD_FOR_NATIVE_GOOGLE = 10;

/**
 * The first Android `versionCode` that can complete Sign in with Apple.
 *
 * Same reasoning as the iOS constant above, different failure. Android's Apple
 * flow returns through a `com.rclipper.app://apple-login` deep link, which needs
 * both an `<intent-filter>` in the manifest and `MainActivity` forwarding
 * `onNewIntent` to the plugin. Neither exists in versionCode ≤ 4, and neither
 * can be added by deploying the web app — they live in the installed binary.
 *
 * The failure on an older install is silent rather than loud: Apple signs the
 * user in, Chrome fires an intent nothing handles, and the plugin's call never
 * settles. The button spins until the app is killed.
 *
 * **Keep this in step with `versionCode` in android/app/build.gradle.** If Play
 * rejects the upload because that number is taken, raise both together.
 */
const MIN_ANDROID_BUILD_FOR_NATIVE_APPLE = 5;

let buildNumber: Promise<number> | undefined;

/** `CFBundleVersion` on iOS / `versionCode` on Android, as a number. */
function nativeBuildNumber(): Promise<number> {
  buildNumber ??= App.getInfo()
    .then((info) => Number.parseInt(info.build, 10))
    .catch(() => Number.NaN);
  return buildNumber;
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
 * Async because the client IDs come from the server at runtime rather than from
 * the JS bundle — see src/lib/mobile/nativeAuthConfig.ts for why. Anything that
 * returns `false` means the provider's button is **hidden**; there is no browser
 * fallback, because that is what App Store review rejected build 9 for.
 */
export async function supportsNativeSignIn(
  provider: NativeProvider
): Promise<boolean> {
  if (!nativePluginAvailable()) return false;

  const platform = getMobilePlatform();
  const config = await loadNativeAuthConfig();

  if (provider === "google") {
    if (platform === "android") return Boolean(config.googleWebClientId);
    if (platform === "ios") {
      if (!config.googleIosClientId) return false;
      // Fail closed: an unreadable build number hides the button rather than
      // risking the crash described above. Apple and email/password remain, so
      // no one is left without a way in.
      const build = await nativeBuildNumber();
      return Number.isFinite(build) && build >= MIN_IOS_BUILD_FOR_NATIVE_GOOGLE;
    }
    return false;
  }

  // Sign in with Apple.
  //
  // iOS has a real native path (ASAuthorizationController) and needs no
  // configuration on the device. Android has no Apple SDK at all, so it runs the
  // OAuth flow: a Custom Tab to Apple, then back into the app through a deep
  // link. That requires three things to line up, and all three are checked here
  // rather than discovered at the point of tapping.
  if (platform === "ios") return true;
  if (platform !== "android") return false;

  // 1 + 2: the server can service the flow (Services ID, redirect URL and
  // client secret all present — see isAppleAndroidConfigured).
  if (!config.appleServicesClientId || !config.appleAndroidRedirectUrl) return false;

  // 3: this *binary* can receive the deep link. The shells load their JS from
  // `server.url`, so this code reaches installs built before the intent-filter
  // and the MainActivity forwarding existed. On those, Apple would sign the user
  // in and the result would never come back — the button would spin for ever.
  // Fail closed on an unreadable build number, exactly as the iOS gate does.
  const build = await nativeBuildNumber();
  return Number.isFinite(build) && build >= MIN_ANDROID_BUILD_FOR_NATIVE_APPLE;
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
export async function nativeSignInDiagnostics(provider: NativeProvider) {
  const platform = getMobilePlatform();
  const config = await loadNativeAuthConfig();
  const clientId =
    provider === "apple"
      ? // iOS uses no client ID (the bundle ID is the audience); Android uses the
        // Services ID, and getting the wrong one here is a live failure mode.
        config.appleServicesClientId
      : provider === "google" && platform === "ios"
        ? config.googleIosClientId
        : config.googleWebClientId;

  return {
    provider,
    platform,
    capacitorPlatform: Capacitor.getPlatform(),
    pluginAvailable: nativePluginAvailable(),
    supportsNative: await supportsNativeSignIn(provider),
    // "server" means /api/mobile/auth-config answered; "bundle" means it did
    // not and these are the values frozen in at build time.
    configSource: config.source,
    build: await nativeBuildNumber(),
    minBuildForNativeGoogle: MIN_IOS_BUILD_FOR_NATIVE_GOOGLE,
    minBuildForAndroidApple: MIN_ANDROID_BUILD_FOR_NATIVE_APPLE,
    clientIdTail: clientId ? `…${clientId.slice(-28)}` : "(unset)",
    // Not truncated: this is the value that has to match the Services ID's
    // Return URL exactly, and a truncated one cannot be compared against Apple's
    // console. It is a plain URL to a public endpoint.
    appleAndroidRedirectUrl: config.appleAndroidRedirectUrl || "(unset)",
  };
}

let initialised: Promise<void> | undefined;

async function ensureInitialised(): Promise<void> {
  initialised ??= initialise();
  return initialised;
}

/**
 * Apple's slice of the `initialize` payload — or nothing at all.
 *
 * The two platforms want different, and mutually invalid, values, and Android
 * **validates** them: an empty `redirectUrl` makes the native plugin reject the
 * whole `initialize()` call with `apple.android.redirectUrl is null or empty`.
 * Android processes the `apple` block *before* `google`, so passing iOS's empty
 * sentinel there did not merely disable Apple — it aborted initialisation and
 * took Google sign-in down with it.
 *
 * Hence: never pass a blank. A provider that cannot be configured on this
 * platform is omitted from the payload entirely.
 */
function appleInitOptions(config: NativeAuthConfig): {
  apple?: { clientId?: string; redirectUrl: string };
} {
  const platform = getMobilePlatform();

  // iOS: an empty `redirectUrl` is the plugin's sentinel for "present
  // ASAuthorizationController natively rather than redirecting". Load-bearing —
  // do not fill it in.
  if (platform === "ios") return { apple: { redirectUrl: "" } };

  if (
    platform === "android" &&
    config.appleServicesClientId &&
    config.appleAndroidRedirectUrl
  ) {
    return {
      apple: {
        // The **Services ID**, not the bundle ID: on Android this is a plain
        // OAuth client, so `aud` comes back as the Services ID. `appleAudiences()`
        // already accepts it, which is why the server needs no change.
        clientId: config.appleServicesClientId,
        redirectUrl: config.appleAndroidRedirectUrl,
      },
    };
  }

  return {};
}

async function initialise(): Promise<void> {
  const config = await loadNativeAuthConfig();

  return SocialLogin.initialize({
    google: {
      webClientId: config.googleWebClientId,
      iOSClientId: config.googleIosClientId || undefined,
      // The **web** client ID, as `serverClientID` on iOS. It does not move the
      // token's `aud` — that stays the iOS client ID, which is why
      // `googleAudiences()` accepts a list — it just registers the backend as an
      // additional relying party. Harmless when unset.
      iOSServerClientId: config.googleWebClientId || undefined,
    },
    ...appleInitOptions(config),
  }).catch((error) => {
    // Reset so one transient failure does not permanently poison the singleton.
    initialised = undefined;
    throw error;
  });
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
 * How long to wait, after the app comes back to the foreground, before deciding
 * the user backed out of the Custom Tab.
 *
 * The successful path also brings the app forward — Chrome fires the deep-link
 * intent, which resumes the activity — and `onNewIntent` lands a moment later.
 * Too short and a success is misread as a cancellation; too long and a genuine
 * back-press leaves the button spinning. A couple of seconds covers the gap.
 */
const APPLE_REDIRECT_GRACE_MS = 2500;

/**
 * Wrap the Android Apple login so dismissing the Custom Tab settles the promise.
 *
 * Unlike Credential Manager and ASAuthorizationController, the Custom Tab flow
 * has no cancellation callback: the plugin settles its call only when the deep
 * link arrives. Backing out therefore settles *nothing*, and the button spins
 * for ever with no way back.
 *
 * Known limitation: the plugin's internal `lastcall` stays pending, and nothing
 * it exposes can clear it, so a second attempt in the same app session rejects
 * with "Last call is not null". `describeSignInFailure` translates that into
 * "reopen the app" rather than showing the raw plugin string.
 */
async function withCustomTabCancellation<T>(login: () => Promise<T>): Promise<T> {
  let cancel: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new NativeSignInCancelled());
  });

  // Registered before the tab opens, so a fast back-press is not missed.
  const listener = await App.addListener("resume", () => {
    timer = setTimeout(() => cancel?.(), APPLE_REDIRECT_GRACE_MS);
  });

  try {
    return await Promise.race([login(), cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    await listener.remove().catch(() => undefined);
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

  const appleLogin = () =>
    SocialLogin.login({
      provider: "apple",
      options: { scopes: ["name", "email"] },
    });

  const { result } = await runNativeLogin(() =>
    // Only Android leaves the app for a Custom Tab. iOS presents a sheet that
    // rejects on dismissal by itself, so it must not be wrapped.
    getMobilePlatform() === "android"
      ? withCustomTabCancellation(appleLogin)
      : appleLogin()
  );

  if (!result.idToken) {
    throw new Error("Sign in with Apple returned no identity token.");
  }

  // Populated on iOS only. The Android provider builds its profile by decoding
  // the identity token, and Apple never puts a name in there — it arrives as a
  // separate `user` form field on the callback, which the plugin discards. The
  // server picks it up from there instead; see src/lib/auth/appleNameMemo.ts.
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
