# Connecting Social Channels — Business Setup Guide (RClipper Management)

How a business connects each social channel to RClipper and what each platform
requires before a video can actually be published. Covers the four channels
currently enabled for connecting: **Facebook, Instagram, YouTube, TikTok**
(`managementConnectablePlatforms()` in `src/config/management.ts`).

Publishing runs through the **Post for Me** provider. RClipper is configured in
**Quickstart** mode (`POST_FOR_ME_PROJECT_TYPE` defaults to `quickstart`), which
matters a lot for setup:

- **The business never creates a developer app.** The OAuth screen the business
  sees is **Post for Me's** already app-reviewed app, so there is no Meta app,
  Google Cloud project, or TikTok app for the business to register, and no app
  review for the business to pass.
- The business only needs the **right kind of account on each platform** (a
  Facebook Page, an Instagram Business/Creator account, a YouTube channel, a
  TikTok account) and to click through the connect flow.
- If RClipper ever switches to **White Label** mode, the developer-app and
  app-review burden falls on **RClipper**, not the business. See the last
  section. Either way, the business-side account requirements below are the same.

Connecting is **free**. Money is only required at publish time.

---

## The connect flow (identical for all four channels)

This is the same in-app flow for every platform; only the platform-side
prerequisites differ.

1. Sign in and go to **Dashboard → ตั้งค่าช่องทาง (Channel settings)**
   (`/dashboard/management/connections`).
2. In the "add account" grid, click the channel you want (Facebook, Instagram,
   YouTube, or TikTok). The grid only shows enabled platforms.
3. RClipper calls `POST /api/management/social-accounts`, which asks Post for Me
   for a one-time authorization URL (`POST /v1/social-accounts/auth-url`,
   permission scope **`posts`** only — no read access to past content) and
   redirects the browser to it.
4. On the provider-hosted OAuth screen, **log in to the platform** and **grant
   permission**. Choose the correct Page / account / channel when the platform
   asks (see per-platform notes).
5. The platform redirects back to
   `/api/management/social-accounts/callback`. RClipper re-fetches every claimed
   account from the provider and verifies it belongs to the signed-in user
   before saving anything — nothing in the redirect URL is trusted.
6. The account now shows as **connected** on the Channel settings page and
   becomes selectable in the publish composer.

Notes that apply to all channels:

- Each connect attempt generates a **fresh URL**; don't bookmark or reuse it.
- A cancelled or failed authorization returns you to Channel settings with a
  status message — no account is added.
- Reconnecting: if a platform expires the grant, repeat the same steps to
  refresh it.

---

## Facebook

**What the business needs**

- A **Facebook Page** (not just a personal profile). Video is published to a
  **Page**, so the business must own or be an admin of at least one Page.
- During the OAuth step, the business must **grant access to that specific
  Page**. If they manage several Pages, make sure the intended Page is ticked —
  Meta lets users deselect Pages on the consent screen.
- The connecting user needs a Page role with permission to create content
  (admin / content or full control).

