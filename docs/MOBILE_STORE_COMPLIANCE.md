# Mobile store compliance setup

The repository implements the code paths required for native camera capture,
actionable push notifications, StoreKit / Google Play Billing, AI-content
reporting, and public account-deletion requests. Store-console configuration and
signed-device testing are still required before submission.

## 1. Database

Apply:

```bash
node scripts/apply-migration.js src/db/migrations/015_mobile_store_compliance.sql
```

This creates push-device and delivery records, idempotent mobile purchase
records, AI-content reports, and updates the credit transaction constraint.

## 2. Store products

Create matching **consumable one-time products** in both App Store Connect and
Google Play Console:

| Product ID | Credits |
|---|---:|
| `com.rclipper.credits.49` | 49 |
| `com.rclipper.credits.98` | 98 |
| `com.rclipper.credits.296` | 296 |
| `com.rclipper.credits.490` | 490 |
| `com.rclipper.credits.980` | 980 |

Product titles, descriptions, and localized prices displayed in the app come
from StoreKit/Play Billing. Do not replace them with hard-coded prices.

Configure the App Store Server API and Google Android Publisher credentials
listed in `.env.example`. Google service-account access must be granted in Play
Console; creating a Cloud service account alone is insufficient.

Stripe remains available on the website. Native builds append
`RClipperNative/<platform>` to the user agent, hide Stripe checkout, and the
Stripe top-up API rejects native requests.

## 3. Push

Configure:

- APNs token key, team ID, bundle ID, and production/sandbox environment.
- Firebase project, Android app, `google-services.json`, and an FCM HTTP v1
  service account.
- The iOS Push Notifications capability and provisioning profile.

The user sees an explanatory prompt before the OS permission prompt. Tokens are
registered only for authenticated users. Pipeline notifications are stored with
a unique `(job_id, event_key)` constraint to prevent duplicate alerts.

## 4. Native projects

Run:

```bash
npx cap sync
```

On macOS, run CocoaPods through the normal Capacitor/Xcode workflow, add the
In-App Purchase and Push Notifications capabilities, and verify that
`App.entitlements` is signed into the target.

For Android, install Android SDK 35 or later. Google requires API 36 for new
submissions and updates beginning 31 August 2026, so upgrade Capacitor and set
API 36 before submissions on or after that date.

## 5. Associated links

Before enabling OAuth/deep-link return from an external browser, deploy:

- `https://app.rclipper.com/.well-known/apple-app-site-association`
- `https://app.rclipper.com/.well-known/assetlinks.json`

The files require the real Apple Team ID and Android release-certificate SHA-256,
so they cannot be generated safely from repository defaults.

## 6. Required device tests

- Camera allowed, denied, and later enabled from Settings.
- Library selection, large files, interrupted upload, retry, and duplicates.
- Notification foreground/background/terminated behavior and exact request link.
- Store sandbox/internal-track purchase, cancellation, pending payment, network
  failure after purchase, retry, duplicate callback, refund, and repurchase.
- Account deletion for password, Google, and Apple accounts.
- AI-result reporting and staff moderation operations.

Do not submit until both stores' privacy/data-safety forms match the production
data flows and the signed release builds pass these tests.

