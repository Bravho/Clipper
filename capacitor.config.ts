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
/**
 * THE DEFAULT IS THE DROPLET, AND THAT IS THE POINT.
 *
 * The app talks to the deployed site — auth, the AI pipeline, the render queue,
 * storage — so a build with no CAP_SERVER_URL is a build that works anywhere
 * the phone has a network, with no developer machine involved. Pointing it at a
 * PC on the LAN is a debugging convenience that only works while that PC is on
 * the same Wi-Fi and running `npm run dev`.
 */
export const PRODUCTION_SERVER_URL = "https://app.rclipper.com";

const serverUrl = (process.env.CAP_SERVER_URL ?? PRODUCTION_SERVER_URL).trim();
const parsedServerUrl = new URL(serverUrl);
if (!(["http:", "https:"].includes(parsedServerUrl.protocol))) {
  throw new Error("CAP_SERVER_URL must use http:// or https://");
}

/**
 * A plain-http target has to be asked for twice.
 *
 * Setting CAP_SERVER_URL is easy to do once and forget, and a shell that keeps
 * it exported turns every later build into a LAN build — an APK that shows a
 * blank page the moment the phone leaves the office, with nothing on screen to
 * explain why. Requiring CAP_ALLOW_LAN=1 as well makes the LAN build a
 * deliberate act, and makes the accident loud instead of silent.
 */
if (parsedServerUrl.protocol === "http:" && process.env.CAP_ALLOW_LAN !== "1") {
  throw new Error(
    `Refusing to build against ${serverUrl}: a plain-http target is a LAN debug ` +
      `build that only works next to that machine. Set CAP_ALLOW_LAN=1 as well if ` +
      `you really mean it, or unset CAP_SERVER_URL to build against ` +
      `${PRODUCTION_SERVER_URL}.`
  );
}

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
const isCleartext = parsedServerUrl.protocol === "http:";

/** Host[:port] of the dev server, so the WebView is allowed to navigate to it. */
const devHost = parsedServerUrl.host;

if (isCleartext) {
  console.warn(
    `[capacitor] LAN DEBUG BUILD: cleartext http allowed for ${devHost}. ` +
      `This app will only work while that machine is running the dev server on ` +
      `the same network. Do NOT ship it — unset CAP_SERVER_URL and re-run cap sync.`
  );
} else {
  console.log(`[capacitor] Building against ${serverUrl}`);
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
    // The app bar is white: dark status-bar text from the first frame
    // (NativeStatusBar repeats this from the page for older installs).
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#ffffff",
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#ffffffff",
      showSpinner: false,
    },
  },
};

export default config;
