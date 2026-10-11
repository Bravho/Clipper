# Google Play Open testing release — Android 1.0.10 (11)

Prepared: 11 October 2026

## Verified upload artifact

- File: `artifacts/google-play/RClipper-1.0.10-11-release.aab`
- Package: `com.rclipper.app`
- Version code: `11`
- Version name: `1.0.10`
- Minimum API: `24`
- Target API: `36`
- Size: `11,526,534` bytes
- SHA-256: `32C9E4371E1C4A10BC52A56F272148DCFF27D8B58B91E4039B55E8309691FE17`
- Signing: verified with the existing RClipper RSA upload key (`jar verified`)

## Release text

- Release name: `RClipper 1.0.10 (11)`
- English notes: `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai notes: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

## Verification performed

- Production Capacitor sync to `https://app.rclipper.com`: passed.
- `gradlew clean bundleRelease`: passed, including release lint and signing.
- `jarsigner -verify -verbose -certs`: `jar verified`.
- Merged manifest: package `com.rclipper.app`, version code `11`, version name
  `1.0.10`, minimum API `24`, target API `36`.
- `npm run build` and Jest were attempted but could not complete because the
  Windows sandbox denied `realpath`/directory operations (`EPERM`). These were
  environment-level failures; the native release build completed successfully.

## Google Play Console status

- Developer account: Pillarth.
- App: RClipper (`com.rclipper.app`).
- Track: Open testing.
- Current live release: `10 (1.0.9)`, released 2 October 2026.
- New draft created: release ID `5`, awaiting bundle upload and release details.
- Browser upload is blocked until Chrome's ChatGPT extension has **Allow access
  to file URLs** enabled.

## Finish the draft

1. In Chrome, open `chrome://extensions`.
2. Open **Details** for the ChatGPT browser extension.
3. Enable **Allow access to file URLs**.
4. Return to the prepared RClipper open-testing draft.
5. Upload `artifacts/google-play/RClipper-1.0.10-11-release.aab`.
6. Confirm version code `11`, version name `1.0.10`, and no blocking bundle
   error.
7. Enter release name `RClipper 1.0.10 (11)`.
8. Add the prepared English and Thai release notes.
9. Save the release as a draft and review Console warnings.
10. Preview the release. Send for review/start rollout only after owner
    confirmation.

