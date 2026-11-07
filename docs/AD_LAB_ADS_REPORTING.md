# Ad Lab — Ads Reporting Integration

Read-only integration that pulls TikTok Business API and Meta Graph API data into the Ad Lab Analyze section. The system **never** creates, updates, pauses, or deletes any ads or budgets.

---

## Architecture overview

```
AnalyzeWorkspace (UI)
  └── AdsReportingPanel (React; client component)
        ├── GET /api/ad-lab/ads-reporting/status
        ├── GET /api/ad-lab/ads-reporting/metrics
        └── POST /api/ad-lab/ads-reporting/sync

API routes (all behind requireAdLabUser — 404 for non-allowed users)
  ├── status/          – connection state per platform
  ├── tiktok/connect   – OAuth redirect to TikTok portal
  ├── tiktok/callback  – code exchange, store token
  ├── meta/connect     – OAuth redirect to Facebook
  ├── meta/callback    – code exchange (short→long-lived), store token
  ├── sync/            – manual refresh (POST)
  ├── cron-sync/       – daily sync (POST, Bearer-auth only)
  ├── metrics/         – filtered rows + analysis
  └── disconnect/      – local token removal only (POST)

Service layer (src/services/ad-lab/ads-reporting/)
  ├── readOnlyAdsFetch.ts   – HTTP guard (allowlist only)
  ├── tiktokAdsClient.ts    – TikTok Business API v1.3
  ├── metaAdsClient.ts      – Meta Graph API
  ├── tokenEncryption.ts    – AES-256-GCM for stored tokens
  ├── adsReportingModel.ts  – types, zod schemas, store helpers
  ├── adsReportingService.ts – OAuth flows + sync orchestration
  └── analysis.ts           – pure analysis functions
```

---

## Environment variables

See `.env.example` for placeholder values. **Never commit real secrets.**

| Variable | Purpose |
|---|---|
| `TIKTOK_BUSINESS_APP_ID` | TikTok Business Center app ID |
| `TIKTOK_BUSINESS_APP_SECRET` | TikTok Business Center app secret |
| `TIKTOK_BUSINESS_REDIRECT_URI` | OAuth callback URL for TikTok |
| `META_APP_ID` | Meta / Facebook app ID |
| `META_APP_SECRET` | Meta app secret |
| `META_REDIRECT_URI` | OAuth callback URL for Meta |
| `META_GRAPH_API_VERSION` | Graph API version (default `v25.0`) |
| `META_OAUTH_SCOPES` | OAuth scopes (default `ads_read`) |
| `META_SYSTEM_USER_TOKEN` | Optional: bypass OAuth with a system-user token |
| `META_AD_ACCOUNT_IDS` | Comma-separated act_* IDs for system-user mode |
| `ADS_REPORTING_ENCRYPTION_KEY` | 32-byte AES key (64-char hex or 44-char base64) |
| `ADS_REPORTING_CRON_SECRET` | Bearer token for the cron-sync endpoint |
| `ADS_REPORTING_SYNC_OWNER_IDS` | Comma-separated user IDs to sync on cron |

---

## Read-only HTTP guard

`readOnlyAdsFetch.ts` is the **only** fetch wrapper the clients may use. It validates every request before the network call is made and throws `AdsReadOnlyViolation` if the request is not in the allowlist.

**TikTok allowlist** (`business-api.tiktok.com`):
- `POST /open_api/v1.3/oauth2/access_token/` — token exchange only
- `GET /open_api/v1.3/oauth2/advertiser/get/` — list advertisers
- `GET /open_api/v1.3/report/integrated/get/` — integrated report

**Meta allowlist** (`graph.facebook.com`, GET only):
- `GET /{ver}/oauth/access_token`
- `GET /{ver}/me`
- `GET /{ver}/me/adaccounts`
- `GET /{ver}/act_{id}/insights`
- `GET /{ver}/debug_token`

Everything else — any non-GET to Meta, paths containing `create/update/delete/budget/pause`, or the `method=POST/DELETE` query param — throws before the request is sent.

---

## Normalized data model

Each row (`NormalizedAdMetricRow`) represents one entity (campaign/adset/ad) on one day from one platform. Key fields:

| Field | Notes |
|---|---|
| `platform` | `"tiktok"` or `"meta"` |
| `level` | `"campaign"`, `"adset"`, or `"ad"` (TikTok `adgroup` → `adset`) |
| `date` | `YYYY-MM-DD` |
| `spend` | Currency of the ad account |
| `videoViews6s` | Always `null` on Meta (not available) |
| `joinKey` | Dedup key: `${platform}:${accountId}:${level}:${campaignId}:${adsetId??"-"}:${adId??"-"}:${date}` |

