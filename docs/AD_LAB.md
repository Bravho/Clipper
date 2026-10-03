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

## Going live (owner only)

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

- Store publishing videos in DO Spaces instead of the browser (IndexedDB).
- Split the single JSON workspace into tables; add creative-version lineage.
- Rate-limit and cost-cap `generate-script`; add an audit log.
- Move UI strings into `src/i18n/messages`.
- Read-only platform insight connectors (TikTok, Meta, YouTube) for Analyze.
- Decide whether it ever appears inside the store apps (store review).

## Boundaries

- Travy/TravyBuzz is not an Ad Lab channel.
- A production deploy of `main` reaches the WebView apps, so the server-side
  gate must stay in place.
