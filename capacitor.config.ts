import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — WebView-shell architecture.
 *
 * RClipper is a server-rendered Next.js app (SSR + API routes + NextAuth). Rather
 * than statically bundling the UI, the native app loads the deployed site via
 * `server.url`. All server logic (auth, AI pipeline, storage) stays untouched;
 * the shell adds native capabilities (push, camera, share) on top.
 *
 * Set CAP_SERVER_URL at build time to point at prod vs staging, e.g.:
 *   CAP_SERVER_URL=https://staging.rclipper.app npx cap sync
 *
 * `webDir` is a minimal offline shell shown before the remote site loads (or when
 * fully offline with no cached page).
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://app.rclipper.com";

const config: CapacitorConfig = {
  appId: "com.rclipper.app",
  appName: "RClipper",
  webDir: "capacitor-shell",
  server: {
    url: serverUrl,
    cleartext: false,
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
    ],
  },
  ios: {
    contentInset: "always",
    appendUserAgent: " RClipperNative/ios",
  },
  android: {
    allowMixedContent: false,
    appendUserAgent: " RClipperNative/android",
  },
  plugins: {
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
