# RClipper — App Store Connect submission and policy answers

Prepared from the repository on 25 July 2026. This is a repository-based
submission worksheet, not legal advice. Answers marked **Confirm** depend on
production configuration, business facts, or a signed release build and must not
be submitted until verified.

## 1. Product summary

RClipper is an account-based managed short-video production service. A requester
submits a production brief, place/business details, photos, and videos. Internal
staff and AI providers create scripts, generated narration, subtitles,
translations, animations, and final video exports. The requester reviews production
stages and downloads the result. RClipper may select reviewed content for publication
on RClipper-controlled channels under the accepted publication terms.

The iOS app is a Capacitor 6 WebView shell that loads `https://app.rclipper.com`.
Its bundle identifier is `com.rclipper.app`. Native capabilities include camera,
photo library, push notifications, sharing, Sign in with Apple, and
StoreKit consumable purchases.

## 2. App Information

| App Store Connect field | Recommended entry |
|---|---|
| Name | `RClipper` |
| Subtitle | `AI short-video production` |
| Primary language | English (U.S.), unless Thai is the actual primary support language |
| Bundle ID | `com.rclipper.app` |
| SKU | `rclipper-ios-001` (or the company's existing internal convention) |
| Primary category | Photo & Video |
| Secondary category | Business |
| Content Rights | **Yes, this app contains, shows, or accesses third-party content, and RClipper has or requires the necessary rights.** Users upload media and affirm ownership/licences/releases before submission; staff may publish selected reviewed content under the accepted licence. |
| Made for Kids | No |
| License agreement | Apple's standard EULA, with RClipper Terms and Content Ownership and Publication Rights Policy presented in-app |
| Privacy Policy URL | `https://app.rclipper.com/privacy` |
| Privacy Choices URL | `https://app.rclipper.com/delete-account` |
| Marketing URL | `https://app.rclipper.com` |
| Support URL | **Confirm/create a public support page.** Do not assume the homepage qualifies. Apple expects actual contact information. |
| DSA trader status | **Confirm with the legal entity/account holder.** A paid commercial service offered to EU consumers will usually be a trader; provide verified legal name, address, phone, and email if distributing in the EU. |
| Regulated medical device | Not applicable; the app is not Medical or Health & Fitness and provides no medical functionality. |
| Korea/China/Vietnam permits | Not applicable based on repository functionality, but availability and local business/legal requirements must be confirmed per storefront. |

Do not describe RClipper as a social network, general video editor, or automatic
publishing tool. Publication is selective and controlled by RClipper.

## 3. App Privacy

### Top-level answers

- “Do you or your third-party partners collect data from this app?” — **Yes**
- Tracking — **No**, based on the repository: no advertising SDK, IDFA access,
  data broker sharing, or cross-company targeted-advertising flow was found.
- App Tracking Transparency prompt — **Not required** while the production build
  has no tracking. Reassess if analytics/ads SDKs are added.

### Data types to select

For every type below, choose **Linked to the User: Yes**, **Used for Tracking: No**,
and **Purpose: App Functionality**, unless an additional purpose is stated.

| Category / data type | Select | Repository basis and purpose |
|---|---:|---|
| Contact Info — Name | Yes | Account full name; authentication, account management, email and production service |
| Contact Info — Email Address | Yes | Login, OAuth identity, verification, support, and service communications |
| Contact Info — Phone Number | No | No requester phone field or collection flow found |
| Contact Info — Physical Address | No | No requester home, mailing, street-address, or structured venue-address field is collected. The form asks for a place name and map point; a place name is represented by Other User Content. Reassess only if a future form stores a formatted street address. |
| Contact Info — Other User Contact Info | No | No other structured requester contact field found |
| Financial Info — Payment Info | No | StoreKit handles payment credentials; the server receives transaction/product identifiers, not card/bank details |
| Financial Info — Credit Info / Other Financial Info | No | App credits are an entitlement, not creditworthiness or personal finances |
| Location — Precise Location | No | The coordinates identify the business/place that is the subject of the video, not the user or device location. The app does not request Core Location or GPS permission. Treat the selected map point as Other User Content. |
| Location — Coarse Location | No | No separate coarse-location flow found |
| User Content — Photos or Videos | Yes | Core request uploads and generated/delivered media |
| User Content — Audio Data | No | Requesters can upload images and MP4 videos, but there is no current standalone voice/audio recording or audio-upload feature. Narration is generated by the service. An obsolete recorder remains in source but its APIs return HTTP 410 and the current pipeline never enters its recording state; remove that dead code and microphone permission before release. |
| User Content — Customer Support | Yes | Privacy policy states support communications are collected; AI safety reports and feedback are retained |
| User Content — Other User Content | Yes | Briefs, titles, descriptions, audience, style, language, subtitles, feedback, reports, and other free text |
| Identifiers — User ID | Yes | Internal account ID and OAuth provider account ID |
| Identifiers — Device ID | Yes | APNs push token/device registration is stored per signed-in user |
| Purchases — Purchase History | Yes | Product ID, store transaction ID, environment, date, credits granted, and credit ledger |
| Usage Data — Product Interaction | **Yes (conservative)** | Approval history, workflow actions, request status, and content feedback record how the user interacts with the service |
| Usage Data — Other Usage Data | No, unless production logging retains additional activity |
| Diagnostics — Crash Data | No | No crash-reporting SDK or retained crash telemetry was found |
| Diagnostics — Performance Data | No | No performance telemetry is transmitted or retained. Local/server `performance.now()` measurements are written only to the application console and are not user telemetry. |
| Diagnostics — Other Diagnostic Data | No | No diagnostic collection product or retained user-linked diagnostic dataset was found. The registration consent record does retain IP address and user agent as legal/security evidence; these are not used to measure technical diagnostics. Reassess their most appropriate Apple data type if production handling differs. |
| Search History | No | No user search-history store found |
| Browsing History | No | The shell is restricted to RClipper domains and does not provide unrestricted browsing |
| Contacts | No | No address-book access |
| Health, Fitness, Sensitive Info | No | No structured collection requested by the app |
| Advertising Data | No | No advertising |
| Environment Scanning, Hands, Head | No | No such APIs/features |

All selected types are used for **App Functionality**. Also select:

- **Product Personalization** for request briefs, uploaded media, audio, location,
  and other user content if App Store Connect treats creating a video tailored to
  the user's instructions as personalization. This is a defensible conservative
  choice, but App Functionality alone is also reasonable because customization is
  the core service rather than content recommendations.
- **Other Purposes** only if the production operator actually uses retained media
  or records beyond delivery, moderation, legal compliance, security, and selected
  licensed publication. Do not select Analytics or Marketing based only on current
  source code.

### Privacy-manifest discrepancy

`ios/App/App/PrivacyInfo.xcprivacy` currently declares Email Address, User ID,
Photos/Videos, Audio Data, Precise Location, Purchase History, and Other User
Content. Before release, align it with the final App Store answers. At minimum,
remove **Audio Data** and **Precise Location** if the obsolete recorder is removed
and the form continues to collect only a venue map point. The repository indicates
likely missing declarations for **Name**, **Device ID**, **Customer Support**, and
potentially **Product Interaction**.
Also regenerate/sync dependency privacy manifests after the final CocoaPods build.

### Privacy-policy gaps to fix before submission

The policy is directionally consistent with the app, but should explicitly name:

- RClipper's legal entity/data controller, business contact address, and
  jurisdiction (the operator's address does not mean the app collects users'
  Physical Address);
- Apple StoreKit/APNs, Google/Apple authentication, DigitalOcean Spaces or the
  actual storage host, email provider, and the production AI/voice/video providers;
- the specific lawful bases and international-transfer mechanism where required;
- retention periods for accounts, purchases, consent/IP/user-agent records, push
  tokens, support/AI reports, generated outputs, backups, and deletion tombstones;
- children's/minimum-age policy;
- how users revoke push permission and publication consent, and the limits after
  third-party publication;
- whether service data is used to train RClipper or third-party AI models.

Do not promise “only data reasonably needed … should be transmitted”; replace
“should” with an accurate description of what production actually transmits.
Remove the policy's references to collecting requester voice recordings and entered
addresses if those obsolete features will not return. Keep the disclosures for
place names and selected venue map coordinates, described as request content rather
than the user's physical address or device location.

## 4. Age Rating questionnaire

Recommended repository-based answers:

### In-App Controls

| Question | Answer |
|---|---|
| Parental Controls | No |
| Age Assurance | No |

### Capabilities

| Question | Answer | Reason |
|---|---|---|
| Unrestricted Web Access | No | Navigation is restricted to RClipper domains; OAuth uses a system browser for a specific authentication flow |
| User-Generated Content | No | User uploads are part of a private managed production workflow, not broadly distributed inside this app |
| Social Media | No | No in-app public feed, discovery, likes, comments, or reposting |
| Social Media Disabled for Users Under 13 | No | No social-media capability |
| Messaging and Chat | No | Internal notes are staff-only and no user-to-user messaging exists |
| Advertising | No | No paid ads found |

### Content descriptors

Select **None** for profanity/crude humor, horror/fear, alcohol/tobacco/drugs,
medical/treatment information, health/wellness topics, mature/suggestive themes,
sexual content/nudity, graphic sexual content/nudity, cartoon/fantasy violence,
realistic violence, prolonged graphic/sadistic violence, guns/weapons, contests,
simulated gambling, gambling, and loot boxes.

This recommendation assumes moderation prevents prohibited source material and
generated output from being presented as part of the app experience. Because users
can upload arbitrary media, verify the signed build's moderation behavior and
production terms. If objectionable generated/uploaded content can remain viewable,
answer the applicable descriptors based on the highest actual frequency.

- Made for Kids: **No**
- Override to higher age rating: **Not Applicable**, unless the final Terms impose
  a minimum age above Apple's calculated rating. If the service is intended only
  for adult businesses, add and enforce that minimum age first, then override.
- Expected result from the answers above: the lowest general rating (subject to
  Apple's current regional calculation).

## 5. In-App Purchases

Create these as **Consumable** one-time products:

| Product ID | Credits |
|---|---:|
| `com.rclipper.credits.50` | 50 |
| `com.rclipper.credits.100` | 100 |
| `com.rclipper.credits.200` | 200 |
| `com.rclipper.credits.500` | 500 |
| `com.rclipper.credits.1000` | 1000 |

For each product:

- Reference name: `RClipper 50 Credits`, etc.
- Product type: Consumable.
- Display name: `50 Credits`, etc.
- Description: `Adds 50 credits to your RClipper account for eligible video production and download services.` Adjust the number per product.
- Review screenshot: show the native credit purchase screen, product, localized
  StoreKit price, and purchase button.
- Review notes: state that credits are consumable, personal, non-transferable, have
  no cash value, and are used for digital video-production/download entitlements.

Submit the initial IAP products with the app version. Configure App Store Server
Notifications if refunds/revocations must update entitlements. The repository
verifies transaction IDs and grants credits idempotently, but no iOS refund or
revocation reconciliation was found. **This is a release blocker** where refunded
consumables or disputed transactions must affect the credit ledger.

Native builds hide Stripe and the native top-up API rejects Stripe checkout. Verify
there are no links, buttons, web navigation paths, or marketing copy that steer iOS
users to external payment for the same digital credits/services.

## 6. Sign-in, accounts, and deletion

- Sign-in required: **Yes**
- Methods: email/password, Google, and Sign in with Apple.
- Sign in with Apple is present, satisfying the alternative-login requirement for
  an app that offers Google login, subject to signed-device testing.
- In-app requester account deletion: **Yes**, via Account settings.
- Public deletion URL: `https://app.rclipper.com/delete-account`.
- Deletion behavior: anonymizes requester PII, removes authentication identities,
  preserves legally necessary financial/consent records, and retains one-way hashes
  for trial/fraud prevention.

**Confirm:** OAuth deletion should also revoke tokens/authorizations where required,
not only delete local identity rows. The current source shows local account deletion;
provider-token revocation was not proven.

## 7. Export Compliance

The current `Info.plist` sets:

`ITSAppUsesNonExemptEncryption = false`

This is appropriate only if the signed app uses exempt standard encryption supplied
by the operating system/standard HTTPS libraries and contains no proprietary or
non-standard cryptography. No custom encryption implementation was found. Answer
that the app does **not use non-exempt encryption**, subject to checking the final
dependency graph and obtaining export counsel if distribution scope requires it.

## 8. Advertising identifier and tracking

- Does the app use the Advertising Identifier (IDFA)? **No**
- Does the app track users? **No**
- Does the app display advertising? **No**
- ATT authorization prompt included? **No / not needed**

Recheck the final native dependency list; a future analytics, attribution, social,
or advertising SDK can change all four answers.

## 9. Content rights, AI, moderation, and publication

Recommended review explanation:

> Users submit media and production instructions for a private managed video
> workflow. They must confirm that they own or hold all necessary licences,
> releases, and permissions. RClipper staff review production and may reject unsafe,
> unlawful, or infringing requests. AI-generated results can be reported in-app.
> Selected reviewed videos may be published only through RClipper-controlled
> channels under the Content Ownership and Publication Rights Policy accepted at
> submission. The iOS app itself has no public social feed or user-to-user messaging.

App Review may scrutinize the app as generative AI/UGC. Ensure the signed build has:

- visible reporting for objectionable or unsafe AI output;
- staff moderation and removal capability;
- contact information for rights/privacy complaints;
- filtering/rejection appropriate to the content the service can generate;
- no impersonation, voice cloning, or use of identifiable persons without consent;
- clear labelling where applicable law/platform policy requires AI disclosure.

## 10. App Review Information

### Demo access

Do not use repository seed credentials in production unless they are deliberately
provisioned as non-expiring review accounts with safe sample data.

Provide:

- requester demo username and password;
- a preloaded request with uploaded sample media and a completed downloadable video;
- enough credits or sandbox purchase instructions;
- any separate staff/admin credentials only if reviewer access is necessary;
- confirmation that email verification and 2FA are disabled/bypassed for the review
  account without weakening normal accounts.

### Suggested review notes

> RClipper is a managed short-video production service delivered through a Capacitor
> iOS app. Sign in with the provided requester demo account. The account contains a
> completed sample request so review does not depend on asynchronous AI processing.
> To test creation, open New Request, enter a brief, select or capture media, confirm
> content rights, and submit. Camera, photo-library, and notifications are requested
> only after an explanatory screen and only when the related feature is used. The
> app does not request location or microphone access. Digital credits in the iOS app
> are sold only through StoreKit consumable
> products; web Stripe checkout is hidden and rejected for native clients. Account
> deletion is available under Account. AI output can be reported from the request
> workflow. The app has no public social feed, user-to-user chat, ads, or tracking.

Add exact navigation steps, a real contact person, phone/email, and any sandbox
purchase caveats after testing the submitted build.

## 11. Product-page metadata draft

### Promotional text

`Turn your photos, clips, and business story into polished short videos with a managed AI-assisted production workflow.`

### Description

> RClipper is a managed short-video production service for businesses and creators.
>
> Submit your production brief, place details, photos, and video clips. Review the
> script, narration, animation, subtitles, and final video through a guided workflow.
> RClipper combines AI-assisted production with staff review to prepare polished
> video formats for popular social platforms.
>
> Features:
> - Guided video request briefs
> - Camera and photo-library uploads
> - AI-assisted scripts, narration, subtitles, and translations
> - Review and approval at key production stages
> - Multiple aspect-ratio exports
> - Push updates when production milestones are ready
> - Secure account controls and in-app account deletion
> - Consumable credits purchased through the App Store
>
> Publication outside RClipper is selective and governed by the content rights and
> publication terms shown before submission.

### Keywords

`video,short video,content creator,business video,subtitles,narration,social media,AI video`

Check the final UTF-8 byte count in App Store Connect and remove any terms Apple
considers duplicative or misleading.

### Copyright

`2026 [CONFIRM LEGAL ENTITY NAME]`

### Screenshots

Use real signed-build screens showing:

1. requester dashboard;
2. new request brief;
3. photo/video selection;
4. script or scene review;
5. production progress;
6. final video preview and formats;
7. StoreKit credit products;
8. account/privacy controls.

Do not show seed data, internal staff tools, hard-coded prices, unsupported social
platform claims, or publishing outcomes that are not guaranteed.

## 12. Native permissions and capabilities

| Capability | Status / required submission answer |
|---|---|
| Camera | Used only for user-initiated request capture; purpose string present |
| Photo Library read | Used for user-selected request media; purpose string present |
| Photo Library add | Used only when user saves a finished video; purpose string present |
| Microphone | **Not used by the current product.** The current pipeline generates narration with TTS, and both legacy recording endpoints return HTTP 410. Remove the dead browser recorder and `NSMicrophoneUsageDescription` before submission so the binary and form consistently answer No. |
| Push Notifications | Used for authenticated production-status alerts; explanatory pre-prompt documented |
| Location Services | No device location permission string found; coordinates appear manually selected. Do not claim GPS/background location. |
| Background modes | Push entitlement exists; verify the signed target and provisioning profile |
| In-App Purchase | Required; verify capability and StoreKit products in signed sandbox testing |

## 13. Release blockers and confirmations

Do not submit until these are resolved:

1. Align `PrivacyInfo.xcprivacy`, the App Privacy form, the public privacy policy,
   and actual production logs/third-party processors.
2. Create/verify a public Support URL with legally sufficient contact information.
3. Confirm legal entity, copyright owner, DSA trader status, storefront availability,
   and minimum user age.
4. Test Sign in with Apple end-to-end and confirm account/provider revocation behavior.
5. Test all StoreKit products and ensure no native external-purchase steering path.
6. Implement or document App Store refund/revocation reconciliation.
7. Verify APNs entitlements, environment, token lifecycle, and notification behavior.
8. Verify camera/library denial and Settings recovery paths; remove the obsolete
   microphone permission and recorder path.
9. Confirm AI-provider data retention/training terms and name actual processors in
   the privacy policy.
10. Provision a stable review account with completed sample content.
11. Capture screenshots from the exact submitted build.
12. Run archive validation and inspect the final dependency privacy manifests and
    required-reason API declarations.

## 14. Evidence reviewed

- `capacitor.config.ts`
- `ios/App/App/Info.plist`
- `ios/App/App/PrivacyInfo.xcprivacy`
- `ios/App/App/App.entitlements`
- `src/app/(public)/privacy/page.tsx`
- `src/app/(public)/terms/page.tsx`
- `src/app/(public)/delete-account/page.tsx`
- `src/lib/auth/authOptions.ts`
- `src/services/AccountService.ts`
- `src/services/MobileStorePurchaseService.ts`
- `src/services/PushNotificationService.ts`
- `src/services/VideoGenerationService.ts`
- `src/lib/ai/*`
- `src/lib/social/*`
- `src/db/schema.sql` and mobile/account/location migrations
- request, account, upload, purchase, report, and push API routes
