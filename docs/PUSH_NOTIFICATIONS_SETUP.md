# Push notifications — pipeline step alerts on Android, iOS and the web

Updated: 16 August 2026

A video takes many minutes per step, and most steps end at a gate where the
pipeline stops and waits for the requester. Push notifications exist so the
requester can put the phone down and be told when it is their turn again,
instead of sitting on a polling page.

This document covers what fires when, and every console/credential setting the
three delivery channels need. **Nothing here is optional if you want native
notifications to work** — the server has been able to send them since migration
015, but until this release nothing on the phone ever asked for a token.

---

## 1. What fires, and when

Notifications are sent **only at gates** — the points where the pipeline is
genuinely blocked on the requester — never on the completion of a processing
step. "Merging your scene clips" finishing is not news to the user: the very next
thing that happens is the pipeline continuing on its own.

| Step reached | Notification |
| --- | --- |
| `awaiting_content_approval` | เนื้อหาพร้อมตรวจสอบ |
| `awaiting_voice_approval` | เสียงพร้อมตรวจสอบ |
| `awaiting_scene_design_approval` | ฉากพร้อมตรวจสอบ |
| `awaiting_scene_script_approval` | บทฉากที่ *N* พร้อมตรวจสอบ (per scene) |
| `awaiting_video_approval` | วิดีโอฉากที่ *N* พร้อมตรวจสอบ (per scene) |
| `awaiting_animation_approval` | ภาพเคลื่อนไหวพร้อมตรวจสอบ |
| `awaiting_final_approval` | วิดีโอฉบับสุดท้ายพร้อมแล้ว |
| `awaiting_overlay_approval` | คำบรรยายพร้อมตรวจสอบ |
| `awaiting_additional_ratios` | พร้อมสร้างรูปแบบช่องทางอื่น |
| `awaiting_distribution_review` | **ไฟล์วิดีโอพร้อมดาวน์โหลด** ← the final step |
| `failed` | การสร้างวิดีโอต้องตรวจสอบ |
| `complete` | งานวิดีโอเสร็จสมบูรณ์ |

Copy lives in `NOTICES` / `PER_SCENE_NOTICE` in
`src/services/PushNotificationService.ts`.

### The express lane sends exactly one notification

When the requester presses **"อนุมัติและทำทุกขั้นตอนที่เหลืออัตโนมัติ"** at the scene-plan
gate (step 3), the job carries `auto_approve_remaining` and every later review
gate is granted on their behalf within seconds of the pipeline reaching it.

Notifying on those gates would be worse than useless: it would summon the user
to a screen that has already disappeared, five times in a row, immediately after
they said they did not want to be involved again. So on an express-lane job the
phone stays **silent until `awaiting_distribution_review`** — the final step,
files ready to download.

Two things are deliberately *not* suppressed, even on the express lane:

- **`failed`** — a failed job always needs the requester.
- **any gate the lane does not clear** (today: the per-scene script gate). The
  job really does park there, so silencing it would leave the requester on a
  spinner with no notification and no explanation.

The rule is one function, `shouldSuppressPipelineNotice()` in
`src/config/push.ts`, derived from the same `isAutoApprovedGate()` predicate the
UI uses to re-label those gates as "processing". Keeping one source of truth is
the point: a second hand-maintained list would drift, and drift here is
invisible until a user complains about either notification spam or silence.
`tests/config/pushNotices.test.ts` pins the behaviour.

---

## 2. How delivery works

One table, `push_devices` (migration 015 + 016), holds all three kinds of
subscription, keyed by a unique `token`:

| platform | `token` holds | transport |
| --- | --- | --- |
| `android` | FCM registration token | FCM HTTP v1 |
| `ios` | APNs device token | APNs HTTP/2 (`node:http2`) |
| `web` | PushSubscription endpoint URL (+ `p256dh`/`auth` keys) | Web Push / VAPID |

Every notice is written to `push_notification_deliveries` first, with a unique
`(job_id, event_key)` constraint. That insert is the idempotency gate: if it
conflicts, the notification has already been sent and nothing is delivered.
This is what stops a retried render or a double status-poll from notifying twice.

A token the push service reports as gone (FCM `UNREGISTERED`, APNs `410
Unregistered` / `400 BadDeviceToken`, Web Push `404`/`410`) is disabled
automatically. Other errors — bad payload, bad credentials — are logged and the
device is kept, because pruning on those would disable every device on the
account after one server-side mistake.

Registration happens client-side in:

- `src/components/mobile/NativePushRegistration.tsx` (native), and
- `src/components/pwa/WebPushRegistration.tsx` (browser),

both mounted in `src/app/layout.tsx`. Each shows an **in-app explanation before
the OS permission prompt**. That is not politeness: iOS grants exactly one
`requestPermissions()` per install, and once the user declines the system sheet
it can never be shown again from inside the app.

---

## 3. Server environment variables

