# RClipper Ad Lab (channel marketing)

Ad Lab is an owner-only web tool for creating advertising scripts, publishing
finished videos to added channels, and analysing how efficient each ad was.
It was developed as "Studio Lab" on `feature/studio-lab` and renamed so it
cannot be confused with the two other things in this codebase:

| Name | What it is | Where |
|---|---|---|
| **Ad Lab** (this) | Private channel-marketing tool | `/dashboard/ad-lab`, `/api/ad-lab/*` |
| Phone studio | The live mobile video pipeline ("New video") | `/studio`, `features/device-render` |
| Channel Management | Connected social accounts, posts, payments | `/dashboard/management/*` |
| Marketing site | Public pages for browsers (`BROWSER_MARKETING_ONLY`) | `features/marketing` |

Ad Lab does not consume credits, does not touch the phone pipeline, and does
not change any Capacitor / Android / iOS code.

## Code map

- Pages: `src/app/(auth)/dashboard/ad-lab/` (layout = the server-side gate)
- API: `src/app/api/ad-lab/{workspace,generate-script}`
- UI: `src/features/ad-lab/*`
- Logic: `src/services/ad-lab/*`, `src/lib/ai/adLabScriptService.ts` (OpenAI)
- Data: `src/domain/models/AdLab.ts`, `src/repositories/*AdLabWorkspaceRepository.ts`,
  migration `src/db/migrations/038_ad_lab_workspaces.sql` (table `studio_workspaces`)
- Gate: `src/config/adLab.ts`; dev-only login `src/lib/auth/adLabLocalCredentials.ts`
- Sync: `scripts/sync-ad-lab-workspaces.js` (`npm run adlab:sync`)

## Signing in

Use your **real RClipper account** (the cloud PostgreSQL `users` table), in
development as well as in production. Ad Lab data is keyed by your user id, and
publishing uses your real Channel Management social connections, so the
optional dev-only local login (`RCLIPPER_AD_LAB_LOCAL_AUTH_*`) is only good for
offline script writing: it cannot publish (refused with `local_account`), and
it is impossible to enable in production (`NODE_ENV=production`). When Ad Lab
is merged into main, the same real-account login is all there is.

## Real publishing and results (Phase 3)

- **Publishing tab → "4. เผยแพร่จริง"**: uploads the video straight to DO Spaces
  (`ad_lab/<userId>/…`, presigned PUT) and sends ONE Post for Me post to every
  selected account. Never retried. A caption is required (Post for Me rejects
  posts without one). The button opens a confirm dialog listing every
  destination; if paid promotion is planned it shows the real total and the
  owner must tick an acknowledgement before publishing.
