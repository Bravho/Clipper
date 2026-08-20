# RClipper Google Play deployment handoff

Updated: 4 August 2026

## Release identity

- App name: RClipper
- Package: `com.rclipper.app`
- Play Console app ID: `4972504518557350406`
- Current Android version: version code `6`, version name `1.0.5`
- Minimum Android API: 24
- Target and compile API: 36
- Intended audience: ages 13–15, 16–17, and 18+ (13+)
- Native Android push: included (FCM HTTP v1). Requires a Firebase project and
  `android/app/google-services.json`, and a Data safety update declaring the
  registration token as a collected device identifier —
  see `docs/PUSH_NOTIFICATIONS_SETUP.md`

## Android Studio release steps

1. Run `npm install`, `npm run build`, and `npm run cap:sync`.
2. Open `android/` in Android Studio.
3. Choose **Build > Generate Signed App Bundle or APK > Android App Bundle**.
4. Create or select the RClipper upload key. Keep the `.jks`, alias, and
   passwords backed up outside Git; losing the upload key can block future
   updates.
5. Copy `android/keystore.properties.example` to
   `android/keystore.properties` and enter the same local signing values if
   command-line signed builds are wanted.
6. Build the `release` variant and verify the resulting `.aab` with
   `jarsigner -verify -verbose -certs <bundle>` before uploading.

The repository builds a release bundle without a signing file, but that bundle
is unsigned and must not be uploaded to Google Play.

## Prepared store assets

- Store icon: `play-store-assets/rclipper-store-icon-512.png`
- Phone screenshots: `play-store-assets/phone-screenshots/01-*.png` through
  `05-*.png` (1080 × 2400)

The store icon uses the same RClipper artwork as
`android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`.

## Play Console status and remaining fields

Already saved in Console:

- Government apps: No
- Financial features: No declared financial features
- Health features: No declared health features

Remaining setup should be completed without creating or inviting testers:

1. **App access:** mark that sign-in is required and provide a permanent Google
   reviewer account with English access instructions. Do not use a personal or
   development admin account.
2. **Target audience and content:** select 13–15, 16–17, and 18+. The app is a
   business video-production tool, not a child-directed app. Confirm the Play
   Families follow-up answers shown by Console.
3. **Ads:** answer based on the production app. RClipper does not contain an ad
   SDK; publication of customer videos to social channels is not in-app display
   advertising.
4. **Content rating:** complete the questionnaire for a video-production app
   that accepts private user media and may publish selected, moderated results.
5. **Data safety:** declare the production flows actually enabled. At minimum,
   review account data, uploaded photos/videos/audio and text, purchase records,
   app interactions, storage/AI processors, social publishing destinations,
   encryption in transit, and the public account-deletion route.
6. **Store listing:** upload the prepared icon and phone screenshots; retain any
   existing feature graphic and listing copy only if they still match the app.
7. **App bundle:** upload only a verified, upload-key-signed `.aab`.

Do not send for production review until the reviewer account, Data safety
answers, signed bundle, and `https://app.rclipper.com/.well-known/assetlinks.json`
are complete. The App Link file needs the SHA-256 certificate fingerprint from
the final Play signing configuration.

## Chrome / ChatGPT continuation

Open the RClipper app dashboard in the already signed-in Chrome profile, then
allow the ChatGPT Chrome extension to continue from that tab. Never provide the
Google account password to ChatGPT. Stop before tester setup, production rollout,
payment changes, legal attestations that need owner judgment, CAPTCHA, or 2-step
verification.
