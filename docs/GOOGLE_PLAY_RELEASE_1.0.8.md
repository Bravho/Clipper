# Google Play release — Android 1.0.8 (9)

Prepared: 11 September 2026

## Verified upload artifact

- File: `artifacts/google-play/RClipper-1.0.8-9-release.aab`
- Package: `com.rclipper.app`
- Version code: `9`
- Version name: `1.0.8`
- Minimum API: `24`
- Target API: `36`
- SHA-256: `7B611B699E8FCB7A29DC9A9440574941E582EBDCF31038BB059D61F5C1CF9DE4`
- Signing: verified with the existing RClipper RSA upload key

## Release text

- Release name: `RClipper 1.0.8 (9)`
- English notes: `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai notes: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

## Verification performed

- `npm run build`: passed.
- Production Capacitor sync to `https://app.rclipper.com`: passed.
- `gradlew clean bundleRelease`: passed, including release lint and signing.
- `jarsigner -verify -verbose -certs`: `jar verified`.
- Merged manifest: package `com.rclipper.app`, version code `9`, version name
  `1.0.8`, minimum API `24`, target API `36`.

The full Jest run completed with 925 passing tests and 6 failures in 3 suites.
The failures are existing application-test issues rather than Android compilation
or signing failures: one render-queue expectation, two password-reset/Webpack
interaction tests (four assertions), and three stale Thai presentation-copy
expectations.

## Google Play Console upload steps

1. Open RClipper (`com.rclipper.app`) in Google Play Console.
2. Go to **Test and release > Production**.
3. Choose **Create new release**.
4. Keep the existing Play App Signing configuration.
5. Upload `artifacts/google-play/RClipper-1.0.8-9-release.aab`.
6. Wait for processing and confirm version code `9`, version name `1.0.8`,
   and no blocking bundle error.
7. Set the release name to `RClipper 1.0.8 (9)`.
8. Add the prepared English and Thai release notes.
9. Resolve every blocking Console message, then choose **Save as draft**.
10. Review App content, Store listing, Data safety, App access,
    pricing/countries, and the pre-launch report.
11. When the account owner is satisfied, choose **Send changes for review**.
12. After approval, verify the rollout settings before starting the production
    rollout.

Sending changes for review and starting a production rollout are deliberate
publishing actions and should be confirmed by the account owner at action time.