**App review / verification:** none for the business (Quickstart uses Post for
Me's reviewed Meta app).

**Video constraints in RClipper:** accepts **16:9 (default), 9:16, 1:1, 4:5** —
the most permissive of the four. Facebook itself allows roughly up to ~90 minutes
and large file sizes, so RClipper's own **300 MB** self-upload cap is the
effective limit for uploaded files; transferred generations are already within
range.

---

## Instagram

Instagram is the most prerequisite-heavy channel.

**What the business needs**

- An Instagram account set to **Business** or **Creator** — a **personal**
  Instagram account cannot be used to publish via any API.
- The Instagram account should be **linked to a Facebook Page**. The reliable
  connect path runs through Meta's Page-based permissions, so the business
  should: convert the IG account to Business/Creator, then in the Instagram app
  or Meta Business settings **link it to the Facebook Page** used above.
- During OAuth, grant access to **both** the Facebook Page and the linked
  Instagram account.

**App review / verification:** none for the business under Quickstart.

**Publishing quirks to set expectations:**

- Instagram publishes as a **Reel / feed video**, not a Story, through this flow.
- Instagram is stricter than Facebook about shape and length; keep videos to
  vertical/square.

**Video constraints in RClipper:** accepts **9:16 (default), 4:5, 1:1** — no
pure landscape. Practical platform guidance: Reels up to ~90 seconds are safest,
vertical 9:16 preferred. RClipper's **300 MB** upload cap applies to self-uploads.

---

## YouTube

**What the business needs**

- A **Google account with a YouTube channel**. If the account has never created
  a channel, create one first (YouTube → "Create a channel").
- During OAuth, sign in with the Google account and, if prompted with a **"Brand
  Account" / channel picker**, select the channel you want to publish to.
- The channel must be **in good standing** (no active upload restrictions).

**Scopes:** RClipper requests only publishing permission (`posts`). The business
grants YouTube upload access on the Google consent screen. Google may show an
"unverified app" style notice depending on the provider app's status — that is
about **Post for Me's** app, not something the business configures.

**App review / verification:** none for the business under Quickstart.

**Video constraints in RClipper:** accepts **16:9 (default), 9:16** — landscape
for the main feed, vertical for Shorts. Anything **9:16 and ≤60 seconds**
publishes as a **Short**. YouTube allows large uploads, so RClipper's **300 MB**
self-upload cap is the effective limit for uploaded files.

---

## TikTok

**What the business needs**

- A TikTok account the business controls (a standard account works; TikTok
  Business is **not** required and is not currently enabled here).
- During OAuth, log in and approve **content posting** permission.
- TikTok requires a **privacy level** on every post (public / friends /
  private); the composer/provider surfaces this. Also be ready to set the
  **commercial-content / branded-content disclosure** if the video promotes a
  product or brand.

**App review / verification:** none for the business under Quickstart — Post for
Me's TikTok app is already audited, so posts can go **public** immediately. (This
is the one to watch if RClipper ever white-labels: an **unaudited** own app can
only post **private/self-only** until TikTok approves it, a 2–6 week review.)

**Video constraints in RClipper:** accepts **9:16 only** — vertical. TikTok
rejects landscape. Keep within TikTok's per-post limits; RClipper's **300 MB**
self-upload cap covers typical short-form clips.

---

## Aspect-ratio summary (authoritative — from `managementPublishing.ts`)

The first ratio listed is the default the composer pre-selects. A self-upload's
shape must match the target channel; transferred generations already carry all
four exports and are matched automatically.

| Channel   | Accepted ratios                | Default |
|-----------|--------------------------------|---------|
| Facebook  | 16:9, 9:16, 1:1, 4:5           | 16:9    |
| Instagram | 9:16, 4:5, 1:1                 | 9:16    |
| YouTube   | 16:9, 9:16                     | 16:9    |
| TikTok    | 9:16                           | 9:16    |

Length and file-size limits above are **platform-imposed and change over time**;
treat them as guidance, not contract. RClipper's own hard limit is the
**300 MB / 7-day / max-4-kept** cap on free self-uploads
(`ManagementUploadService`). Length and codec problems surface as publish errors
mapped in `src/services/social-publishing/errors.ts`.

---

## If RClipper switches to White Label (`POST_FOR_ME_PROJECT_TYPE=white_label`)

Nothing changes for the **business** — same account requirements, same connect
clicks — but the OAuth screen would show **RClipper's** app name, which means
**RClipper** (not the business) must maintain:

- A **Meta app** with a Business verification and the relevant permissions
  reviewed (Pages + Instagram content publishing).
- A **Google Cloud project / YouTube app** with the upload scope, verified and
  through Google's OAuth verification.
- A **TikTok app** with the Content Posting API product added and **audited** for
  public posting.

This is a provider/config decision, not part of business onboarding. It is also
a **locked invariant area** (provider boundary, entitlement, media URL timing) —
confirm before changing `POST_FOR_ME_PROJECT_TYPE` or the connect scopes.

---

### Sources

- [Post for Me — Unified Social Media Posting API](https://www.postforme.dev/)
- [Post for Me — Start building integrations with TikTok, Instagram, YouTube, Facebook](https://www.postforme.dev/blog/start-building-integrations-with-tiktok-instagram-youtube-facebook-and-more)
- [TikTok Content Posting API: Requirements & Setup (2026)](https://www.netrows.com/blog/tiktok-content-posting-api-guide-2026)
- Codebase: `src/config/management.ts`, `src/config/managementPublishing.ts`, `src/services/social-publishing/post-for-me/accounts.ts`, `src/app/api/management/social-accounts/*`
