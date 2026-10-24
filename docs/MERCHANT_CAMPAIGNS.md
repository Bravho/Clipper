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

## Story formats (19 Oct, migration 045)

A shop template picks **up to 4** video styles; the customer chooses one.
With no styles chosen, the customer gets the original simple clip. Catalog:
`src/config/campaignStoryFormats.ts`.

| Format | Shots | On screen (at most 3 things) |
|---|---|---|
| ☕ My Little Moment *(requested)* | drink up close, then the place around | "MY LITTLE MOMENT" card, "A little break from a busy day" |
| ❓ Guess Where I Am *(requested)* | food or a corner (sign out of view) | "Guess where I am?" (no shop name), hint, closing card reveals the shop |
| 👀 My Day's Point of View *(requested)* | one first-person shot | "POV · My day at …" |
| ⭐ Today's Pick *(requested)* | what they picked, up close | "TODAY'S PICK · <their pick>" (asks one short text) |
| 🎨 Mood of the Day *(requested)* | anything | Happy / Chill / Weekend vibe chips; the mood sets the music, look and text style |
| 😋 First Bite *(added)* | first bite or sip | "FIRST BITE" card |
| 🍽️ Before & After *(added)* | full, then empty | small "Before" / "After" labels instead of an opening card |
| 🔍 Little Details *(added)* | two close-ups | "LITTLE DETAILS" card |
| 🥂 Out with Friends *(added)* | the table with friends | "OUT WITH FRIENDS" card |
| 🏷️ Tag a Friend *(added)* | anything | "Who would you bring here?" — made for tagging friends who use the code |

Rules ("อย่าให้เยอะเกิน"):
- **One or two shots**, at most 15 s in total. A longer clip uses its first
  part.
- **At most three things on screen**: the opening card (or the shot labels),
  the customer's sentence, and the closing card with the code.
- Only Mood of the Day changes the shop's look; the shop colour always stays.
- Default sentences describe what happened, never quality ("best",
  "delicious", "ต้องมา"); a test guards this.
- **Two-shot formats use music only.** The renderer mixes one "voice" track, so
  two clips' own sounds cannot both stay in sync.
- Video words come in the template's caption language (Thai or English). App
  words (style names, descriptions, shot prompts, moods) are
  `campaign.format.*` / `campaign.mood.*` keys in Thai, English and Vietnamese.

Rendering is unchanged: each shot is one scene of the same v4 manifest (a hard
cut into the first shot, a dissolve into the second), staged under
`campaign_clip` and `campaign_clip_2`.

## Creator phone OTP + iTravy (18 Oct, migration 044)

Purpose: a creator must not redeem **their own** code. Redemption happens in
iTravy (travel_advisor, `REFERRAL_REDEMPTION_PLAN.md`), which already
OTP-verifies the friend's phone and refuses one equal to the creator's phone
(`evaluate()` → `SELF_REFERRAL`). RClipper's job is to verify the creator's
phone and hand it to iTravy.

1. **Link**: the operator pastes the iTravy campaign id into the RClipper
   campaign. It is saved only if iTravy has that campaign with the **same
   discount** (`GET /api/referral/rclipper/campaigns/:id`).
2. **Session**: RClipper registers the creator's code at iTravy, best effort
   (`POST /api/referral/rclipper/codes`, `X-API-Key: RCLIPPER_API_KEY`).
   RClipper sends **its own code**, so the code in the video is the code
   iTravy redeems. If iTravy already holds a different code for that creator,
   the result is `CODE_MISMATCH` and the video is refused.
3. **Step 4 "Verify your phone"** (once per install, before Create):
   - `POST /api/campaigns/:slug/phone/send` → 6-digit SMS code.
   - `POST …/phone/verify` checks it, then sends `creator_phone` (E.164)
     with the code to iTravy. iTravy stores only its HMAC, per creator.
   - If iTravy cannot be reached, the code is **not** used up; the creator
     taps Verify again.
4. **Manifest** is refused (`428 phone_required`) until the phone is verified,
   and, when the campaign is linked, iTravy has it. A linked campaign also
   needs the code registered at iTravy.

Rules are identical to iTravy's redeemer OTP:
- Phone normalisation (Thai 06/08/09, 66…, +E.164) is the same on both sides.
- Codes are 6 digits, live 5 minutes, allow 5 tries, and need 60 s between
  sends.
- Limits: 5 sends per install per hour, 3 per phone per hour. They are checked
  before any SMS is sent.
- The SMS text is in Thai, English or Vietnamese.

The number is stored only as HMAC(pepper, E.164) plus its last 4 digits. The
OTP code is stored as an HMAC. The creator reward is also limited **per
phone** (two installs, one number = one reward per cooldown).

**SMS provider**: `src/lib/sms/index.ts`, the same shape as iTravy's
`sms/index.js`.
- Unset in development, it uses `console` (the code appears in the server log).
- Unset in **production**, there is no provider. The phone step is **skipped**,
  as iTravy does, and logged once.
- Add a real provider (for example ThaiBulkSMS) in both repos and set
  `SMS_PROVIDER` on both servers. Until then self-referral is NOT blocked by
  phone on either side.

Per campaign, `require_phone_otp` (default on) can be switched off in the
operator form.

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
| `POST /api/campaigns/:slug/phone/send` | `X-Install-Id`; `{ k, phone, lang }` |
| `POST /api/campaigns/:slug/phone/verify` | `X-Install-Id`; `{ k, challengeId, code, phone }` |
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
   then `node scripts/apply-migration.js src/db/migrations/044_campaign_phone_otp.sql`
   then `node scripts/apply-migration.js src/db/migrations/045_campaign_story_formats.sql`
2. `npm ci` (new deps: `jsqr`, `qrcode`, `@types/qrcode`) → `npm run build` → restart.
3. iTravy link: `RCLIPPER_API_KEY` (already set; the same value as on iTravy)
   and optionally `ITRAVY_API_URL` (default `https://api.travy.buzz`).
   `SMS_PROVIDER` (see above).
   Optional env:
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
- iTravy redemption endpoint and commission ledger.

## Needs a device test

- iOS: `getUserMedia` camera permission inside the WKWebView (the
  photo-of-QR fallback covers a refusal).
- iOS: reading audio from a camera `.mov` as the "voice". The automatic music
  fallback covers a failure.
- Android: `capture` video input → camera app → File in the WebView.
