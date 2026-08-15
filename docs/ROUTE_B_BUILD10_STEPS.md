# Route B — ship build 10 with Google sign-in working in-app

All code is done. Six steps remain, and **only steps 1–3 need judgement** — the
rest is mechanical.

Reference: `docs/NATIVE_SIGN_IN.md` → "Enabling native Google on iOS (build 10)".

---

## Step 1 — Create the iOS OAuth client (Google Cloud Console)

1. Open https://console.cloud.google.com/ and select the project that owns your
   existing web client — **`815687220043`** (the prefix of `GOOGLE_CLIENT_ID`).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Application type: **iOS**.
4. Bundle ID: **`com.rclipper.app`**.
5. Create, then copy the client ID. It looks like
   `815687220043-<hash>.apps.googleusercontent.com`.

There is no client secret for an iOS client, and you do not need one.

> The bundle ID must be the **Xcode** one (`PRODUCT_BUNDLE_IDENTIFIER`), not the
> Capacitor `appId`, when a project has both. For RClipper they are the same
> value, so there is nothing to reconcile — but confirm in Xcode → App target →
> General if you want to be certain.

---

## Step 2 — Publish the OAuth consent screen

**APIs & Services → OAuth consent screen → Publish app.**

While it is in "Testing", only accounts on the test-user list can sign in.
Apple's reviewer is not on that list, so they would hit *"access blocked"* — a
rejection whose message looks nothing like its cause. This is the single most
overlooked step.

---

## Step 3 — Write the client ID into the app

From the project root:

```bash
node scripts/set-google-ios-client-id.js 815687220043-<hash>.apps.googleusercontent.com
```

This derives the reversed client ID (`com.googleusercontent.apps.815687220043-<hash>`)
and writes it into `ios/App/App/Info.plist`. It then prints two lines for step 4.

Deriving it by hand is where this setup usually breaks: one wrong character and
the Google sheet opens and then dead-ends, with no useful error anywhere.

---

## Step 4 — Add the two server env vars

On the droplet, in `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=815687220043-<hash>.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=815687220043-<hash>.apps.googleusercontent.com
```

Both are needed and they are not redundant. The first un-hides the Google button
in the iOS app. The second lets the server accept the token: Google mints it
against whichever client did the sign-in, so an iOS token carries the **iOS**
client ID in `aud`, while web and Android tokens carry the **web** one.

While you are in the file, also fix this — it is currently empty:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=815687220043-<web hash>.apps.googleusercontent.com
```

Same value as `GOOGLE_CLIENT_ID`. Being empty silently disables native Google on
**Android** too, which is the same bug waiting for you at the Play Store.

Then restart the Next.js process. `NEXT_PUBLIC_*` values are baked in at build
time, so the app must be rebuilt and restarted, not just restarted.

> **Timing:** deploy these together with — or after — uploading build 10. Setting
> them while build 9 is what people are running re-shows a Google button that
> the old binary cannot complete (`Your app is missing support for the following
> URL schemes`). A visible button that does nothing is its own rejection under
> Guideline 2.1.

---

## Step 5 — Build and upload

```bash
npm run build
npx cap sync ios
cd ios/App && pod install
```

Then open **`ios/App/App.xcworkspace`** — the workspace, not the `.xcodeproj`, or
the pods will not link. The build number is already bumped to **10**; marketing
version stays 1.0.1. Archive and upload.

---

## Step 6 — Test on a real iPad before submitting

The reviewer used an iPad Air 11-inch (M4), so test on iPad, not just iPhone.

1. Sign out completely.
2. Tap **Sign in with Google** → a Google sheet appears **over the app**. The app
   must not background and Safari must not open. Complete it → you land on
   `/dashboard`, signed in *inside the app*.
3. Back out of the Google sheet halfway → returns to the login screen with **no**
   red error banner (cancellation is swallowed on purpose).
4. Tap **Sign in with Apple** → system sheet → signed in.
5. Register a brand-new account with email → six-digit code → sign in.
6. Open **Account → Delete account** and confirm it completes.
7. At no point should the app background or Safari open.

If Google fails, the two diagnostics worth knowing:

| Symptom | Cause |
|---|---|
| Xcode console: `Your app is missing support for the following URL schemes` | Step 3 not run, or the reversed ID does not match the client ID |
| Server log: `google:IdTokenInvalid` or `AudienceNotConfigured` | `GOOGLE_IOS_CLIENT_ID` missing from step 4 |
| Google sheet says "access blocked" | Step 2 — consent screen still in Testing |

---

## Step 7 — Reply to App Store Review

Use the **Route B** block in `docs/APPSTORE_GUIDELINE4_SIGNIN_FIX.md`. Fill in a
reviewer demo account first, and make sure it is a **Requester** role so they
land on `/dashboard` rather than a staff or admin screen.
