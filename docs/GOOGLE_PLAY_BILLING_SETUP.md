# Google Play Billing Setup

RClipper's Android app uses one-time, consumable Google Play products for
credit top-ups. The app package is `com.rclipper.app`.

## Console blocker

Google Play Console currently requires the developer account to set up a Google
Payments merchant account before one-time products can be created.

Path:

```text
Play Console -> Monetise with Play -> Products
```

Follow the "set up a merchant account" prompt. This requires account, payments,
bank, tax, and business details that should be entered by the account owner.

## One-Time Products

Create these products after the merchant account is active:

| Product ID | Name | Type | Price |
| --- | --- | --- | --- |
| `com.rclipper.credits.50` | 50 RClipper credits | Consumable one-time product | THB 50 |
| `com.rclipper.credits.100` | 100 RClipper credits | Consumable one-time product | THB 100 |
| `com.rclipper.credits.200` | 200 RClipper credits | Consumable one-time product | THB 200 |
| `com.rclipper.credits.500` | 500 RClipper credits | Consumable one-time product | THB 500 |
| `com.rclipper.credits.1000` | 1,000 RClipper credits | Consumable one-time product | THB 1,000 |

Suggested description for each product:

```text
Adds credits to your RClipper account for creating and unlocking video clips.
```

## Backend Credentials

The Android purchase verification service reads these environment variables:

```text
GOOGLE_PLAY_CLIENT_EMAIL=
GOOGLE_PLAY_PRIVATE_KEY=
GOOGLE_PLAY_PACKAGE_NAME=com.rclipper.app
```

The service account must have access to the Android Publisher API for this Play
Console app.

## Code References

- Product IDs and prices: `src/config/mobilePurchases.ts`
- Purchase verification and consumption: `src/services/MobileStorePurchaseService.ts`
- Verify endpoint: `src/app/api/mobile/purchases/verify/route.ts`
- Native purchase UI: `src/features/credits/components/MobileStoreTopup.tsx`