When the platform API omits `ctr`/`cpc`/`cpm`, they are recomputed from raw impressions/clicks/spend. Divide-by-zero → `null`.

### Meta conversion action type priority

Conversions are derived from the `actions` array using this priority list (first match wins):
1. `offsite_conversion.fb_pixel_purchase`
2. `purchase`
3. `lead`
4. `onsite_conversion.messaging_conversation_started_7d`

### Future internal-conversion join

The `utm` field (currently unused) is reserved for joining with internal signal data (LINE signups, Stripe paid orders) via a future mapping table in the store:

```
UTM mapping: utm_campaign / utm_content  ←→  campaignId / adId + date
```

When populated, the analysis layer can attribute LINE/Stripe events to specific ads by matching `utm.campaign` to the stored mapping, then joining on `joinKey` date prefix. Document the mapping in the store's `adsReporting.connections` metadata when the feature is added.

---

## Storage

`adsReporting` is an **optional** field on `AdLabStore` (backed by `studio_workspaces.data` JSON). Old rows without it parse cleanly — it defaults to `undefined`.

- **Retention**: last 120 days; rows older than that are pruned on each merge.
- **Cap**: 50 000 rows total; oldest removed when exceeded.
- **Deduplication**: by `joinKey` — incoming row wins on conflict.

---

## Security

- **Tokens are never sent to the browser.** `GET /api/ad-lab/workspace` strips the entire `adsReporting` field (including `tokenEnc` and `oauthStates`) before responding. `PUT` ignores any client-sent `adsReporting` and restores the server-side value.
- Tokens are stored as **AES-256-GCM** ciphertext (`tokenEnc`). If `ADS_REPORTING_ENCRYPTION_KEY` is unset, the server refuses to store OAuth tokens and displays a Thai error message. Environment system-user tokens (`META_SYSTEM_USER_TOKEN`) are read directly from env and never persisted.
- OAuth state tokens expire after **10 minutes** and are consumed on use (removed from the store).
- The cron-sync endpoint uses **constant-time comparison** for the bearer secret to prevent timing attacks.
- All endpoints return **404** (not 401/403) for users outside the Ad Lab allowlist so the endpoint existence is not revealed.

---

## Daily sync

The `cron-sync` endpoint re-pulls the last **3 days** to catch late attribution (Meta and TikTok can update conversion counts 24-48h after the event).

### Scheduling options (documentation only — do NOT register via this file)

**Vercel Cron (vercel.json):**
```json
{
  "crons": [{
    "path": "/api/ad-lab/ads-reporting/cron-sync",
    "schedule": "0 2 * * *"
  }]
}
```
The Vercel cron must send `Authorization: Bearer $ADS_REPORTING_CRON_SECRET` — add a custom middleware or use a cron service that supports headers.

**curl (from any CI / Task Scheduler / cron daemon):**
```bash
curl -X POST https://your-domain.com/api/ad-lab/ads-reporting/cron-sync \
  -H "Authorization: Bearer $ADS_REPORTING_CRON_SECRET"
```

**Windows Task Scheduler (development):**
Create a Basic Task with the action: `powershell -NonInteractive -Command "Invoke-RestMethod -Uri 'http://localhost:3000/api/ad-lab/ads-reporting/cron-sync' -Method POST -Headers @{ Authorization = 'Bearer $env:ADS_REPORTING_CRON_SECRET' }"`

---

## Analysis functions

All functions in `analysis.ts` are **pure** (no side effects, no network, no writes):

| Function | Description |
|---|---|
| `rankByEfficiency(rows, level)` | Sort entities by cost-per-result (fallback CPC, then CPM) |
| `detectFatigue(rows, opts)` | Flag when CTR drops ≥20% while frequency rises ≥20% |
| `comparePlatforms(rows)` | Aggregate KPIs per platform with currency caveat |
| `budgetSuggestions(rows, level)` | Thai text suggestions **only** — system never acts |

All `budgetSuggestions` output is labelled:
> ข้อเสนอแนะเท่านั้น — ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ

---

## Limitations

- TikTok rate limit (code 40100 / HTTP 429): up to 5 retries with exponential backoff.
- Meta rate limits (codes 4, 17, 32, 613, 80000–80014): same retry strategy; `x-business-use-case-usage` `estimated_time_to_regain_access` is respected when present in the error body.
- Meta error 190 (token expired) is not retried — the user must reconnect.
- Meta does not provide 6-second video view counts (`videoViews6s` is always `null`).
- Currency comparison across accounts with different currencies is flagged with a warning in the UI but not blocked.
- The store persists in the same `studio_workspaces` JSON column as the rest of Ad Lab — no schema migrations required. Very large metrics volumes (>50k rows) are capped automatically.
