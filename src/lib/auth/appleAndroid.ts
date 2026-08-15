/**
 * Shared configuration for Sign in with Apple on **Android**.
 *
 * Android has no Sign in with Apple SDK, so the flow is ordinary OAuth: the
 * `@capgo/capacitor-social-login` plugin opens Apple's authorize page in a
 * Chrome Custom Tab, Apple `form_post`s the authorization code to the callback
 * route in this app, and the route hands the resulting tokens back to the app
 * through a deep link. See `src/app/api/auth/apple/android-callback/route.ts`.
 *
 * The same `redirect_uri` string has to appear in three places, byte for byte:
 *
 *  1. the authorize URL the plugin builds **on the device**,
 *  2. the token exchange this server performs, and
 *  3. the Return URL registered on the Apple **Services ID**.
 *
 * Apple reports a mismatch only as `invalid_client`, which says nothing about
 * which of the three is wrong. So it is derived here, once, and served to the
 * device from `/api/mobile/auth-config` rather than being rebuilt client-side.
 */

/** Path of the route Apple posts the authorization code to. */
export const APPLE_ANDROID_CALLBACK_PATH = "/api/auth/apple/android-callback";

/**
 * Deep link used to hand the tokens back to the app.
 *
 * A custom scheme rather than an App Link because `assetlinks.json` still
 * carries the local upload key's fingerprint rather than Play App Signing's, so
 * https App Link verification fails on Play-installed builds — see
 * docs/NATIVE_SIGN_IN.md. The scheme must match the `<intent-filter>` in
 * `android/app/src/main/AndroidManifest.xml`.
 */
export const APPLE_ANDROID_DEEP_LINK = "com.rclipper.app://apple-login";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * The `redirect_uri` for the Android Apple flow, or `""` when it cannot be
 * determined — in which case the button is not offered at all rather than
 * offered and broken.
 *
 * `APPLE_ANDROID_REDIRECT_URL` overrides everything, for the case where the
 * host Apple redirects to is deliberately not `NEXTAUTH_URL` (the web app is
 * canonical on the apex while the shell is pinned to `app.rclipper.com`).
 */
export function appleAndroidRedirectUrl(): string {
  const explicit = env("APPLE_ANDROID_REDIRECT_URL");
  if (explicit) return explicit;

  const origin = env("NEXTAUTH_URL");
  if (!origin) return "";

  return `${origin.replace(/\/+$/, "")}${APPLE_ANDROID_CALLBACK_PATH}`;
}

/** The `client_id` for the Android flow: the **Services ID**, not the bundle ID. */
export function appleAndroidClientId(): string {
  return env("APPLE_CLIENT_ID");
}

/**
 * Whether the server can service the Android Apple flow at all.
 *
 * The client secret is included deliberately: without it the token exchange
 * fails *after* the user has already signed in with Apple, which is a far worse
 * experience than the button not being there.
 */
export function isAppleAndroidConfigured(): boolean {
  return Boolean(
    appleAndroidClientId() && appleAndroidRedirectUrl() && env("APPLE_CLIENT_SECRET")
  );
}
