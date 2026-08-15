# App Store Review — reply for Guideline 4 rejection

Submission ID: `66544c21-ebd6-496d-9986-45f5c726fac9`
Version: 1.01 (9) · Reviewed 11 Aug 2026 on iPad Air 11-inch (M4)

There are two ways to resolve this. Pick one, then use the matching reply below.

**Route A — re-test build 9 (fastest).** The fix is server-side, so it already
applies to the binary Apple has. iOS shows Sign in with Apple + email/password;
the Google button is hidden. Nothing to upload.

**Route B — upload build 10 with Google restored.** Requires the Google Cloud iOS
OAuth client, the reversed client ID in `Info.plist`, and the two server env
vars (see `docs/NATIVE_SIGN_IN.md` → "Enabling native Google on iOS"). Google
sign-in on iOS runs through `ASWebAuthenticationSession` — a system sheet
presented **over the app**, not the default browser — so it satisfies
Guideline 4 and keeps all three sign-in options.

Route A gets you approved sooner; Route B ships the feature. Doing A now and B in
the next release is the lowest-risk order.

---

## Route A — reply for re-testing build 9

Paste the block below into Resolution Center **after** the droplet deploy is live.
Fill in the two `<REPLACE>` lines first.

---

Hello,

Thank you for the review, and for pointing this out.

**Guideline 4 — being taken to the default browser to sign in**

You are right, and we have fixed it. Our app is designed to sign in entirely
in-app, but one path — "Sign in with Google" on iOS — was falling back to an
external browser because an iOS-specific configuration value was missing on our
server. We have now removed that browser fallback from the app completely. There
is no longer any code path that opens a browser to sign in or to register.

On iPad and iPhone, users sign in and create an account in one of two ways, both
of which happen entirely inside the app:

1. **Sign in with Apple** — the native `ASAuthorizationController` sheet
   presented by the system, inside the app. No browser is involved at any point.
2. **Email and password** — sign in, account creation, and email verification
   (the user enters a six-digit code on a screen in the app) all take place on
   screens inside the app.

Because our app's interface is served from our server, this fix is already live
and applies to the build you already have. **Please re-test build 9 (1.01)** —
no new binary is required. When you open the sign-in screen you will see
"Sign in with Apple" and the email/password form; the Google option that caused
the browser hop is no longer offered on iOS. We plan to restore Google sign-in in
a future release using Google's native in-app SDK, never an external browser.

**Account deletion**

Account deletion is already offered in the app. A signed-in user can open the
**Account** screen from the navigation menu and use **Delete account**, which
permanently deletes the account and its associated data. We also provide a public
deletion request page at https://app.rclipper.com/delete-account for users who
cannot sign in.

**Demo account for review**

Email: `<REPLACE — reviewer test account>`
Password: `<REPLACE>`

Please let us know if there is anything else you need from us.

Thank you,
The RClipper team

---

## Route B — reply when submitting build 10

Hello,

Thank you for the review.

**Guideline 4 — being taken to the default browser to sign in**

You are right. A configuration value was missing on iOS, so our Google sign-in
button fell back to opening an external browser. We have removed that fallback
from the app entirely — there is no longer any code path that opens a browser to
sign in or to register — and we have implemented Google sign-in natively.

In build 10, all three sign-in and registration options happen inside the app:

1. **Sign in with Apple** — the native `ASAuthorizationController` sheet.
2. **Sign in with Google** — Google's official iOS SDK, which presents an
   `ASWebAuthenticationSession` sheet over the app. The user never leaves
   RClipper, and the session is established in the app itself.
3. **Email and password** — sign in, account creation, and email verification
   (a six-digit code entered on a screen in the app).

**Account deletion**

Account deletion is already offered in the app. A signed-in user can open the
**Account** screen from the navigation menu and use **Delete account**, which
permanently deletes the account and its associated data. A public deletion
request page is also available at https://app.rclipper.com/delete-account.

**Demo account for review**

Email: `<REPLACE — reviewer test account>`
Password: `<REPLACE>`

Thank you,
The RClipper team

---

## Before sending — checklist

- [ ] Droplet deployed with the new build of the web app (this is what actually
      removes the browser hop; the binary is unchanged).
- [ ] `APPLE_NATIVE_CLIENT_ID=com.rclipper.app` present in the droplet's
      `.env.local`. Without it the server rejects native Apple tokens with
      `AudienceNotConfigured` and the reviewer has no social sign-in at all.
- [ ] **Route A only:** `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` left **unset**. Setting
      it early re-shows a Google button that build 9 cannot complete — GoogleSignIn
      throws "Your app is missing support for the following URL schemes" — which is
      a visible-but-dead button, its own rejection under Guideline 2.1.
- [ ] **Route B only:** iOS OAuth client created for bundle `com.rclipper.app`;
      the reversed client ID replaces `REPLACE_WITH_REVERSED_IOS_CLIENT_ID` in
      `ios/App/App/Info.plist`; `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` **and**
      `GOOGLE_IOS_CLIENT_ID` both set; OAuth consent screen **published** (while
      it is in Testing, the App Review account hits "access blocked");
      `npx cap sync ios` + `pod install`; archived from `App.xcworkspace`.
- [ ] `NEXT_PUBLIC_GOOGLE_CLIENT_ID` filled in with the **web** client ID (it is
      currently empty, which also silently disables native Google on Android).
- [ ] Verified on a real iPad: tap Sign in with Apple → system sheet appears, the
      app does not background, and you land on `/dashboard` signed in *in the app*.
- [ ] Verified on a real iPad: register a new account with email → six-digit code
      → sign in, with Safari never opening.
- [ ] Reviewer demo account exists, is a **Requester** role (so it lands on
      `/dashboard`, not a staff or admin screen), and is email-verified.
- [ ] App Review Information in App Store Connect updated with the same
      credentials.
