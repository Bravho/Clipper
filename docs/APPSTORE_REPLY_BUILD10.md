# App Store Connect — reply for the Guideline 4 rejection

Submission ID: `66544c21-ebd6-496d-9986-45f5c726fac9`
Rejected: 11 Aug 2026, 1.01 (9), iPad Air 11-inch (M4)

**Do not send this until build 10 is uploaded and processed.** The reply names
build 10; sending it while build 9 is the only build attached invites a re-test
of the wrong binary.

---

## The reply

Hello,

Thank you for the review, and for the clear description of the problem.

**Guideline 4 — the user was taken to the default web browser to sign in**

You were right, and we have fixed it in build 10.

Our app signs in natively, but the "Sign in with Google" path on iOS was missing
a piece of configuration, and the code fell back to opening the system browser.
That fallback could never have worked — a browser does not share a session with
the app — so we have removed it from the app entirely. There is now no code path
in RClipper that opens an external browser to sign in or to register.

In build 10, every way of signing in or creating an account happens inside the
app:

1. **Sign in with Apple** — the native `ASAuthorizationController` sheet
   presented by the system.
2. **Sign in with Google** — Google's official iOS SDK, which presents its
   consent sheet over the app using `ASWebAuthenticationSession`. The app is
   never left and the session is established inside the app.
3. **Email and password** — sign in, account creation, and email verification
   (a six-digit code typed into a screen in the app) are all in-app.

**Account deletion**

Account deletion is already offered in the app, as required. A signed-in user
opens the **Account** screen from the navigation menu and taps **Delete
account**, which permanently deletes the account and its associated data. For
users who cannot sign in, we also publish a request page at
https://app.rclipper.com/delete-account.

**Demo account**

Email: `<REPLACE>`
Password: `<REPLACE>`

Please let us know if you need anything further.

Thank you,
The RClipper team

---

## Notes on the wording

Three deliberate choices, in case you want to adjust it:

**It concedes the point in the first line.** App Review responds badly to replies
that argue. The finding was correct, so saying so and moving to the remedy is
both true and the fastest route through.

**It names `ASWebAuthenticationSession` explicitly.** This is the detail that
distinguishes what you now ship from what was rejected. A reviewer who sees a
Google consent sheet appear could reasonably wonder whether it is a browser
again; naming the API tells them it is the system-sanctioned in-app one.

**It does not mention the internal cause** (a missing environment variable, the
`redirect: false` behaviour in next-auth). Reviewers do not need it, and detail
about how the bug happened reads as excuse-making rather than as a fix.

---

## Before you send — verified and unverified

Already verified from here:

- [x] The server is fully configured. `https://app.rclipper.com/api/mobile/auth-config`
      returns a real `webClientId`, a real `iosClientId`, and
      `apple.serverConfigured: true`.
- [x] The reversed URL scheme in `ios/App/App/Info.plist` matches the served
      `iosClientId` exactly (`...815687220043-i1h8oq01j0uun5u6odq4m4otdhen1oh9`).
      A mismatch here is the usual cause of a sheet that opens and dead-ends.
- [x] `CURRENT_PROJECT_VERSION` is 10 in both build configurations.
- [x] Account deletion exists at `/account` and `/delete-account`.

Still on you:

- [ ] **Upload build 10.** No build-10 archive exists yet — the newest is
      `RClipper-1.0.1-9.xcarchive` from 9 Aug. See the crash warning below.
- [ ] **Publish the OAuth consent screen** in Google Cloud. While it is in
      "Testing", only listed test users can sign in, so the reviewer's Google
      account would hit "access blocked".
- [ ] **Test on a real iPad**, since that is what they used. Tap Google → the
      sheet appears over the app, the app does not background, Safari does not
      open, and you land on `/dashboard` signed in. Back out of the sheet
      halfway → no red error banner.
- [ ] **Demo account** filled in above, is a **Requester** role so the reviewer
      lands on `/dashboard` rather than a staff screen, and is email-verified.
      Update App Review Information in App Store Connect to match.

---

## Urgent: build 9 currently crashes on the Google button

The server now returns `iosClientId`, which is what makes the Google button
appear. Build 9's `Info.plist` has no `CFBundleURLTypes` key — I confirmed this
in the shipped archive. GoogleSignIn responds to that with an **uncaught
NSException** (`GIDSignIn.m`: *"Your app is missing support for the following URL
schemes"*), which Swift cannot catch, so the app terminates.

So until build 10 is what reviewers are running, tapping Google on build 9
crashes the app — a worse rejection than the one you are answering.

I have added a guard for this: `MIN_IOS_BUILD_FOR_NATIVE_GOOGLE` in
`src/lib/mobile/nativeSocialAuth.ts` reads the running build number via
`App.getInfo()` and offers the Google button only to build 10 and above. Older
installs see Apple and email/password, exactly as they do today.

**This guard is not deployed yet.** Deploy it before anyone re-tests build 9. It
also permanently protects users who never update, and it means the env var and
the build no longer have to be rolled out in a particular order.