All of these live on the droplet's `.env.local` (and any other host that serves
the app). Each channel is independent — a missing credential disables that
channel and leaves the others working.

### Web Push (browser + installed PWA)

```bash
npx web-push generate-vapid-keys
```

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:support@rclipper.com
```

Generate the pair **once** and keep it. Rotating the VAPID keys invalidates every
existing browser subscription — every user has to opt in again.

### Android (FCM HTTP v1)

```
FCM_PROJECT_ID=<firebase project id>
FCM_CLIENT_EMAIL=<service account email>
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### iOS (APNs token auth)

```
APNS_KEY_ID=<10-char key id>
APNS_TEAM_ID=F47AYL2ZMB
APNS_BUNDLE_ID=com.rclipper.app
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APNS_ENVIRONMENT=production
```

> **`APNS_ENVIRONMENT` is the single most common cause of "iOS never gets
> anything".** A token minted by a build signed with the `development`
> entitlement is only valid on `api.sandbox.push.apple.com`, and vice versa —
> the wrong host returns `400 BadDeviceToken` and the server then disables that
> device. Which build produced the token matters, not where the server runs:
>
> - Xcode "Run" on a device → `development` entitlement → `APNS_ENVIRONMENT=sandbox`
> - **TestFlight** and App Store → `production` entitlement → `APNS_ENVIRONMENT=production`
>
> TestFlight using *production* APNs surprises most people. The build settings
> added in this release wire this automatically: `APS_ENVIRONMENT` is
> `development` in the Debug configuration and `production` in Release.

---

## 4. Firebase Console (required for Android)

1. <https://console.firebase.google.com> → **Add project**. Reuse the existing
   Google Cloud project if RClipper already has one, so the Play/Android OAuth
   clients stay in one place.
2. **Project settings → General → Your apps → Add app → Android.**
   - Android package name: `com.rclipper.app` (must match exactly).
   - Add the SHA-1 of **both** the upload key *and* the Play App Signing key
     (Play Console → Test and release → Setup → App signing). This is the same
     trap that broke native Google Sign-In: a Play-installed build is signed by
     Play, not by your upload key.
3. Download **`google-services.json`** and put it at
   `android/app/google-services.json`.
   The Gradle plugin is applied only when that file exists, so a checkout
   without it still builds — it just cannot receive push.
4. **Project settings → Cloud Messaging** — confirm the *Firebase Cloud
   Messaging API (V1)* is **Enabled**. (The legacy Cloud Messaging API stays
   disabled; this code uses v1 only.)
5. **Project settings → Service accounts → Generate new private key.** From the
   downloaded JSON take:
   - `project_id` → `FCM_PROJECT_ID`
   - `client_email` → `FCM_CLIENT_EMAIL`
   - `private_key` → `FCM_PRIVATE_KEY` (keep the literal `\n` escapes, quoted)

   Store this JSON like a password. It can send notifications to every user.

### For iOS delivery through Firebase — don't

APNs is called directly (`node:http2`), so Firebase never needs the APNs key and
the iOS app does **not** need `GoogleService-Info.plist` or the Firebase pod.
One less SDK in the binary and one less privacy disclosure to make.

---

## 5. Google Play Console

The app already ships; these are the settings to change for this release.

1. **Test and release → App bundle** — upload the new AAB. `versionCode` is now
   `7` (`versionName 1.0.6`).
2. **Policy → App content → Data safety.** This is the one that is easy to miss:
   an FCM registration token is a **device identifier**, and it is now collected.
   Update the form:
   - Data type: **Device or other IDs → Device or other IDs** → *Collected*.
   - Purpose: **App functionality** (and only that — these are transactional
     notices, not analytics or advertising).
   - Shared with third parties: **No**.
   - Linked to the user's identity: **Yes** (the token is stored against the
     signed-in user so we know which phone to notify).
   - Processed ephemerally: **No** (it is stored in `push_devices`).
   - Users can request deletion: **Yes** — account deletion already cascades
     `push_devices` (`ON DELETE CASCADE`), and signing out unregisters the token.
   Submitting an out-of-date Data safety form is a policy violation in its own
   right, independent of anything the app does.
3. **`POST_NOTIFICATIONS` needs no declaration.** It is a normal runtime
   permission, not a restricted one, so there is no Play Console form for it and
   no sensitive-permission review. It is simply required because the app targets
   API 36 (API 33+).
4. **Store listing** — if the screenshots show the notification opt-in card,
   nothing else changes. Notifications are not a listed feature that needs a
   separate declaration.
5. **App access** — unchanged; the reviewer account already exists. Note in the
   review notes that notifications require signing in and submitting a clip
   request, so the reviewer is not expected to see one.
6. **Advertising ID** — still **No**. Nothing here uses it; do not let the
   Data safety edit above tempt you into declaring one.

---

## 6. Apple Developer + App Store Connect

