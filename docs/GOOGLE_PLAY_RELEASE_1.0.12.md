# Google Play Open testing release — Android 1.0.12 (13)

Prepared: 12 October 2026

## Verified upload artifact

- File: `artifacts/google-play/RClipper-1.0.12-13-release.aab`
- Package: `com.rclipper.app`
- Version code: `13`
- Version name: `1.0.12`
- Minimum API: `24`
- Target API: `36`
- Size: `11,526,531` bytes
- SHA-256: `50846D8B089749F2CA998C56939773A7A99E650F25E1E27DB4F33CD1D33A65A6`
- Signing: verified with the existing RClipper RSA upload key (`jar verified`)

Version code `12` was rejected by Google Play as already used, so this bundle
supersedes `RClipper-1.0.11-12-release.aab`.

## Release text

- Release name: `RClipper 1.0.12 (13)`
- English notes: `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai notes: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

## Verification performed

- Production Capacitor sync to `https://app.rclipper.com`: passed.
- `gradlew clean bundleRelease`: passed, including release lint and signing.
- `jarsigner -verify -verbose -certs`: `jar verified`.
- Merged manifest: package `com.rclipper.app`, version code `13`, version name
  `1.0.12`, minimum API `24`, target API `36`.
- Focused purchase/quota verification from this release series: 3 suites and 35
  tests passed.

## Google Play Console steps

Current Console status: draft release `8` has accepted
`RClipper-1.0.12-13-release.aab` as version `13 (1.0.12)` with no blocking
version-code error. Release details and final draft save remain pending.

1. Open RClipper (`com.rclipper.app`) in Google Play Console.
2. Go to **Test and release > Testing > Open testing**.
3. Open draft release `6`.
4. Remove or ignore the rejected version-code-12 upload.
5. Upload `artifacts/google-play/RClipper-1.0.12-13-release.aab`.
6. Confirm version code `13`, version name `1.0.12`, and no blocking bundle
   error.
7. Enter release name `RClipper 1.0.12 (13)`.
8. Add the prepared English and Thai release notes.
9. Save the release as a draft and resolve any blocking Console messages.
10. Choose **Next** to preview and confirm the release.
11. Send for review/start the Open Testing rollout only after owner
    confirmation.

