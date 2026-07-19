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
    // Restrict in-WebView navigation to your own domain(s) plus the OAuth /
    // payment redirect hosts you actually use. Everything else opens externally.
    allowNavigation: [
      "app.rclipper.com",
      "*.rclipper.com",
      "accounts.google.com",
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
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0f172aff",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