### Apple Developer portal

1. **Certificates, Identifiers & Profiles → Identifiers →** `com.rclipper.app`
   → enable the **Push Notifications** capability → Save. Existing provisioning
   profiles are invalidated; with Automatic signing Xcode regenerates them.
2. **Keys → +** → name it e.g. "RClipper APNs" → tick **Apple Push Notifications
   service (APNs)** → Continue → Register → **Download** the `.p8`.
   - Apple lets you download it **once**. Losing it means revoking and
     re-issuing.
   - The 10-character Key ID shown here is `APNS_KEY_ID`.
   - Team ID (`F47AYL2ZMB`) is `APNS_TEAM_ID`.
   - One key works for every app in the team, and for both APNs environments.

### Xcode

3. Open `ios/App/App.xcworkspace` → target **App** → **Signing & Capabilities**
   → **+ Capability → Push Notifications**. The `aps-environment` entitlement is
   already in `App/App.entitlements`, and this release adds the `APS_ENVIRONMENT`
   build setting it interpolates (`development` in Debug, `production` in
   Release) — which was previously undefined, so the entitlement resolved to an
   empty string and registration could never have succeeded.
4. Confirm **Background Modes → Remote notifications** stays **off**. These are
   ordinary alerts; enabling background modes without using them invites review
   questions.

### App Store Connect

5. **App Privacy → Data types.** Same substance as the Play form:
   - **Identifiers → Device ID** → *Data used to track you?* **No** →
     *Data linked to you?* **Yes** → Purpose: **App Functionality**.
   - Do not add Analytics or Third-Party Advertising purposes.
6. Upload build **11** (`1.0.2`). TestFlight and the App Store both use the
   **production** APNs environment — see the warning in §3.
7. **Review notes**: state that push notifications are transactional
   ("your video step is ready for review"), require sign-in, and that the app
   requests permission only after an in-app explanation. Apple rejects apps that
   fire the system prompt at launch with no context; this build does not.
8. Nothing here counts as marketing push, so no separate consent flow is needed.
   If that ever changes, Apple requires an explicit in-app opt-in for marketing
   notifications, separate from this one.

---

## 7. Building it

```bash
npm install                # picks up @capacitor/push-notifications
npm run build
npm run cap:sync           # adds the plugin to Podfile + capacitor.build.gradle
```

Then Android Studio (`npm run cap:open:android`) and Xcode
(`npm run cap:open:ios`) as usual — see `docs/PLAY_STORE_DEPLOYMENT.md` and
`docs/MOBILE_STORE_COMPLIANCE.md`.

`npm run cap:sync` regenerates `android/app/capacitor.build.gradle` and
`ios/App/Podfile`; the plugin lines appear there automatically.

---

## 8. Verifying it end to end

1. Sign in on a **physical device** (the iOS simulator cannot register for
   remote notifications).
2. Accept the in-app card, then the OS prompt.
3. Check the row landed:
   ```sql
   SELECT platform, enabled, created_at FROM push_devices WHERE user_id = '<id>';
   ```
   No row → look at the device console for `[push] registration error:`
   (Android: missing `google-services.json`; iOS: missing capability/entitlement).
4. Submit a clip request and let it reach the first gate. Background the app.
5. Check delivery:
   ```sql
   SELECT event_key, delivered_at FROM push_notification_deliveries
   WHERE job_id = '<job>' ORDER BY created_at;
   ```
   `delivered_at IS NULL` means the row was created but every transport failed —
   the reason is in the server log as `[push] delivery failed:`.
6. Tap the notification: it must open the request's page, not the dashboard root.
7. Repeat with the **express lane** — press "อนุมัติและทำทุกขั้นตอนที่เหลืออัตโนมัติ" at
   the scene-plan gate. Expect exactly **one** notification, at the end
   ("ไฟล์วิดีโอพร้อมดาวน์โหลด"), and none in between.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `registrationError: MISSING_INSTANCEID_SERVICE` | `google-services.json` absent, or the Gradle plugin skipped it |
| Android registers but nothing arrives | channel id mismatch — server `channel_id` must equal `ANDROID_CHANNEL_ID`; Android 8+ silently drops unknown channels |
| Android shows a white square icon | notification icon is not a transparent white silhouette (`ic_stat_rclipper`) |
| iOS `no valid aps-environment entitlement` | Push Notifications capability not enabled on the App ID, or `APS_ENVIRONMENT` unset |
| iOS `400 BadDeviceToken`, device gets disabled | sandbox/production mismatch — see §3 |
| iOS `403 TooManyProviderTokenUpdates` | the provider JWT is being re-minted too often; it is cached for 45 min in `PushNotificationService` |
| Web: nothing, no errors | VAPID keys unset — Web Push is skipped silently by design |
| Notification arrives twice | should be impossible: `(job_id, event_key)` is unique. Check for two servers with different code |
