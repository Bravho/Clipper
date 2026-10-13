# Google Play Open testing release — Android 1.0.13 (14)

Prepared: 13 October 2026

## Verified upload artifact

- File: `artifacts/google-play/RClipper-1.0.13-14-release.aab`
- Package: `com.rclipper.app`
- Version code: `14`
- Version name: `1.0.13`
- Minimum API: `24`
- Target API: `36`
- Size: `11,526,544` bytes
- SHA-256: `5B918B4836698363E14DAF48DA02705DFD2F4DC5269F22214F3062144CC3CDB7`
- Signing: verified with the existing RClipper upload key (`jar verified`)
- Production server: `https://app.rclipper.com`

## Release text

- Release name: `RClipper 1.0.13 (14)`
- English notes: `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai notes: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

## Verification performed

- `npm run build`: passed.
- Production Capacitor sync to `https://app.rclipper.com`: passed.
- `gradlew clean bundleRelease`: passed, including release lint and signing.
- `jarsigner -verify`: `jar verified`.
- Merged manifest: package `com.rclipper.app`, version code `14`, version name
  `1.0.13`, minimum API `24`, target API `36`.
- Test suite: 123 of 125 suites passed; 1,384 of 1,388 tests passed. Four
  assertions currently fail in `RequestPresentationService.test.ts` (three
  message/queue expectations) and `VideoGenerationService.test.ts` (one render
  queue expectation). These failures were recorded without changing application
  behavior during release packaging.

## Google Play Console status

- RClipper Open testing is active and available to unlimited testers.
- Current live Open testing release: version code `13`, version name `1.0.12`.
- A new Open testing draft, release `9`, was created in Chrome.
- Bundle upload is pending because the browser upload permission was declined.

## Complete the Open testing release

1. In the open Play Console draft, click **Upload** under **App bundles**.
2. Select `artifacts/google-play/RClipper-1.0.13-14-release.aab`.
3. Wait for Play Console to finish processing the bundle.
4. Confirm package `com.rclipper.app`, version code `14`, version name `1.0.13`,
   minimum API `24`, and target API `36`.
5. Resolve any blocking bundle error. Advisory quality warnings can be reviewed
   separately, but do not ignore an error that prevents the release.
6. Enter release name `RClipper 1.0.13 (14)`.
7. Paste the prepared Thai and English release notes from
   `play-store-assets/closed-testing/` into their matching language sections.
8. Click **Save as draft**.
9. Click **Next** and review the preview, supported devices, countries/regions,
   and any warnings.
10. Only after owner confirmation, click the final action to start the Open
    testing rollout or send the change to Google for review.

## Tester access

The Open testing track is already active and set to unlimited testers. The
Console currently shows one selected country/region. Review the **Testers** and
**Countries/regions** tabs before rollout if the intended audience has changed.
