# Android App Links Setup

> **Note:** sign-in no longer depends on App Links. The mobile apps use native
> in-app sign-in (`docs/NATIVE_SIGN_IN.md`) because Custom Tabs do not share
> cookies with the WebView. App Links still matter for opening
> `https://app.rclipper.com/...` links in the app, and the fingerprint below is
> still wrong for Play-installed builds.

RClipper declares a verified Android App Link for `https://app.rclipper.com` in
`android/app/src/main/AndroidManifest.xml`.

The website serves Digital Asset Links from:

```text
public/.well-known/assetlinks.json
```

which deploys to:

```text
https://app.rclipper.com/.well-known/assetlinks.json
```

## Current Certificate Fingerprint

The current file uses the local upload key SHA-256 fingerprint:

```text
6D:93:07:E2:97:64:44:7B:16:2A:D9:9D:F9:F4:0B:E6:8A:99:49:E0:8A:0E:09:5B:1B:89:BC:10:67:8A:C5:B9
```

After the first app bundle is uploaded and Play App Signing is active, check:

```text
Play Console -> Test and release -> App integrity -> Protected with Play
```

If Google shows a different "App signing key certificate" SHA-256 fingerprint,
add or replace the fingerprint in `assetlinks.json` with the Play app-signing
certificate. Android devices install the Play-signed APK, so that certificate is
the important one for production App Links.
