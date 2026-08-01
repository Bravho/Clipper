# Handoff — debug Post for Me "Project Id or Provider not found" on Facebook connect

Paste the prompt below into a new session to continue.

---

**PROMPT TO PASTE:**

Continue RClipper Management work in `D:\coding\clipper_agent` (Next.js 14 App
Router, TypeScript, PostgreSQL via `pg`, NextAuth v4). Hold the project's LOCKED
INVARIANTS and ask before changing any: collecting free / publishing paid via
tokens; uploads free (4 kept / 7 days / 300 MB); entitlement consumed at
publication CREATE; signed media URLs minted at send time; provider `createPost`
never retried; webhook body never trusted (reconcile re-fetches); connect scopes
are `posts` only. Do NOT change `POST_FOR_ME_PROJECT_TYPE`, the connect scopes,
or the provider boundary without asking.

GOAL: fix social-channel connection from the RClipper Management "ตั้งค่าช่องทาง"
(Channel settings) page, and get all four enabled channels connecting: Facebook,
Instagram, YouTube, TikTok.

SYMPTOM: Starting a Facebook connection from RClipper Management redirects
correctly to the Post for Me OAuth screen, I log in and pick my Page, and then
the Post for Me callback page (`app.postforme.dev/callback/facebook/account?code=…`)
shows:

    Post for Me — Connection Failed
    Unknown
    Error: Project Id or Provider not found
    Don't worry, you can try connecting your account again.

So the failure happens ON POST FOR ME's side during the OAuth exchange, before
control returns to RClipper's own `/api/management/social-accounts/callback`.

WHAT I ALREADY DID:
- Switched the app from Post for Me WHITE-LABEL to QUICKSTART credentials.
  `.env.local` now has (canonical names the app reads):
  `POST_FOR_ME_API_KEY` = the quickstart `pfm_live_…` key,
  `POST_FOR_ME_WEBHOOK_SECRET` = a `whsec_…` secret created via
  `POST /v1/webhooks`, `POST_FOR_ME_PROJECT_TYPE=quickstart`,
  `POST_FOR_ME_BASE_URL=https://api.postforme.dev`. The old white-label pair is
  parked under `POST_FOR_ME_WHITE_LABEL_*` (not read by the app).
- On the Post for Me website I "set up connections" for YouTube, Facebook,
  Instagram and TikTok for the RClipper channel — but I am NOT sure which Post
  for Me PROJECT (quickstart vs white-label) those provider configurations live
  under, and that is the prime suspect.
- Registered a production webhook pointing at
  `https://rclipper.com/api/management/postwebhooks`.

LEADING HYPOTHESIS (verify, don't assume): "Project Id or Provider not found"
means the `code` from Facebook is being exchanged against a Post for Me project
that has no Facebook provider configured. The likely cause is a MISMATCH between
the API key the app is using (`POST_FOR_ME_API_KEY`, quickstart) and the project
where the Facebook/IG/YouTube/TikTok providers were actually configured
(possibly the white-label project). On QUICKSTART, provider apps are supplied by
Post for Me but the desired platforms may still need to be ENABLED on the
project; on WHITE-LABEL, each provider (Meta app id/secret, Google app, TikTok
app) must be configured by us. These providers must exist on the SAME project as
the key in `POST_FOR_ME_API_KEY`.

PLEASE DO, IN ORDER:
1. Confirm the code path and which env vars are read: `src/config/management.ts`
   (`POST_FOR_ME_CONFIG`, `projectType`), `src/services/social-publishing/
   post-for-me/accounts.ts` (`createAuthUrl` → `POST /v1/social-accounts/auth-url`
   with `permissions: ["posts"]`; note white-label-only `redirect_url_override`),
   `src/services/management/ManagementConnectionService.ts` (`start` /
   `completeCallback`), `src/app/api/management/social-accounts/route.ts` and
   `.../callback/route.ts`, and `src/config/management.ts`
   `managementConnectablePlatforms()`.
2. Identify which Post for Me PROJECT the quickstart key belongs to and whether
   Facebook (and IG/YouTube/TikTok) providers are enabled on THAT project. Use
   read-only API probes with the quickstart key against
   `https://api.postforme.dev`: `GET /v1/social-accounts?external_id=<a test user
   id>`, and any project/provider/config listing endpoints the current API
   exposes (check the live API reference at api.postforme.dev / docs, since the
   dashboard has no Webhooks or provider UI I can see). Report the actual
   response shapes — do not guess.
3. Determine whether the failure is (a) provider not enabled on the quickstart
   project, (b) key/project mismatch, (c) the platforms weren't configured on the
   quickstart project at all (they were done on white-label), or (d) something in
   our auth-url request (wrong `platform` value from `toProviderPlatform`, missing
   field). Inspect `toProviderPlatform` for the exact provider platform string
   Post for Me expects for Facebook.
4. Also check `POST_FOR_ME_ENVIRONMENT` (currently `development`) vs a
   `pfm_live_` key — confirm whether that field is used in any request or matters
   to project resolution.
5. Propose the fix. If it is purely Post for Me dashboard/project configuration
   (enable Facebook provider on the quickstart project, or move the app to the
   project that has the providers), give me exact click/curl steps — do not
   change code for that. If a code change is genuinely required, explain why,
   keep the locked invariants, and show a minimal diff.
6. After Facebook works, verify the same for Instagram, YouTube, and TikTok, and
   note any platform-specific gotchas (IG needs a Business/Creator account linked
   to the Page; TikTok privacy/disclosure; YouTube channel/Brand-Account picker).

CONSTRAINTS ON VERIFICATION: the repo mount is too slow for tsc/jest/next in the
sandbox — use the `/tmp/v2` recipe for unit checks and `npm run build` as the
gate for React/Next files. Never print full secret values; the `pfm_live_` keys
were already exposed in an earlier chat and should be rotated. Reference doc:
`docs/MANAGEMENT_CHANNEL_SETUP.md`.

---

**Quick context notes (for the human, not part of the prompt):**

- The screenshot URL was `app.postforme.dev/callback/facebook/account?code=AQLRG-…`
  → the error is on Post for Me, before RClipper's callback runs.
- Most probable root cause: the four provider setups were done on a different
  Post for Me project than the quickstart key now in `POST_FOR_ME_API_KEY`, so
  that project has no Facebook provider to resolve the OAuth `code` against.
- Fastest thing to check first: in the Post for Me dashboard, switch to the
  project that owns the quickstart `pfm_live_…` key and confirm Facebook (and the
  other three) are enabled/configured there — not on the white-label project.
