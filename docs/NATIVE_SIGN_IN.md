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

**Fallback is preserved.** `supportsNativeSignIn()` returns `false` when the
platform's client ID is unset, and `startOAuth()` then uses the old browser
redirect. A missing env var degrades to today's behaviour instead of hard-failing.

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
4. SHA-1: the **Play App Signing** certificate, from
   Play Console → Test and release → **App integrity** → App signing key certificate
   — *not* your local upload key. Add the upload-key SHA-1 as a second client too
   if you also sideload debug builds.

You do **not** need the client secret for this client.

### 3. Environment

```bash
# same value as GOOGLE_CLIENT_ID (the web client ID) — not a secret
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<web client id>.apps.googleusercontent.com

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
