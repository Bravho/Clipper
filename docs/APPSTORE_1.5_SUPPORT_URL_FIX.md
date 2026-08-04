# App Store Review — Guideline 1.5 (Support URL) Remediation

**Rejection received:** Guideline 1.5 — Safety
**Reviewer finding:** "The Support URL provided in App Store Connect, https://rclipper.com, does not direct to a website with information users can use to ask questions and request support."

---

## Root cause

The Support URL in App Store Connect was set to the site root, `https://rclipper.com`.

That URL serves the marketing landing page (`src/app/(public)/page.tsx`). It contains a
hero section, pricing tracks, audience segments, a 4-step explainer, a distribution
section, and a signup CTA — but **no contact information of any kind**. The global footer
(`src/components/layout/Footer.tsx`) linked only to Terms, Ownership, and Privacy.

There was no `/support` or `/contact` route anywhere in the app. The only contact
addresses in the codebase were buried inside the Privacy Policy body text and the
Delete Account page — neither reachable from the landing page, and neither presented
as a support channel.

A reviewer opening `https://rclipper.com` therefore had no way to ask a question or
request support. The rejection is accurate.

---

## Fix implemented

### New page: `/support`

**File:** `src/app/(public)/support/page.tsx`

A public, unauthenticated support page. It is inside the `(public)` route group and is
**not** matched by `src/middleware.ts` (matcher covers only `/dashboard`, `/admin`,
`/account`), so it renders for signed-out visitors and for App Review.

Contents, mapped to what Guideline 1.5 asks for:

| Requirement | How it is met |
|---|---|
| A way to ask questions | Support email `pillarth@gmail.com`, as a clickable `mailto:` link |
| Stated responsiveness | "We reply to every email within 2 business days" |
| Support hours | Mon–Fri 09:00–18:00 GMT+7 |
| Self-service help | 6-item FAQ: delivery time, credits, sign-in/verification, social account connect/disconnect, account deletion, refunds |
| Guided contact | 6 pre-filled `mailto:` topic links (account, billing, request issue, publishing, content/privacy, deletion) |
| Triage detail | "What to include in your message" checklist (account email, request ID, platform, expected vs. actual, screenshot) |
| Policy access | Links to Terms, Privacy, Ownership, Delete Account, Sign in |

The page is bilingual (English + ไทย) so the reviewer reads English while Thai
customers get their own language.

### Wiring

- `src/config/routes.ts` — added `SUPPORT: "/support"` and `DELETE_ACCOUNT: "/delete-account"`.
- `src/components/layout/Footer.tsx` — added a Support link as the first footer nav item.
  The footer is rendered in the root layout, so **Support is now reachable from every
  page on the site, including `https://rclipper.com` itself**. This matters: even if a
  reviewer only checks the root URL, they now find a support path.
  Also added `flex-wrap` so the extra link does not overflow on narrow screens.
- `src/i18n/messages.ts` — added `footer.support` for all three locales
  (th: "ฝ่ายสนับสนุน", en: "Support", vi: "Hỗ trợ").
- `src/components/layout/DashboardShell.tsx` — the sidebar "Contact support" link now
  points to `/support` instead of a bare `mailto:`, giving signed-in users the FAQ too.

---

## What you must do in App Store Connect

**Support URL is version-level metadata**, not app-level. It lives on the version page
under *General Information* — **not** under "App Information". (App Information holds
the Privacy Policy URL, name, subtitle, category, and age rating. Different screen.)

Step by step:

1. Sign in at <https://appstoreconnect.apple.com> with an account holding the
   **Account Holder**, **Admin**, **App Manager**, or **Marketing** role. Developer and
   Finance roles cannot edit this field.
2. Click **Apps**, then select **RClipper**.
3. In the **left sidebar**, find the platform section (**iOS App**) and click the
   version underneath it — it will read something like **"1.0 Rejected"** or
   **"1.0 Prepare for Submission"**. Clicking the version is the step people miss;
   do not stay on the default landing screen.
4. Scroll down past Screenshots, Promotional Text, Description, and Keywords to the
   **General Information** section.
5. Find the **Support URL** field. It currently reads `https://rclipper.com`.
6. Replace the full contents with — including the `https://` protocol:

   ```
   https://rclipper.com/support
   ```

7. Optionally set **Marketing URL** to `https://rclipper.com` on the line below. That
   field is the correct home for your landing page, and is optional.
8. Click **Save** in the top-right corner. Confirm the "Saved" confirmation appears —
   if the button stays greyed out, the field did not register a change.
9. Go to **App Information** in the same sidebar and confirm **Privacy Policy URL** is
   `https://rclipper.com/privacy`.
10. Return to the version page and click **Add for Review** / **Submit for Review**.
11. In **App Review** → the rejection message thread, reply with the text below so the
    reviewer knows what changed and does not simply re-test the old URL.

### Notes

- If **Support URL is greyed out**, the version is locked in an active review. Use
  **App Review → Cancel Submission** first, edit, then resubmit.
- The Support URL can be changed at any time — including while the app is live — and
  does not by itself require a new binary or a new build upload.
- Localized metadata: if you have added Thai and English localizations, the Support URL
  is **per-localization**. Use the language dropdown at the top of the version page and
  set the URL for *every* language you have configured. A stale URL left on one
  localization can trigger the same rejection.

### Deploy first

The `/support` route must be **live in production before you resubmit**. A reviewer
hitting a 404 will re-reject under the same guideline. Deploy, then load
`https://rclipper.com/support` in a private/incognito window to confirm it renders
signed-out.

### Suggested reply to App Review

> Thank you for the review. We have added a dedicated support page at
> https://rclipper.com/support and updated the Support URL in App Store Connect to
> point to it. The page is publicly accessible without an account and provides our
> support email address, our stated response time and support hours, a checklist of
> what to include when contacting us, topic-based contact links, and a FAQ covering
> account access, credits and billing, video delivery, social account connections,
> and account deletion. A "Support" link has also been added to the footer of every
> page on rclipper.com.

---

## Before you resubmit — verify

- [ ] `https://rclipper.com/support` loads in a signed-out incognito window
- [ ] The `mailto:` links open a composer addressed to `pillarth@gmail.com`
- [ ] **`pillarth@gmail.com` is monitored and actually replies** — Apple has been known
      to send a test message. An unanswered support address can trigger a repeat 1.5
      rejection
- [ ] The Support link appears in the footer of `https://rclipper.com`
- [ ] Support URL in App Store Connect is updated and saved
- [ ] All policy links on `/support` resolve (no 404s)

---

## Recommended follow-up (not required for this rejection)

- **Move support to a domain address.** `pillarth@gmail.com` is a personal Gmail on a
  company support page. `support@rclipper.com` reads as more legitimate to reviewers
  and to customers, and `src/lib/email.ts` already sends from the `rclipper.com`
  domain, so the DNS is in place. Note `src/services/PushNotificationService.ts`
  already references `support@rclipper.com` as its VAPID subject — the two are
  currently inconsistent.
- **Add a LINE Official Account.** LINE is the dominant support channel for Thai SMB
  customers; email alone is a weak channel for this market.
- **Consider an in-app contact form** so users can reach support without leaving the
  app or owning a mail client.
- **Unify the contact address.** It currently appears hardcoded in four places
  (`/support`, `/privacy`, `/delete-account`, `DashboardShell`). Consider a single
  constant in `src/config/` so a future change is one edit.
