# Native sign-in in the mobile apps (Android + iOS)

## The bug this replaces

The mobile shells load `app.rclipper.com` in a Capacitor WebView. Sign-in used to
open the OAuth provider in a **Chrome Custom Tab** (Android) or
**SFSafariViewController** (iOS) via `Browser.open()`.

Those browsers **do not share a cookie jar with the WebView**:

| Surface | Cookie store |
|---|---|
| Capacitor WebView | `android.webkit.CookieManager` / `WKWebsiteDataStore` |
| Chrome Custom Tab | Chrome's own profile |
| SFSafariViewController | Safari's store (isolated from WKWebView since iOS 11) |

So NextAuth completed the callback and set `next-auth.session-token` **in the
browser**. The user saw a logged-in `rclipper.com` page in Chrome while the app
itself stayed on the login screen. That is the exact symptom reported on the Play
closed-testing build.

A second, independent failure compounded it on Android: the return trip into the
app relies on App Links verification for `app.rclipper.com`, and
`public/.well-known/assetlinks.json` carries the **local upload key** fingerprint.
Play-installed builds are signed by **Play App Signing**, so verification fails
and the link is never handed to the app. See "App Links" below — worth fixing
regardless, but it is no longer on the sign-in path.

## The fix

Sign-in now happens **in-process**, with no browser:

```
Android  →  Credential Manager        →  Google ID token   ─┐
iOS      →  ASAuthorizationController →  Apple identity tkn ─┤
                                                            ▼
                              signIn("google-native" | "apple-native")
                              (a fetch made BY the WebView)
                                                            ▼
                      server verifies the token against the issuer's JWKS
                                                            ▼
                              Set-Cookie lands in the WebView
```

| File | Role |
|---|---|
| `src/lib/mobile/nativeSocialAuth.ts` | Plugin init, native login, credential teardown |
| `src/lib/mobile/oauth.ts` | Picks native vs browser-redirect per platform |
| `src/lib/mobile/signOutEverywhere.ts` | The single sign-out path for all surfaces |
| `src/lib/auth/oidcVerify.ts` | Shared JWKS signature / `iss` / `aud` / `exp` check |
| `src/lib/auth/googleIdToken.ts` | Google issuer + audience config |
| `src/lib/auth/appleIdToken.ts` | Apple issuer + audience config |
| `src/lib/auth/authOptions.ts` | `google-native` and `apple-native` providers |

Both native providers resolve through the same
`authService.findOrCreateOAuthUser()` the redirect flow uses, so a user who
signed up on the web lands on the identical account in the app.

**There is no browser fallback.** `supportsNativeSignIn()` returns `false` when
the platform's client ID is unset or the SocialLogin plugin is missing from the
binary — and the provider's button is then **hidden** (`useSignInAvailability`),
not pointed at a browser. See "Why the fallback was removed" below.

## Why the fallback was removed — App Store rejection, 11 Aug 2026

`startOAuth()` used to fall back to `Browser.open()` when a provider had no
native path. On iOS that path was always taken for Google, because
`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` was never set, so tapping "Continue with
Google" left the app for a browser. App Store review rejected 1.01 (build 9) on
an iPad Air 11-inch (M4) under **Guideline 4 – Design**, submission
`66544c21-ebd6-496d-9986-45f5c726fac9`:

> We noticed that the user is taken to the default web browser to sign in or
> register for an account, which provides a poor user experience.

The fallback was never functional anyway — the browser's cookie jar is not the
WebView's, so it signed the user in *in the browser* and left the app signed
out. It is gone:

| Situation | Before | Now |
|---|---|---|
| Provider has a native path | Native sheet | Native sheet (unchanged) |
| Provider has none, native app | `Browser.open()` → left the app | Button is **not rendered** |
| Provider has none, tapped anyway | — | `NativeSignInUnavailableError`, message points at email sign-in |
| Web browser | NextAuth redirect | NextAuth redirect (unchanged) |

`src/lib/mobile/useSignInAvailability.ts` resolves availability in an effect, so
the server render and first client render agree; until it resolves the button is
not rendered, so an unusable provider is never tappable even for one frame.
`SocialSignInButtons` owns the "or" separator and disappears with the buttons,
so the form does not end up with a separator above an empty gap.

Email and password sign-in, registration, and the six-digit email verification
are entirely in-app and always available, so hiding a provider never leaves a
user without a way in. Account deletion — required by guideline 4 for any app
that offers account creation — is on `/account` (`DeleteAccountCard`) plus the
public `/delete-account` page.

