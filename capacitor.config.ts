import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — WebView-shell architecture.
 *
 * RClipper is a server-rendered Next.js app (SSR + API routes + NextAuth). Rather
 * than statically bundling the UI, the native app loads the deployed site via
 * `server.url`. All server logic (auth, AI pipeline, storage) stays untouched;
 * the shell adds native capabilities (push, camera, share) on top.
 *
 * Set CAP_SERVER_URL at build time to point at prod, staging, or a dev machine:
 *
 *   Windows CMD:   set CAP_SERVER_URL=http://192.168.1.42:3000 && npx cap sync android
 *   PowerShell:    $env:CAP_SERVER_URL="http://192.168.1.42:3000"; npx cap sync android
 *   macOS/Linux:   CAP_SERVER_URL=http://192.168.1.42:3000 npx cap sync android
 *
 * NOTE: `VAR=value cmd` is shell syntax that Windows CMD does not understand —
 * it reports "'CAP_SERVER_URL' is not recognized as an internal or external
 * command". Use `set` (CMD) or `$env:` (PowerShell) there.
 *
 * `webDir` is a minimal offline shell shown before the remote site loads (or when
 * fully offline with no cached page).
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://app.rclipper.com";

/**
 * Pointing the shell at a LAN dev server means plain http, which Android blocks
 * by default — the WebView would simply show a blank page with no obvious cause.
 *
 * These two settings are therefore derived from the URL rather than hand-edited:
 * hand-editing means remembering to revert them, and a `cleartext: true` that
 * survives into a release build silently permits unencrypted traffic in
 * production. Deriving them makes an https URL — every real deployment — always
 * produce the locked-down configuration.
 */
const isCleartext = serverUrl.startsWith("http://");

/** Host[:port] of the dev server, so the WebView is allowed to navigate to it. */
const devHost = (() => {
  try {
    return new URL(serverUrl).host;
  } catch {
    return null;
  }
})();

if (isCleartext) {
  console.warn(
    `[capacitor] DEV BUILD: cleartext http allowed for ${devHost}. ` +
      `Do NOT ship this build — unset CAP_SERVER_URL and re-run cap sync.`
  );
}

const config: CapacitorConfig = {
  appId: "com.rclipper.app",
  appName: "RClipper",
  webDir: "capacitor-shell",
  server: {
    url: serverUrl,
    // Only ever true for an http:// CAP_SERVER_URL, i.e. a local dev server.
    cleartext: isCleartext,
    // Third-party identity providers are never loaded in the WebView: Google
    // blocks OAuth in embedded user agents. Sign-in runs natively instead —
    // Android Credential Manager, and on iOS ASAuthorizationController for Apple
    // and the GoogleSignIn SDK (an ASWebAuthenticationSession sheet presented
    // over the app) for Google. Neither leaves the app.
    //
    // A Custom Tab or SFSafariViewController is deliberately NOT used as a
    // fallback: neither shares a cookie jar with the WebView, so the session
    // would land in the browser and the app would stay signed out — and App
    // Store review rejected build 9 under Guideline 4 for exactly that. A
    // provider with no native path is hidden instead. See docs/NATIVE_SIGN_IN.md.
    allowNavigation: [
      "app.rclipper.com",
      "*.rclipper.com",
      // The dev host, when CAP_SERVER_URL points at one. Absent from every
      // https build, so a release APK still only trusts rclipper.com.
      ...(isCleartext && devHost ? [devHost] : []),
    ],
  },
  ios: {
    contentInset: "always",
    appendUserAgent: " RClipperNative/ios",
  },
  android: {
    // Mixed content only on a cleartext dev build, for the same reason as above.
    allowMixedContent: isCleartext,
    appendUserAgent: " RClipperNative/android",
  },
  plugins: {
    // Pipeline notices tell the requester it is their turn to act, so they are
    // worth showing even while the app is open. Without presentationOptions iOS
    // silently swallows a foreground notification.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: true,
        twitter: false,
      },
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0f172aff",
      showSpinner: false,
    },
  },
};

export default config;
