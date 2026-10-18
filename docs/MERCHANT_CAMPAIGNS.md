# Merchant Referral Campaigns (Oct 2026)

A shop's QR opens RClipper with no login. The customer shoots one clip and the
**phone** renders a branded video ending with "Friends get 5% off · CODE A7K4".
They post it themselves, then show the post to staff and get a small gift.
Friends redeem the code later in iTravy / TravyBuzz, which reads it from
RClipper.

The server only stores small data: shops, templates, campaigns, anonymous
creators, referral codes, reward claims and optional post links. **No video is
uploaded, and nothing renders on the server.**

## Customer flow (app, no login)

1. Menu → **Scan shop QR** (`/scan`). This is a web page in the app:
   `getUserMedia` for the camera, `BarcodeDetector` on Android, jsQR on iOS,
   and "take a photo of the QR" as a fallback. No native plugin, no new build.
2. The QR holds `https://app.rclipper.com/c/<slug>?k=<qr key>`. Without the
   right `k`, every API call is refused, so the page only works from the QR. A
   web browser gets "open in the RClipper app".
3. `POST /api/campaigns/:slug/session` creates or finds the anonymous creator
   and issues its referral code.
   - The app makes a random UUID once and keeps it in Capacitor Preferences.
   - The server stores only `sha256(pepper | uuid)`.
   - IMEI, serial number, MAC address and advertising ID are never used.
4. **Shoot**: one clip of 3–15 s (longer clips use their first 15 s).
   **Words**: the default sentence, which the customer can edit.
   **Sound**: the clip's own sound, or any track from the studio's Sound
   catalogue. The template sets the default.
5. **Create**: `POST …/manifest` returns an ordinary v4 manifest. The phone
   renders it with the existing `renderManifest`, keeps the result in the
   finished-video cache, and reports `POST …/video-made` (a counter only).
6. **Share** (native share sheet) / **Save video** (Photos or
   Movies/RClipper).
7. Optional: paste the post link (`POST …/social-post`).
8. **Show staff** (`POST …/reward-claim`) opens a live full-screen page with a
   running clock and a pulsing band, so an old screenshot is easy to spot.
   - The limit is one granted reward per device per campaign per
     `reward_cooldown_days`.
   - Refusals are recorded as `rejected_limit` and show the next eligible date.

## Rendering: why nothing in the device pipeline changed

`src/lib/campaigns/campaignManifest.ts` calls the studio's own
`buildDeviceRenderManifest` and `validateDeviceRenderManifest`:

- `stage: "final"`, `buildFromSources: true` (plugin v6), `9:16`.
- One clip source (`localId`, staged from the picked File) and
  `upload: null`.
- Opening card = text-graphics **hook**: category chip, merchant name,
  location.
- Closing card = **cta**: offer line, second line, and the button
  `CODE <code>`.
- Captions = the customer's sentence (in the template's language slot).
- The template's frame and decoration use the brand colour as the palette.
- **Sound.** The native from-sources path always mixes a "voice" track and drops
  clip audio.
  - A catalogue track is sent **as the voice**: `musicSelected: false`, so
    there is no lead-in and the cards and captions start at 0.
  - "Clip sound" stages the **same clip file again under the reserved `voice`
    key**, so the mixer takes the clip's own audio, in sync.
  - In both cases `voiceDurationSeconds` = picture length, so the video never
    runs past the clip.
  - If the clip's audio can't be read, the app renders again without staging
    it. The phone then downloads `voiceUrl`, the template's track.

Not touched: `DeviceRenderService`, render tasks, `device_render_attempts`, the
contract version, and native code. Campaign renders never enter the queue.

## Operator page

`/campaigns` is visible only to `CAMPAIGN_OPERATOR_EMAILS`. The default list is
bravegreatheart@gmail.com and zephyrothz@hotmail.com, matched by e-mail for
any role. It appears in the requester sidebar and hamburger (Dashboard shell)
and in the admin sidebar under "Merchant Campaigns". Everyone else gets a 404.

| Section | What you do there |
|---|---|
| Shops | Create and edit shops (name, kind of shop, location, address, phone, notes); archive or restore |
| Templates | Per shop: look, text style, brand colour, card language, opening and closing card texts (`{discount}` `{merchant}` `{location}` `{code}`), default sentence (factual, not a review), default sound. Includes a sketch preview |
| Campaigns | Shop + template, name, friend discount %, creator reward, cooldown days, start and end. Status draft → live → paused → ended. Shows the QR (printable PNG card, copy link, **New QR** to retire printed copies) and counts (creators, videos, rewards given and refused, post links) |

## API

All public routes are rate-limited per IP in memory.

| Method & path | Auth |
|---|---|
| `GET /api/campaigns/:slug?k=` | public view (never the QR key) |
| `POST /api/campaigns/:slug/session` | `X-Install-Id`; creator + code |
| `POST /api/campaigns/:slug/referral-code` | same; code only |
| `GET /api/campaigns/:slug/status?k=` | `X-Install-Id` |
| `POST /api/campaigns/:slug/manifest` | `X-Install-Id` |
| `POST /api/campaigns/:slug/video-made` | `X-Install-Id` |
| `POST /api/campaigns/:slug/reward-claim` | `X-Install-Id` |
| `POST /api/campaigns/:slug/social-post` | `X-Install-Id` |
| `GET/POST/PATCH /api/campaign-admin/…` | session + operator e-mail |
| `GET /api/travy/referral-codes/:code` | `X-API-Key: RCLIPPER_API_KEY` (iTravy) |

iTravy should also check that the code's `merchant.id` is the shop where it is
being redeemed. That check is what makes an accidental mistype very unlikely to
count. Redemption tokens and commission belong to iTravy (later).

## Referral codes

- Four characters from `ACDEFGHJKMNPQRTWXY34679`. The characters people
  misread (0/O, 1/I/L, 5/S, 2/Z, 8/B, U/V) are left out.
- Case-insensitive; spaces, dashes and `#` are ignored.
- Unique across **all** campaigns. The length grows to 5 after repeated
  collisions.
- Immutable: the DB trigger `creator_campaigns_code_immutable` refuses any
  change.

## Deploy checklist

1. `node scripts/apply-migration.js src/db/migrations/043_merchant_campaigns.sql`
2. `npm ci` (new deps: `jsqr`, `qrcode`, `@types/qrcode`) → `npm run build` → restart.
3. Optional env:
   - `CAMPAIGN_OPERATOR_EMAILS` (comma list)
   - `CAMPAIGN_INSTALL_PEPPER` (defaults to `NEXTAUTH_SECRET`; **do not change
     it later**, or every creator gets a new identity)
4. No new app build for the MVP. The scanner and the campaign page are web
   pages inside the app, and rendering uses plugin v6.

## Later (needs app builds)

- Let the phone camera open the app directly: add `/c` (and `/scan`) to the
  Android App Links intent-filter, and the path to the iOS AASA file.
- Native `sourceClipAudio` support (the clip's own sound mixed under a music
  bed).
- Phone OTP if fraud turns out high.
- iTravy redemption endpoint and commission ledger.

## Needs a device test

- iOS: `getUserMedia` camera permission inside the WKWebView (the
  photo-of-QR fallback covers a refusal).
- iOS: reading audio from a camera `.mov` as the "voice". The automatic music
  fallback covers a failure.
- Android: `capture` video input → camera app → File in the WebView.
