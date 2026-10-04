# Ad Lab — go-live runbook

Ad Lab ships **inside** the normal RClipper app and stays invisible until the
droplet's environment turns it on for named accounts. Every step below can be
undone with one environment change (see Rollback).

Folders: `D:\coding\rclipper_studio_lab` = branch `feature/studio-lab`
(development). `D:\coding\clipper_agent` = branch `main` (what the droplet runs).

## Phase 0 — finish in development (done)

```powershell
cd D:\coding\rclipper_studio_lab
npm install
node scripts/apply-migration.js src/db/migrations/038_ad_lab_workspaces.sql
node scripts/apply-migration.js src/db/migrations/039_ad_lab_publications.sql
npm run dev            # http://localhost:3000/dashboard/ad-lab
```

Sign in with your real RClipper account (it must be in
`RCLIPPER_AD_LAB_ALLOWED_EMAILS` and, to connect channels, in the Channel
Management allowlist). In the Publishing tab press **+ เชื่อมต่อบัญชี** and
reconnect each channel once so it grants analytics ("feeds").

Both migrations are additive and idempotent. If `.env.local` points at the
production database, running them here is the same as Phase 1 step 3.

## Phase 1 — hidden merge into main

1. Push the branch and merge it into main (main fast-forwards, so either works):

   ```powershell
   cd D:\coding\rclipper_studio_lab
   git push origin feature/studio-lab
   # Option A — pull request (recommended, leaves a record):
   #   https://github.com/Bravho/Clipper/compare/main...feature/studio-lab
   # Option B — direct:
   git push origin feature/studio-lab:main
   ```

2. Update the main folder:

   ```powershell
   cd D:\coding\clipper_agent
   git checkout main
   git pull --ff-only origin main
   npm install
   ```

3. Production database (once):

   ```bash
   node scripts/apply-migration.js src/db/migrations/038_ad_lab_workspaces.sql
   node scripts/apply-migration.js src/db/migrations/039_ad_lab_publications.sql
   ```

4. Deploy on the droplet with the Ad Lab variables **absent** (or
   `RCLIPPER_AD_LAB_ENABLED=false`):

   ```bash
   cd ~/Clipper && git pull --ff-only
   npm ci && npm run build && pm2 restart rclipper-web
   ```

5. Check as a normal user (browser and app): `/dashboard/ad-lab` → 404, no
   "Ad Lab" in the menu, `/studio` ("New video") unchanged. No app-store
   rebuild is needed — the apps load the server.

## Phase 2 — owner only, in production

On the droplet, add to `~/Clipper/.env.local`:

```env
RCLIPPER_AD_LAB_ENABLED=true
RCLIPPER_AD_LAB_ALLOWED_EMAILS=<your RClipper login email>
# RCLIPPER_AD_LAB_STORE defaults to postgres in production
```

```bash
pm2 restart rclipper-web
```

Carry over anything you saved in development's local SQLite:

```powershell
cd D:\coding\rclipper_studio_lab
npm run adlab:sync -- --dry-run
npm run adlab:sync -- --as-email=<your RClipper login email>
Get-Content logs\ad-lab-sync.log -Tail 50
```

Then open `https://rclipper.com/dashboard/ad-lab`, reconnect channels for
analytics, publish one real campaign, and press **อัปเดตผลล่าสุด** after a few
hours.

## Phase 3 — beta (a few businesses)

Add their emails (or their company domain) on the droplet and restart:

```env
RCLIPPER_AD_LAB_ALLOWED_EMAILS=you@example.com,owner@restaurant.co.th
RCLIPPER_AD_LAB_ALLOWED_EMAIL_DOMAINS=restaurant.co.th
```

Each beta user must also be allowed into Channel Management
(`RCLIPPER_MANAGEMENT_ALLOWED_EMAILS`), because Ad Lab reuses its account
connections. Publishing from Ad Lab is free during the beta.

## Phase 4 — public

Pricing is not decided. When it is, widen with a percentage first:

```env
RCLIPPER_AD_LAB_ROLLOUT_PERCENT=10   # then 25, 50, 100
```

A user's bucket is stable, so the same people stay in as the number grows.
Before 100 %: decide pricing (plan-included or credits per script/publish),
move UI text into `src/i18n/messages`, add a cost cap on AI script generation,
and decide whether Ad Lab appears inside the store apps (store review).

## Rollback (any phase)

```env
RCLIPPER_AD_LAB_ENABLED=false
```

```bash
pm2 restart rclipper-web
```

The tables stay; nothing else in the app depends on them.