## Enabling native Google on iOS (build 10)

Native Google on iOS **is in-app** — `GoogleSignIn` presents an
`ASWebAuthenticationSession` sheet over the app, which is what Apple asks for.
It is not the default browser, and it is not the thing that got build 9
rejected. What got build 9 rejected was the *absence* of this path, and the
`Browser.open()` fallback that filled the gap.

This mirrors the working iOS Google sign-in in the sibling TravyBuzz project
(`../travel_advisor/IOS_GOOGLE_LOGIN.md`), minus the custom Swift plugin —
RClipper already ships `@capgo/capacitor-social-login`, which wraps the same
GoogleSignIn SDK, so only configuration is missing.

**1. Create the iOS OAuth client.** Google Cloud Console (project `815687220043`,
the one that owns `GOOGLE_CLIENT_ID`) → APIs & Services → Credentials → Create
credentials → OAuth client ID → application type **iOS** → bundle ID
`com.rclipper.app`.

Use the **Xcode** bundle identifier, not the Capacitor `appId`, when the two
differ. For RClipper they happen to agree — `PRODUCT_BUNDLE_IDENTIFIER` in
`ios/App/App.xcodeproj/project.pbxproj` and `appId` in `capacitor.config.ts` are
both `com.rclipper.app` — but confirm in Xcode → App target → General before
creating the client. TravyBuzz has two different identifiers and picking the
wrong one silently produces a client Google never matches.

**2. Info.plist.** Run:

```bash
node scripts/set-google-ios-client-id.js <ios client id>
```

It derives the **reversed** form and writes it into `ios/App/App/Info.plist` →
`CFBundleURLTypes`, then prints the env lines for step 3. Re-running with a
different ID is safe.

The reversed form swaps the two dot-separated halves and drops the suffix:

```
815687220043-abc123.apps.googleusercontent.com
  -> com.googleusercontent.apps.815687220043-abc123
```

It must match exactly — a single wrong character opens the sheet and then
dead-ends with no useful error, which is why the script exists. `npx cap sync`
does not overwrite `Info.plist`, so this survives syncs.

`AppDelegate.swift` also offers incoming URLs to `GIDSignIn.sharedInstance.handle`
before Capacitor sees them, and `ios/App/Podfile` declares `pod 'GoogleSignIn'`
directly so that import resolves. GoogleSignIn 9 completes inside
`ASWebAuthenticationSession`, which captures its own callback, so this is a
safety net for the app-switch path rather than the main route — but it is what
Google's iOS guide asks for.

**3. Server env** (droplet `.env.local`):

```bash
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id>   # un-hides the button on iOS
GOOGLE_IOS_CLIENT_ID=<same value>                  # accepted `aud`, server-side
```

Both are required. Google mints the token against whichever client did the
sign-in — web/PWA and Android both get the **web** client ID in `aud`, iOS gets
the **iOS** client ID — which is why `googleAudiences()` in
`src/lib/auth/googleIdToken.ts` checks a *list*. `iOSServerClientId` (the web
client ID, passed in `ensureInitialised()`) registers the backend as a relying
party; it does **not** move `aud`.

**4. Publish the OAuth consent screen.** While it is in "Testing" only listed
test users can sign in, so an App Review account hits "access blocked" — a
rejection that looks nothing like its cause.

**5. Build.** `npx cap sync ios`, `cd ios/App && pod install`, open
`App.xcworkspace` (the workspace, not the project), archive as build 10.

### The client IDs are read at runtime, not baked in

`NEXT_PUBLIC_*` values are inlined into the JS bundle by `next build`. Editing
one and restarting the server changes nothing — the old value stays frozen in
the chunks, and the only symptom is a button that silently does not appear. That
has now cost this project two rounds: an empty `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
disabled native Google on Android, and a missing `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`
hid the Google button on iOS even after the droplet was rebuilt.

So the apps now ask the server:

    GET /api/mobile/auth-config
    -> { "google": { "webClientId": "...", "iosClientId": "..." },
         "apple":  { "serverConfigured": true } }

`src/lib/mobile/nativeAuthConfig.ts` fetches it once per page load and falls back
to the bundled `NEXT_PUBLIC_*` values if the request fails, so a network blip
does not hide every provider. `supportsNativeSignIn()` and
`SocialLogin.initialize()` both read from it.

Two consequences worth knowing:

* **A restart is enough.** Change `.env.local` on the droplet, restart the
  process, reload the app — no rebuild.
* **It is self-diagnosing.** Open
  `https://app.rclipper.com/api/mobile/auth-config` in any browser. An empty
  `iosClientId` means the *server* does not have the value, full stop — no need
  to reason about which build inlined what.

