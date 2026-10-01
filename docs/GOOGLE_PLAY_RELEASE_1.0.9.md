# Google Play Open testing release — Android 1.0.9 (10)

Prepared: 2 October 2026

## Verified upload artifact

- File: `artifacts/google-play/RClipper-1.0.9-10-release.aab`
- Package: `com.rclipper.app`
- Version code: `10`
- Version name: `1.0.9`
- Minimum API: `24`
- Target API: `36`
- SHA-256: `2C247DF8B4E82A685A97A13FC8E29B879E4B2F1937216C1EB415D466D936508C`
- Signing: verified with the existing RClipper RSA upload key

## Release text

- Release name: `RClipper 1.0.9 (10)`
- English notes: `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai notes: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

## Verification performed

- `npm run build`: passed.
- Production Capacitor sync to `https://app.rclipper.com`: passed.
- `gradlew clean bundleRelease`: passed, including release lint and signing.
- `jarsigner -verify -verbose -certs`: `jar verified`.
- Merged manifest: package `com.rclipper.app`, version code `10`, version name
  `1.0.9`, minimum API `24`, target API `36`.

## Google Play Console upload steps

1. Open RClipper (`com.rclipper.app`) in Google Play Console.
2. Go to **Test and release > Testing > Open testing**.
3. If the track is inactive, choose **Create track**; otherwise choose
   **Create new release**.
4. Keep the existing Play App Signing configuration.
5. Upload `artifacts/google-play/RClipper-1.0.9-10-release.aab`.
6. Confirm version code `10`, version name `1.0.9`, and no blocking bundle
   error.
7. Enter release name `RClipper 1.0.9 (10)`.
8. Add the prepared English and Thai release notes.
9. Select the intended Open testing countries/regions and configure the tester
   feedback URL or email if Console requests it.
10. Resolve every blocking Console message, then save the release as a draft.
11. Review App content, Store listing, Data safety, App access, pricing/countries,
    and the pre-launch report.
12. After owner confirmation, send the changes for review/start the Open testing
    rollout.

Sending changes for review and starting a rollout are deliberate publishing
actions and require confirmation from the account owner at action time.
