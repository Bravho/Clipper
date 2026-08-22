# Google Play closed test — Android 1.0.6 (7)

Prepared: 21 August 2026

## Upload artifact

- File: `artifacts/google-play/RClipper-1.0.6-7-release.aab`
- Package: `com.rclipper.app`
- Version code: `7`
- Version name: `1.0.6`
- Target API: `36`
- SHA-256: `F1607D9184C86EE5EA68A5DC86AFF3FEEA9345D553F156B6FF7C573C687C6EC9`
- Signing verification: passed with the existing RSA upload key

The Play Console app may have a different store-listing title, but its package
must be `com.rclipper.app`. The installed Android app label in this bundle is
`RClipper`.

## Prepared release notes

Paste the matching locale file into the release's **What's new** field:

- English (United States): `play-store-assets/closed-testing/whatsnew-en-US.txt`
- Thai: `play-store-assets/closed-testing/whatsnew-th-TH.txt`

Suggested release name: `Closed test 1.0.6 (7)`

## Console setup and upload

1. Open Play Console and select the app whose package is `com.rclipper.app`.
2. Finish every required item under **Dashboard > Set up your app**. Closed
   testing is unavailable until the app setup is complete.
3. Go to **Test and release > Testing > Closed testing**.
4. Use the existing closed track, or create one named `closed-alpha`.
5. Open the **Testers** tab. Select **Email lists** or **Google Groups**, add the
   tester list/group, and enter a monitored feedback email or URL.
6. Save the tester configuration. Copy the opt-in link, but send it only after
   the release becomes available.
7. Open the track's **Releases** tab and choose **Create new release**.
8. Keep the existing Play App Signing configuration. Do not request a signing
   key change for this update.
9. Upload `artifacts/google-play/RClipper-1.0.6-7-release.aab`.
10. Confirm Console reports package `com.rclipper.app`, version code `7`, version
    name `1.0.6`, and no blocking error.
11. Set the release name to `Closed test 1.0.6 (7)` and paste the prepared
    localized release notes.
12. Choose **Next** or **Review release**, resolve every blocking error, and
    review the device catalog and pre-launch report warnings.
13. Choose **Start rollout to Closed testing** and confirm the rollout. This
    publishes only to opted-in testers, not to production.

## Tester invitation

Send the opt-in link with this text:

> Please open this link with the Google account registered for the test, choose
> **Become a tester**, then install or update the app from Google Play. Please
> test sign-up/sign-in, notification permission, creating a request, media
> upload, and sign-out/sign-in. Send the device model, Android version, steps,
> screenshot, and approximate time for any problem to the feedback address.

Testers cannot find an unpublished closed-test app by Play Store search. They
must use the opt-in link and the same Google account that is on the tester list
or in the configured Google Group.

## Closed-test readiness checks

- Keep at least 12 testers opted in continuously for 14 days if this is a
  personal developer account created after 13 November 2023 and production
  access has not yet been granted.
- Ask testers to genuinely use the app and provide feedback during the period;
  Google asks about engagement and the changes made from testing when applying
  for production access.
- A tester enrolled in internal testing must opt out of internal testing before
  becoming eligible for the closed track.
- Verify the production site at `https://app.rclipper.com` is deployed and the
  permanent reviewer/test accounts work before rollout.
- Complete App access, Ads, Content rating, Target audience, Data safety, and
  the store listing. Native push now collects an FCM registration token; review
  the device-identifier disclosure described in `docs/PUSH_NOTIFICATIONS_SETUP.md`.
- After rollout, check **Testing > Pre-launch report**, Android vitals, crash and
  ANR results, and tester feedback before promoting the build.

## Suggested test pass

1. Fresh install and launch on Android 8, a current Android phone, and a tablet.
2. Email/password, Google, and Apple sign-in; sign out and sign in again.
3. Allow and deny notification permission, then reopen the app.
4. Create a request and upload supported photo/video/audio files.
5. Put the app in the background and return; verify session and navigation.
6. Test slow/offline recovery and confirm the app does not crash.
7. Confirm account/support/privacy links and account-deletion access.