- **Publishing tab is auto-saved**: one working plan per script plan
  (`publishingPlans`, debounced upsert into the workspace; the video file stays
  in the browser's IndexedDB). There is no "save plan" button.
- **Paid promotion is a PLAN, not a purchase.** Post for Me publishes organic
  posts only, and RClipper is not connected to any ad-buying API or payment for
  ads. Per channel the owner sets daily budget × days or a one-time total over
  N days; the per-account total becomes the target's `planned_budget`. The UI
  says plainly that nothing is charged and where to pay (TikTok Promote / Ads
  Manager, Meta boost / Ads Manager, Google Ads). Buying ads for the owner would
  need the TikTok Business / Meta Marketing / Google Ads APIs plus a payment
  flow — not built (`features/ad-lab/adLabPromotion.ts`).
- **Delete failed posts**: Analyze shows "ลบรายการ" on FAILED publications only
  (`DELETE /api/ad-lab/publications/:id`): removes the publication, its targets
  and snapshots (cascade) and the uploaded video in Spaces. Anything published
  or still processing is refused (409) — the record is the audit trail of a
  real post.
- **Analyze tab → "ผลจากโพสต์จริง"**: per post and per account — status, link,
  views, engagement, engagement rate, clicks; the owner types ad spend, revenue
  and customers (conversions); Ad Lab computes CPV, CPE, CPM, CPA and ROAS, a
  channel comparison (bars + table, best channel marked) and plain-language
  takeaways. "อัปเดตผลล่าสุด" re-reads status + metrics; every read is kept as
  a snapshot.
- Metrics come from Post for Me *social account feeds*, which need the account
  to be connected with the **"feeds"** permission. Ad Lab's connect dialog asks
  for it (`withAnalytics`, honoured only for Ad Lab users); accounts connected
  earlier from Channel Management must be reconnected once from Ad Lab.
  Instagram metrics can take up to 48 h; TikTok's consumer API reports only
  views/likes/comments/shares (TikTok Business reports reach, clicks, watch time).
- Data: migration `039_ad_lab_publications.sql` (`ad_lab_publications`,
  `ad_lab_publication_targets`, `ad_lab_metric_snapshots`). PostgreSQL only.
- Code: `services/ad-lab/AdLabPublishingService.ts`, `services/ad-lab/adLabInsights.ts`
  (pure normalisation + cost-effectiveness), `services/social-publishing/post-for-me/feeds.ts`,
  `app/api/ad-lab/{uploads,publications,targets}`, `features/ad-lab/PublishedResults.tsx`.
- Ad Lab posts carry `external_id = adlab_<id>`; the Management webhook ignores
  them, so no Management reconcile jobs are created.

## Who can see it

Visible only when BOTH are set, otherwise every page and API returns 404 and
the menu item is absent:

```env
RCLIPPER_AD_LAB_ENABLED=true
RCLIPPER_AD_LAB_ALLOWED_EMAILS=your-rclipper-login@example.com
```

Enforced in four places: the page layout (404), each API route (404), the
dashboard menu (link only for allowlisted users, never inside the store apps),
and the middleware (an allowlisted owner may open it in a browser even when
`BROWSER_MARKETING_ONLY=true`). The older `RCLIPPER_STUDIO_*` names still work.

Phase 4 widening (both off by default, master switch still required):
`RCLIPPER_AD_LAB_ALLOWED_EMAIL_DOMAINS` and `RCLIPPER_AD_LAB_ROLLOUT_PERCENT`
(stable per-user bucket). Pricing is not decided, so nothing charges credits.

The account must be a **Requester** (the lab lives under `/dashboard`). The
Publishing screen reuses Channel Management's connected accounts
(`/api/management/social-accounts`), so the same account must also pass the
Management allowlist to connect accounts there.

## Local development

```bash
npm run dev                       # http://localhost:3000/dashboard/ad-lab
npm run adlab:sync -- --dry-run   # list workspaces waiting to upload
npm run adlab:sync                # upload them to PostgreSQL
npm run adlab:sync -- --as-email=you@example.com   # store the local-login workspace under your real account
```

Progress is printed and appended to `logs/ad-lab-sync.log`.

Storage (`RCLIPPER_AD_LAB_STORE`):

- `hybrid` — default in development when PostgreSQL is configured. Every save
  goes to `data/studio.sqlite` first; nothing reaches PostgreSQL until
  `npm run adlab:sync`. Needs Node 22.5+.
- `sqlite` — default when PostgreSQL is not configured.
- `postgres` — default in production. Saves go straight to PostgreSQL; works
  on the droplet's Node 20.

Optional dev-only login (ignored when `NODE_ENV=production`):
`RCLIPPER_AD_LAB_LOCAL_AUTH_ENABLED`, `_LOCAL_EMAIL`, `_LOCAL_PASSWORD`. Its
workspace is stored under the id `studio-local-owner`; use `--as-email` when
syncing to move it onto your real account.

## Going live

Step-by-step commands: `docs/AD_LAB_GO_LIVE.md`. Summary:

1. Merge `feature/studio-lab` into `main` with the Ad Lab variables unset on
   the droplet. Normal users see nothing.
2. Apply `038_ad_lab_workspaces.sql` to the production database (additive and
   idempotent): `node scripts/apply-migration.js src/db/migrations/038_ad_lab_workspaces.sql`.
3. Deploy (`npm ci && npm run build && pm2 restart rclipper-web`) and check as a
   normal user: `/dashboard/ad-lab` → 404, no menu item, `/studio` unchanged.
4. On the droplet set `RCLIPPER_AD_LAB_ENABLED=true` and
   `RCLIPPER_AD_LAB_ALLOWED_EMAILS=<your email>`, then `pm2 restart rclipper-web`.
5. Rollback at any time: set `RCLIPPER_AD_LAB_ENABLED=false` and restart.

## Before widening beyond the owner

- Split the single JSON workspace into tables; add creative-version lineage.
- Rate-limit and cost-cap `generate-script`; add an audit log.
- Move UI strings into `src/i18n/messages`.
- Paid-ads spend/conversions straight from the ad platforms (today they are typed in).
- Decide whether it ever appears inside the store apps (store review).

## Boundaries

- Travy/TravyBuzz is not an Ad Lab channel.
- A production deploy of `main` reaches the WebView apps, so the server-side
  gate must stay in place.


## TikTok Ads Manager + Chinese_TTT outcomes (P1–P6)

Publishing keeps **Post for Me** for organic posts, then an **Advertise** panel
(TikTok) with Ads Manager-style targeting:

- Objectives (traffic, video views, reach, engagement, conversions, …)
- Locations, age, gender, languages
- Interests / behaviors / custom & lookalike audience IDs
- Devices / OS / connection
- Budget & schedule (existing plan fields)
- **Search keywords** (include / exclude; broad / phrase / exact)
- Spark Ads: reuse the organic `platform_post_id`
- UTM fields for light attribution to LINE / Stripe

Creating an ads structure from Analyze (`Create Ads draft (paused)`) calls
`POST /api/ad-lab/ads/draft`. With Marketing API credentials it creates
campaign / ad group / ad with `operation_status = DISABLE` (paused). Without
credentials it stores a **stub** link so the UI can be exercised. **RClipper
never enables spend and never charges for ads.**

### Analyze additions

- Planned vs actual spend % on each target
- CSV / paste import from Ads Manager (`POST /api/ad-lab/ads/import`)
- Optional report sync (`POST /api/ad-lab/ads/sync`) when an `ads_ad_id` exists
- **LINE OA friend count** snapshots (`/api/ad-lab/outcomes/line`) — stub without token
- **Stripe received payments** read-only (`/api/ad-lab/outcomes/stripe`) — stub without key;
  filters PaymentIntents by metadata (default `product=chinese_ttt`)

### Migration 040 (additive — apply when ready)

```bash
node scripts/apply-migration.js src/db/migrations/040_ad_lab_ads_outcomes.sql
```

Adds ads_* columns on `ad_lab_publication_targets` plus
`ad_lab_line_friend_snapshots`, `ad_lab_stripe_revenue_snapshots`,
`ad_lab_ads_imports`. The publication repository detects missing ads columns
and keeps working for organic publish until 040 is applied; ads link writes
then require the migration.

### Env vars (optional — missing ⇒ stub)

```env
# TikTok Marketing API (Ads Manager) — draft/reporting only
TIKTOK_MARKETING_ACCESS_TOKEN=
TIKTOK_MARKETING_ADVERTISER_ID=
TIKTOK_MARKETING_APP_ID=
TIKTOK_MARKETING_APP_SECRET=
# TIKTOK_MARKETING_API_BASE=https://business-api.tiktok.com/open_api/v1.3

# LINE Official Account (Chinese_TTT friend count)
AD_LAB_LINE_OA_CHANNEL_ACCESS_TOKEN=
# AD_LAB_LINE_OA_BOT_USER_ID=

# Stripe revenue (read-only; never creates charges from Ad Lab)
AD_LAB_STRIPE_SECRET_KEY=
AD_LAB_STRIPE_METADATA_KEY=product
AD_LAB_STRIPE_METADATA_VALUE=chinese_ttt
```

### Open decisions for Tho

1. Separate LINE OA token for Chinese_TTT friend insights
2. Stripe metadata tagging for Chinese_TTT payments (`product=chinese_ttt`)
3. TikTok Marketing API OAuth / advertiser id in Business Center
4. Apply migration 040 on cloud Postgres when ready
5. Whether live Marketing API create is wanted beyond stub + CSV for week 1

### Code map (ads / outcomes)

- Targeting model: `src/domain/models/AdLabAdTargeting.ts`
- UI: `AdTargetingPanel.tsx`, `AdsImportPanel.tsx`, `ChineseTttOutcomesPanel.tsx`
- Services: `tiktokMarketingClient.ts`, `lineOfficialAccountClient.ts`,
  `stripeRevenueClient.ts`, `AdLabAdsService.ts`, `AdLabOutcomesService.ts`,
  `adLabCsvImport.ts`
- API: `/api/ad-lab/ads/{draft,sync,import}`, `/api/ad-lab/outcomes/{line,stripe}`
- Migration: `040_ad_lab_ads_outcomes.sql`
