# RClipper Studio Lab

Studio Lab is an owner-only web module for learning which advertising-video
choices produce business results. It is isolated from the released mobile app,
the existing request pipeline, credits, billing, and Channel Management.

## Safe local activation

Add these values to this worktree's `.env.local` (do not commit the file):

```env
RCLIPPER_STUDIO_ENABLED=true
RCLIPPER_STUDIO_ALLOWED_EMAILS=your-rclipper-login@example.com
```

Then run `npm run dev` and open `/dashboard/studio`. Both the master switch and
an exact email or user-id allowlist match are required. With no configuration,
the module returns a 404 and its navigation item is absent.

## Current MVP

- **Brands** — a deliberately small brand brief: product, audience, promise,
  and tone.
- **Create** — brand selection at the top, campaign objective, detailed
  hook/problem/solution/proof/CTA script, channel plan for TikTok, Instagram,
  Facebook, and YouTube, and draft saving.
- **Analyze** — manual campaign-result entry, normalized Hook rate, Completion,
  CTR, CVR, and ROAS, plus first-pass creative diagnostics.

Studio records use offline-first persistence. Every change is written to the
local `data/studio.sqlite` database before the server attempts PostgreSQL. If
the cloud database is unreachable, that local row remains marked as pending and
can be uploaded explicitly with `npm run studio:sync` after connectivity
returns. The command logs progress to the terminal and `logs/studio-sync.log`.
A browser copy under `rclipper-studio-lab-v1` is retained only as a last-resort
recovery layer.

## Promotion path

1. Validate the three-screen workflow locally with real RClipper campaign data.
2. Continue validating the SQLite-to-PostgreSQL synchronization policy with
   real multi-device usage before enabling collaborative editing.
3. Add read-only test-account connectors for TikTok, Meta, and YouTube. Store
   raw provider responses and normalize them into the common funnel model.
4. Add test-account publishing, idempotency, approval confirmation, audit logs,
   and per-platform failure handling. Keep production publishing disabled.
5. Replace fixed diagnostic thresholds with benchmarks from comparable channel,
   objective, duration, and audience cohorts. Add creative-version lineage so a
   result can be traced back to its exact hook/script/video.
6. Run regression, privacy, OAuth-scope, and mobile compatibility tests. Merge
   the module behind the same server-side gate, initially allowlisted to the
   owner only; widen access only after production observation.

## Explicit boundaries

- Travy/TravyBuzz is not a Studio channel.
- Studio does not change Capacitor, Android, iOS, App Store, or Play Store code.
- Studio does not consume credits or touch the existing AI video pipeline.
- A normal RClipper production deploy can still affect the WebView mobile app;
  therefore the server-side gate must remain in place after merge.
