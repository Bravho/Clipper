# Clipper / Travy — PWA & Mobile App Development Plan

_Prepared: 8 July 2026. Target: turn the existing Next.js 14 web app into an installable PWA and ship native iOS + Android apps via Capacitor, using the **WebView-shell** architecture._

---

## 1. Current state (assessment)

The app is a **Next.js 14 App Router** project (TypeScript, Tailwind, NextAuth v4, PostgreSQL via `pg`). Key facts that shape this plan:

- **Server-rendered.** Pages are React Server Components with route protection in `src/middleware.ts` (`withAuth`). Auth is server-session based (NextAuth JWT). This cannot be exported as a purely static bundle without a major refactor.
- **API routes** live under `src/app/api/*` (auth, register, requests, uploads, staff/*, admin/*, payments, credits). The mobile app needs these reachable over HTTPS.
- **Heavy server-side work**: AI video pipeline (Remotion, FFmpeg, Gemini, ElevenLabs), Digital Ocean Spaces storage, email. None of this can run inside a mobile WebView — it must stay on the server.
- **No PWA today**: no `manifest.json`, no service worker, no offline handling. `public/` has only `logo.png` and a `music/` folder.
- **No Capacitor** installed.
- Branding is already **"Travy"** in the display layer (`PLATFORM_LABELS[Platform.TventApp] = "Travy App"`).

**Conclusion:** because almost all value lives server-side, the correct mobile strategy is a **WebView shell** that loads the deployed site, not a static re-bundle. This is the fastest path, preserves SSR/auth/API untouched, and still unlocks native capabilities (push, camera, share, secure storage, app-store presence).

---

## 2. Tvent → Travy rename (DONE this session — user-facing scope)

Per the chosen scope (**user-facing only**), the following visible strings were changed from "Tvent" to "Travy":

- `src/app/layout.tsx` — SEO meta description.
- `src/app/(public)/page.tsx` — hero copy, stats strip, distribution section heading/body, and channel chip (5 visible strings + 1 comment).

**Left unchanged on purpose** (internal identifiers, no user impact):

- Enum value `Platform.TventApp = "tvent_app"` — renders as "Travy App" via `PLATFORM_LABELS`.
- DB columns (`final_export_tvent_asset_id`, `tvent_video_status`), env vars (`TVENT_API_KEY`, `TVENT_API_URL`), filenames (`lib/social/tventService.ts`), Spaces keys, and code identifiers.

### Optional future "deep rename" (not done — would need a migration)

If you later want to erase "tvent" from the codebase entirely:

1. Rename the DB columns via a new migration (`00X_rename_tvent_to_travy.sql`) with `ALTER TABLE ... RENAME COLUMN`, and update `PostgresVideoGenerationJobRepository.ts` column maps.
2. Change the enum string `"tvent_app"` → `"travy_app"` **and** migrate existing `clip_requests.target_platforms` / stored rows that contain the old value.
3. Rename env vars `TVENT_*` → `TRAVY_*` in `.env.example`, `src/config/aiTools.ts`, and deployment secrets.
4. Rename `tventService.ts` → `travyService.ts` and update imports.

This is a coordinated code + data change and should be a dedicated ticket with a backfill/rollback plan. Recommended only once mobile/PWA work is stable.

---

## 3. Phase A — Progressive Web App (PWA)

Goal: the web app is installable, has an app icon/splash, and degrades gracefully offline. This also becomes the foundation the Capacitor shell loads.

### A1. Web app manifest

Add `public/manifest.webmanifest` (name, short_name "RClipper", theme/background color matching the slate‑900 UI, `display: standalone`, `start_url: "/"`, icon set 192/256/384/512 + maskable). Reference it from `src/app/layout.tsx` via the Next `metadata` export (`manifest: "/manifest.webmanifest"`) and add `themeColor`/`viewport` (`viewport-fit=cover` for notch handling). _(RClipper is the app; Travy is the external distribution platform it publishes videos to.)_

### A2. Icons & splash

Generate a full icon set from a high-res Travy mark (replace/augment `public/logo.png`). Produce: `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` (180×180), and favicons. A single script using `sharp` (already a dependency) can emit every size from one source SVG/PNG.

### A3. Service worker (offline + caching)

Two viable routes:

- **`@ducanh2912/next-pwa`** (community successor to `next-pwa`, supports App Router) — wraps `next.config.js`, auto-generates a Workbox service worker. Fastest to adopt.
- **Manual Workbox / custom SW** — more control, no extra Next wrapper. Preferred if the plugin fights the build.

Caching policy for this app: **network-first** for HTML/route navigations and all `/api/*` calls (data must be fresh — credits, request status, pipeline state), **cache-first** for static assets (`/_next/static`, fonts, icons), and a branded **offline fallback page** (`app/offline/page.tsx`). Do **not** cache authenticated API responses aggressively — stale credit/pipeline data is a support risk.

### A4. Install & platform polish

- Custom "Add to Home Screen" prompt handling (`beforeinstallprompt`) with a dismissible banner in `components/layout/`.
- iOS PWA meta tags (`apple-mobile-web-app-capable`, status-bar style) — iOS ignores the manifest for some of these.
- Safe-area CSS (`env(safe-area-inset-*)`) in `globals.css` so the fixed Navbar/Footer clear notches and the home indicator.

### A5. QA

Lighthouse PWA audit (installable, SW registered, offline reachable), install on Android Chrome and iOS Safari, verify auth flow survives a cold offline→online transition.

**Phase A deliverable:** an installable PWA. This alone gives mobile users an app-like experience with no store involvement.

---

## 4. Phase B — Capacitor mobile shell (iOS + Android)

Goal: real App Store / Play Store apps that load the deployed Travy site in a managed WebView and add native features. **Recommended architecture: `server.url` shell.**

### Why the WebView shell (and not a static export)

| Factor | WebView shell (recommended) | Static client refactor |
|---|---|---|
| Effort | Low — days | High — weeks (rip out server components, rebuild auth as token/API, static export) |
| SSR / API / NextAuth | Untouched | Must be re-architected |
| Time to store | Fast | Slow |
| True offline app bundle | Partial (via PWA SW) | Full |
| Update model | Push web deploy → all users updated instantly | App bundle updates need store review (or OTA tooling) |
| Risk to existing code | Minimal | High |

For a server-heavy app like this, the shell captures ~90% of native value at ~10% of the cost. Revisit the static route only if you need deep offline authoring or the stores reject a pure wrapper (mitigation below).

### B1. Install & scaffold

Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`. Create `capacitor.config.ts`:

- `appId: "com.travy.app"` (confirm final bundle ID), `appName: "Travy"`.
- `server.url: "https://<prod-domain>"` + `server.cleartext: false` so the WebView loads the live site.
- A tiny `webDir` placeholder (a minimal `public/` shell page shown before the remote loads / when fully offline).
- `ios` and `android` scheme/allow-navigation config restricted to your domain(s) + OAuth/payment redirect hosts.

> Environment split: use a dev `server.url` (LAN IP or staging) vs prod via separate config or build-time env, so QA builds hit staging.

### B2. Native project generation

`npx cap add ios` and `npx cap add android` create the Xcode and Android Studio projects (committed to repo or generated in CI). `npx cap sync` wires plugins.

### B3. Auth & deep-link considerations (the main integration risk)

- **Google OAuth** in a WebView: Google blocks OAuth in embedded WebViews. Use `@capacitor/browser` (opens the system browser / SFSafariViewController / Chrome Custom Tab) for the sign-in leg, then return via a **custom URL scheme / App Link / Universal Link** deep link back into the app. NextAuth callback URLs must whitelist these.
- **Session persistence**: cookies inside the Capacitor WebView persist, but validate that NextAuth's cookie flags (`Secure`, `SameSite`) behave under the `capacitor://`/`https://` origin. May need `sameSite: "none"` for the OAuth redirect hop.
- **Payments** (GBPrimePay webhook/redirect flows under `api/payments`): redirects must resolve back into the app via deep links; test the full top-up round trip.

### B4. Native capabilities to add

- **Push notifications** (`@capacitor/push-notifications` + FCM/APNs) — notify requesters when a clip changes status (submitted → editing → published → delivered) and staff on new work. Requires a server-side token registry + send hook in the notification service.
- **Camera / file picker** (`@capacitor/camera`, `@capacitor/filesystem`) — let requesters shoot/upload source media directly; wire into the existing upload API.
- **Share sheet** (`@capacitor/share`) — share published clip links.
- **Status bar, splash screen, haptics, secure storage** (`@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/preferences`).
- **Network status** (`@capacitor/network`) — drive the offline UI.

### B5. Store compliance (avoid "just a website" rejection)

Apple 4.2 / Google minimum-functionality guidelines reject thin wrappers. Mitigate by shipping genuine native value: push notifications, camera capture, native share, offline fallback, and platform-correct navigation. Prepare store assets (screenshots, privacy policy — you already have `/privacy`, data-safety form, app icon), and a demo/reviewer account (seed accounts exist).

### B6. Build & release pipeline

CI (GitHub Actions / EAS-style) to run `cap sync`, build IPA/AAB, and submit. Manage signing (Apple certs/provisioning, Android keystore). Version the shell independently of web deploys.

---

## 5. Phase C — Hardening & UX for mobile

- Audit every page at 375px width; the app is already Tailwind/responsive but forms (`NewRequestForm`, `VideoApprovalPanel`, `DistributionReviewPanel`) and admin tables need touch-target and small-screen passes.
- Long-running pipeline polling (`PipelineStatusPoller`) should back off and respect app background state to save battery.
- Replace hover-only affordances with tap equivalents.
- Localization: UI is Thai-first — confirm store metadata and push copy in Thai + English.

---

## 6. Suggested sequencing

1. **PWA (Phase A)** — ~1 week. Ship first; immediate value, no store gatekeeping.
2. **Capacitor shell + auth/deep-link plumbing (B1–B3)** — ~1 week. Get a working signed build on a device.
3. **Native features + store compliance (B4–B5)** — ~1–2 weeks. Push + camera + share are the difference between approval and rejection.
4. **Release pipeline (B6)** and **mobile hardening (Phase C)** — ongoing.
5. **Optional deep Tvent→Travy identifier rename** — separate ticket, after the above is stable.

---

## 7. Key risks & mitigations

- **OAuth in WebView** → use system browser + deep-link return (B3). _Highest-priority integration risk._
- **Store rejection as thin wrapper** → ship real native features (B5).
- **Stale cached data offline** → network-first for `/api/*`, never cache auth-sensitive responses (A3).
- **Payment redirects breaking in-app** → deep-link the return leg, full round-trip test (B3).
- **Deep identifier rename touching live DB** → dedicated migration + backfill + rollback, done separately (Section 2).

---

## 8. New dependencies (summary)

- PWA: `@ducanh2912/next-pwa` (or manual Workbox); `sharp` (already present) for icon generation.
- Capacitor: `@capacitor/core`, `/cli`, `/ios`, `/android`, plus plugins `/push-notifications`, `/camera`, `/share`, `/browser`, `/status-bar`, `/splash-screen`, `/preferences`, `/network`, `/filesystem`.