The route also falls back to the non-public names, so setting only
`GOOGLE_IOS_CLIENT_ID` and `GOOGLE_CLIENT_ID` is sufficient — the
`NEXT_PUBLIC_` twins are no longer required for the native apps.

Nothing secret is exposed. OAuth *client IDs* are public by design and already
shipped inside the JS bundle; client *secrets* never go near this route.

### Ordering — this matters

`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` is what makes the Google button appear on
iOS, and the Info.plist URL scheme is what makes it work. Set the env var only
once a build carrying the real scheme is the build people are running. Set it
early and installed copies of build 9 show a Google button that throws
`Your app is missing support for the following URL schemes` — a visible button
that does nothing, which is its own rejection (Guideline 2.1).

## Sign-out

`signOut()` alone is not a real sign-out in the native apps. Android Credential
Manager keeps the Google account cached, so the next "Sign in with Google"
silently reuses it — the user cannot switch accounts. `signOutEverywhere()`
therefore:

1. Unregisters the push token (`DELETE /api/mobile/push-device`)
2. Calls `SocialLogin.logout()` for google and apple (best effort)
3. Calls NextAuth `signOut()`

Login also passes `filterByAuthorizedAccounts: false` and
`autoSelectEnabled: false`, so the account picker always appears.

All four sign-out entry points use it: `Navbar` (desktop + drawer),
`account/SignOutButton`, and `DeleteAccountCard`.

## Rollout — the apps must be rebuilt

`@capgo/capacitor-social-login` is a **native** plugin: its Java/Swift code is
compiled into the app binary. The shells load the web app from `server.url`, so a
droplet deploy updates the JS inside the WebView instantly — but it cannot add
native code to an already-installed build. **Both stores need a new release.**

That creates a version skew: a web deploy is served to app versions built *before*
the plugin existed, whose Capacitor bridge has no SocialLogin implementation.
`supportsNativeSignIn()` therefore calls `Capacitor.isPluginAvailable("SocialLogin")`
first, and old installs fall back to the browser redirect — still broken sign-in
for them, but no worse than before, and no "plugin not implemented" crash. This
makes the deploy order safe either way, and stays useful permanently: users who
never update keep hitting current server code.

Recommended order:

1. Deploy the droplet (server + env vars). Nothing changes for existing installs.
2. Register the Android OAuth client in Google Cloud (below).
3. `npm install && npx cap sync`, then ship new Android and iOS builds.
4. Sign-in starts working on a device as soon as it has the new build.

Web sign-in is unaffected throughout — it never used the native path.

## Setup

### 1. Dependency

```bash
npm install                     # picks up @capgo/capacitor-social-login
npx cap sync
```

The plugin needs no manifest or `Info.plist` changes for these two providers.
On iOS, add the **Sign in with Apple** capability in Xcode if it is not already
on the target (it is required by App Store guideline 4.8 anyway).

### 2. Google Cloud Console — Android OAuth client

Credential Manager will not return a token unless an **Android** OAuth client
exists for the package + signing certificate, even though the ID token itself is
minted for the *web* client ID.

1. APIs & Services → Credentials → **Create credentials → OAuth client ID**
2. Application type: **Android**
3. Package name: `com.rclipper.app`
4. SHA-1 — **one client per signing certificate.** A certificate with no matching
   client makes Credential Manager reject with no account sheet at all:

   | Build | Certificate | Where to get the SHA-1 |
   |---|---|---|
   | Play / internal testing | Play App Signing | Play Console → Test and release → **App integrity** → App signing key certificate |
   | Sideloaded release APK | Upload key | `keytool -list -v -keystore android/upload-keystore.jks -alias <alias>` |
   | **Android Studio ▶ Run** | **Debug keystore** | `keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android` |

   The debug row is the one that catches people out: pressing Run in Android
   Studio installs a *debug* build signed with `~/.android/debug.keystore`, whose
   SHA-1 matches neither of the other two. Sign-in then fails on the dev machine
   while the Play build works.

You do **not** need the client secret for this client, and the Android client ID
is never referenced by the app — it exists purely so Google can match the package
and certificate. See the warning in step 3.

