# Capacitor setup — RClipper mobile (WebView shell)

The web-side PWA and the Capacitor config are already in the repo. These are the
one-time local steps to generate and run the native iOS/Android projects. They
require native toolchains that can't run in CI-less environments:

- **iOS:** macOS + Xcode + CocoaPods.
- **Android:** Android Studio + JDK 17.

## 1. Install dependencies

```bash
npm install
```

This pulls in `@capacitor/*` (added to `package.json`).

## 2. Add native platforms

```bash
npm run cap:add:ios       # creates ./ios (macOS only)
npm run cap:add:android   # creates ./android
```

`capacitor.config.ts` uses `webDir: "capacitor-shell"` (a minimal loading page)
and loads the live site via `server.url`. Point it at staging/prod with:

```bash
CAP_SERVER_URL=https://staging.rclipper.app npm run cap:sync
```

## 3. Sync & open

```bash
npm run cap:sync
npm run cap:open:ios       # opens Xcode
npm run cap:open:android   # opens Android Studio
```

Build/run from the IDE onto a simulator or device.

## 4. Auth (important)

Google OAuth is **blocked inside embedded WebViews**. Use `@capacitor/browser`
to open the sign-in leg in the system browser, then deep-link back into the app.
Register a custom URL scheme / App Link / Universal Link and add the callback to
NextAuth's allowed redirect URLs. Test the full sign-in and payment-redirect
round trips on device before store submission.

## 5. Native features to wire (installed, not yet integrated)

- `@capacitor/push-notifications` — request-status + staff alerts (needs FCM/APNs
  + a server token registry).
- `@capacitor/camera`, `@capacitor/share`, `@capacitor/network`,
  `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/preferences`.

## 6. Store compliance

Ship genuine native value (push, camera capture, native share, offline fallback)
so Apple 4.2 / Google minimum-functionality reviews don't reject the app as a
thin web wrapper. Prepare screenshots, the existing `/privacy` policy, a data
safety form, and a reviewer/demo account.

## Files added for mobile/PWA

- `capacitor.config.ts` — shell config (appId `com.rclipper.app`).
- `capacitor-shell/` — loading page shown before the remote site loads.
- `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*` — PWA.
- `src/components/pwa/ServiceWorkerRegister.tsx` — SW registration (prod only).
- `src/app/offline/page.tsx` — offline fallback.
