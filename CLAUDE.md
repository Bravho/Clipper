# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build
npm run lint         # ESLint via next lint
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report

# Run a single test file
npm test -- tests/services/ClipRequestService.test.ts
```

**Config gotchas:** Use `next.config.js` (not `.ts` — unsupported in Next 14). Use `jest.config.js` (not `.ts` — requires ts-node).

## Architecture

**Stack:** Next.js 14 App Router, TypeScript, Tailwind, NextAuth v4, Zod, react-hook-form, PostgreSQL (via `pg`).

### Layer structure

```
domain/           → Pure TypeScript types: models/ and enums/
repositories/     → Data access: interfaces/, mock/, postgres/
  index.ts        → Single registry — all services import repos from here only
services/         → Business logic (no HTTP, no React)
  staff/          → Staff-specific services
  admin/          → Admin-specific services
app/              → Next.js App Router pages and API routes
  (public)/       → Unauthenticated pages
  (auth)/         → Protected pages, role-gated
  api/            → REST endpoints (NextAuth, register, requests, uploads, staff/*, admin/*)
features/         → UI component clusters grouped by domain (auth/, requests/, staff/, admin/)
components/       → Shared primitives: ui/ and layout/
lib/              → Infrastructure: auth/, db.ts, email.ts, spaces.ts, ai/*, social/*
config/           → Constants: credits.ts, policyVersions.ts, routes.ts, aiTools.ts
seed/             → In-memory mock seed data loaded on first access
```

### Repository swap point

`src/repositories/index.ts` is the **only** file that imports repository implementations. To swap from Mock to PostgreSQL, change the import there — services and pages do not change.

**Current persistence state:**
- Phase 2A (auth, credits, users): PostgreSQL (`src/repositories/postgres/`)
- Phase 2B+ (clip requests, assets, publishing, notes, pipeline jobs): in-memory Mock (`src/repositories/mock/`), backed by `globalThis` singletons

### Route protection

`src/middleware.ts` wraps all `(auth)` routes with NextAuth `withAuth`. Role routing:
- `/dashboard` → `Requester` only
- `/staff` → `Editor` or `Admin`
- `/admin` → `Admin` only
- `/account` → any authenticated role

Role home paths are defined in `src/config/routes.ts` → `getRoleHomePath()`.

JWT session contains: `id`, `email`, `name`, `role`, `provider`. Server components use `src/lib/auth/helpers.ts` → `requireAuth()`, `requireRole()`, `getCurrentUser()`.

**Mobile sign-in is native, not a browser redirect.** Chrome Custom Tabs and
SFSafariViewController do not share a cookie jar with the Capacitor WebView, so
the redirect flow signs the user in *in the browser* and leaves the app signed
out. The apps use Android Credential Manager / iOS ASAuthorizationController and
exchange the resulting ID token through the `google-native` / `apple-native`
Credentials providers. Sign-out must go through `signOutEverywhere()` — plain
`signOut()` leaves the native credential cached. See `docs/NATIVE_SIGN_IN.md`.

**Push notifications fire at gates, not at step completions.** A pipeline step
finishing is not news — the next step starts by itself. What the requester needs
is a nudge when the pipeline STOPS and waits for them, so only `awaiting_*`
steps (plus `failed`/`complete`) have an entry in `NOTICES`. On an express-lane
job (`auto_approve_remaining`) the later gates clear themselves within seconds,
so those notices are suppressed and the requester gets exactly one notification,
at the final step. The rule is `shouldSuppressPipelineNotice()` in
`src/config/push.ts`, derived from the UI's `isAutoApprovedGate()` so the two
cannot drift. Delivery is FCM v1 / APNs over HTTP/2 / Web Push VAPID from
`PushNotificationService`, deduped by a unique `(job_id, event_key)`. Setup and
store-console steps: `docs/PUSH_NOTIFICATIONS_SETUP.md`.

### AI video pipeline

Staff triggers the pipeline on a `ClipRequest`. The pipeline is orchestrated by `VideoGenerationService` and tracked on a `VideoGenerationJob` record.

**5-step pipeline** (each async AI step followed by a staff approval gate):
1. **ChatGPT/Gemini Vision** → scene plan + Thai/English/Chinese scripts (`AnalyzingContent` → `AwaitingContentApproval`)
2. **Google Veo 3.1 Lite** image-to-video → one clip per approved scene (scene script + its images + its duration), auto-merged with FFmpeg into a single base video (`GeneratingBaseVideo` → `AwaitingVideoApproval`)
3. **Staff voice recording** → ElevenLabs Speech-to-Speech conversion (`AwaitingVoiceRecording` → `ProcessingVoice` → `AwaitingVoiceApproval`)
4. **FFmpeg** composition → subtitles + 4-ratio exports (9:16, 16:9, 1:1, 4:5) (`ComposingFinalVideo` → `AwaitingFinalApproval`)
5. **Social publishing** → TikTok, Facebook, Instagram, YouTube, Travy (`Publishing` → `Complete`)

Polling steps (`POLLING_STEPS`) require the status endpoint to poll the AI provider until completion. Pipeline failures record `failedAtStep` so `retryPipeline()` can resume from the failed step only.

### Credit system

- 30 credits granted on signup via `CreditService.initialiseRequesterWallet()` (guarded by `initialCreditsGranted` flag)
- 10 credits per request submission (`REQUEST_COST_CREDITS`)
- All credit events are immutable `CreditTransaction` records; `referenceId` links to `clip_requests.id`
- Staff and Admin accounts have no credit wallet

### Request status lifecycle

`Draft → Submitted → UnderReview → AcceptedForProduction → Editing → ScheduledForPublishing → Published → Delivered`

Divergent paths: `OnHold` (paused), `Rejected` (terminal). No `InternalQA` status.

## Testing

Tests live in `tests/` and mirror the `services/` structure. Each test instantiates **fresh Mock repositories** (passing a `new Map()` directly to the constructor) — never the global singleton instances from `src/repositories/index.ts`.

```typescript
// Pattern used in all service tests
const userRepo = new MockUserRepository(new Map());
const service = new AccountService(userRepo, ...);
```

## Environment variables

Five groups defined in `.env.example`:
- **Auth:** `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`; native mobile sign-in adds `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `APPLE_NATIVE_CLIENT_ID` (see `docs/NATIVE_SIGN_IN.md`)
- **Email:** `SMTP_*`, `EMAIL_FROM`
- **Storage:** `DO_SPACES_KEY/SECRET/ENDPOINT/BUCKET/REGION`
- **Database:** `PGHOST`, `PGDATABASE`, `PGPORT`, `PG_USER`, `PG_PASSWORD`
- **AI pipeline:** `GEMINI_API_KEY`, `VEO_API_KEY/MODEL_NAME/RESOLUTION/DURATION/ASPECT_RATIO` (Veo reuses `GEMINI_API_KEY` if `VEO_API_KEY` is unset), `ELEVENLABS_API_KEY/DEFAULT_VOICE_ID`, `FFMPEG_PATH`, `FFMPEG_TMP_DIR`
- **Social publishing:** `YOUTUBE_*`, `TIKTOK_*`, `INSTAGRAM_*`, `FACEBOOK_*`, `TRAVY_*`

All AI/social keys are read through `src/config/aiTools.ts` (`AI_CONFIG`).

## Seed accounts (development)

| Role | Email | Password |
|------|-------|----------|
| Requester | user@example.com | password123 |
| Editor (Staff) | staff@clipper.internal | staffpass123 |
| Admin | admin@clipper.internal | adminpass123 |

Seed data loads automatically from `src/seed/mockData.ts` on first access via `globalThis` singleton init.