### 3. Environment

> **`NEXT_PUBLIC_GOOGLE_CLIENT_ID` must be the WEB client ID.** Not the Android
> one. Credential Manager takes it as its `serverClientId`, and an Android client
> has no secret, so passing it there is rejected before the account sheet ever
> appears — the sign-in button simply does nothing. The two IDs share a project
> prefix and differ only in the hash, so they are trivially easy to swap. The
> Android client ID belongs in `GOOGLE_ANDROID_CLIENT_ID` (server-side, an
> accepted `aud`) and nowhere else.

```bash
# same value as GOOGLE_CLIENT_ID (the web client ID) — not a secret
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<web client id>.apps.googleusercontent.com

# server-side only: an additional accepted `aud`. NOT the value above.
GOOGLE_ANDROID_CLIENT_ID=<android client id>.apps.googleusercontent.com

# iOS bundle ID — the `aud` of a native Apple identity token
APPLE_NATIVE_CLIENT_ID=com.rclipper.app

# optional: only if you enable native Google on iOS
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id>.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=<ios client id>.apps.googleusercontent.com
```

`APPLE_CLIENT_ID` (the Services ID) stays as-is for the web flow — both are
accepted as `aud`. Apple's `sub` is stable per user **per developer team**, and
the Services ID sits under the primary App ID, so the same person gets the same
`sub` on web and native and account linking works.

### 4. Verify

```bash
npm test -- tests/auth/googleIdToken.test.ts tests/auth/appleIdToken.test.ts
```

On device, the fix is confirmed when tapping "Continue with Google" shows the
**system account sheet** — not a browser — and the app itself lands on
`/dashboard`.

### 5. Debugging on device

`startOAuth()` logs a diagnostic line on every attempt, and both sign-in buttons
log and display the rejection rather than swallowing it. Watch for both:

```bash
adb logcat -c
adb logcat | grep -iE "\[auth\]|CredentialManager|GetCredential|SocialLogin"
```

`[auth] sign-in attempt {...}` reports which branch ran. Read it first:

| Field | Wrong value means |
|---|---|
| `platform: "web"` | The UA suffix is missing — the WebView is not the shell, or `appendUserAgent` was dropped |
| `pluginAvailable: false` | The installed binary predates the plugin — `npx cap sync` and rebuild |
| `supportsNative: false` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` was empty in the **deployed** build |
| `clientIdTail` | Must end in the *web* client's hash, not the Android client's |

Then the rejection itself:

| Log text | Cause |
|---|---|
| `[28444]` / "Developer console is not set up correctly" | No Android OAuth client for this build's package + SHA-1, **or** an Android client ID passed as `serverClientId` |
| `[28433]` / `NoCredentialException` | No Google account on the device — add one in Android Settings |
| `GetCredentialCancellationException` | User dismissed the sheet; handled silently, not an error |
| "not implemented" | `SocialLogin` missing from the binary — rebuild |

Note that the shells load their JS from `server.url`, so **UI-side changes only
reach the device after a deploy**. To iterate without deploying, build with
`CAP_SERVER_URL` pointed at a dev host. The `CredentialManager` lines are native
and appear regardless.

## Failure codes

Rejections are logged as `native_signin_rejected` with a `<provider>:<code>`
reason. No detail is returned to the client.

| Code | Meaning |
|---|---|
| `IdTokenMissing` | The app sent no token |
| `AudienceNotConfigured` | No client ID env var set — verification fails closed |
| `IdTokenInvalid` | Bad signature, wrong `iss`/`aud`, or expired |
| `EmailNotVerified` | Issuer does not attest the address; refused so it cannot claim an existing account by email |
| `IdTokenIncomplete` | No `sub` or no `email` |

`AudienceNotConfigured` on Apple almost always means `APPLE_NATIVE_CLIENT_ID` is
unset; `IdTokenInvalid` on Apple usually means it is set to the Services ID
rather than the bundle ID.

## App Links (still worth fixing)

Not on the sign-in path any more, but `https://app.rclipper.com/...` links still
will not open the app until `public/.well-known/assetlinks.json` contains the
**Play App Signing** SHA-256 (it currently has the local upload key). Keep both
fingerprints listed so local and Play builds both verify. Note also that the
manifest intent filter only claims `app.rclipper.com` — the apex `rclipper.com`
is not claimed at all. See `docs/ANDROID_APP_LINKS_SETUP.md`.
