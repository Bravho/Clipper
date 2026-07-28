# Serving the app on rclipper.com (apex) alongside app.rclipper.com

**Goal:** `https://rclipper.com` is **the** address for web — it serves the full
RClipper app and *stays* in the URL bar. `https://app.rclipper.com` keeps
working unchanged but becomes plumbing for the shipped iOS/Android WebView
shells, not an address anyone is asked to remember or type.

Practical consequence of that split: the apex is canonical everywhere
user-facing — marketing, email links, share links, store listings, SEO — while
`app.` is retained purely for binary compatibility with builds already in the
App Store and Play Store. Step 8 is therefore not optional polish; it is how the
split gets enforced.

---

## Finding: the redirect is not in this repo

`grep -ri rclipper` across `src/`, `next.config.js` and `middleware.ts` turns up
**zero** hardcoded hostnames. There is no `redirects()` block in
`next.config.js`, and `src/middleware.ts` only does role routing with relative
paths. The app is host-agnostic.

So the `rclipper.com → app.rclipper.com` bounce is issued **above** the app, at
one of:

| Layer | Typical signature in `curl -sSI https://rclipper.com/` |
|---|---|
| Cloudflare Redirect/Page Rule | `server: cloudflare`, `301`, no `x-powered-by` |
| Registrar URL forwarding (Namecheap/GoDaddy) | `301` from a parking IP, odd `server:` header |
| nginx on the droplet | `server: nginx`, `301` with `Location: https://app.rclipper.com/` |
| DO App Platform / LB "primary domain" | `301` with DO edge headers |

**Everything below assumes we identify and remove that redirect first** — but
removing it alone is *not enough*, because two app-level settings will drag
users back to `app.rclipper.com` anyway. Those are steps 4 and 5.

---

## Step 1 — Diagnose the redirect layer (do this first, changes nothing)

Run from a normal terminal (not the sandbox — its egress is allowlisted):

```bash
dig +short rclipper.com          # apex A record — where does it point?
dig +short www.rclipper.com
dig +short app.rclipper.com      # expect 178.128.63.236 (the droplet)
dig +short NS rclipper.com       # Cloudflare? registrar? DO?

curl -sSI https://rclipper.com/  # read Location:, Server:, and any cf-ray header
curl -sSI http://rclipper.com/
```

The `Server:` header plus the nameservers identify the culprit unambiguously.
If `dig +short rclipper.com` returns the droplet IP, it is nginx and the fix is
in step 3. If it returns a Cloudflare or parking IP, the fix is in that
provider's dashboard.

---

## Step 2 — Remove the redirect, point the apex at the droplet

**DNS:**

- `rclipper.com` → `A 178.128.63.236`
- `www.rclipper.com` → `CNAME rclipper.com` (or the same A record)
- `app.rclipper.com` → unchanged, same droplet

**Delete** the forwarding/redirect rule at whichever layer step 1 identified.
Keeping a `www → apex` 301 is fine and conventional; only the apex → `app`
redirect goes away.

DNS first, then step 3 — certbot needs the A record resolving before it can
issue.

---

## Step 3 — nginx: serve the app on the apex

`docs/droplet-deployment.md` §6 documents a single server block at
`/etc/nginx/sites-available/rclipper` proxying to `127.0.0.1:3000`. Add the new
hostnames to it — one Next.js process serves all of them:

```nginx
server {
    server_name rclipper.com www.rclipper.com app.rclipper.com api.rclipper.com;
    client_max_body_size 512M;   # keep whatever is already there
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;   # needed for step 4
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP         $remote_addr;
    }
}
```

`X-Forwarded-Host` matters — step 4 reads it to know which hostname the visitor
actually typed.

Extend the TLS cert to cover the new names:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d rclipper.com -d www.rclipper.com \
                     -d app.rclipper.com -d api.rclipper.com
```

Optional `www → apex` normalisation, in its own block:

```nginx
server {
    server_name www.rclipper.com;
    return 301 https://rclipper.com$request_uri;
}
```

---

## Step 4 — `NEXTAUTH_URL` (the trap that undoes steps 1–3)

`.env.local` line 11:

```
NEXTAUTH_URL=https://app.rclipper.com
```

NextAuth v4 treats this as the single authoritative origin. It is used as
`baseUrl` in the `redirect` callback (`src/lib/auth/authOptions.ts:183`) and to
build OAuth callback URLs. Consequence today: a visitor on `rclipper.com` who
logs in gets sent to `https://app.rclipper.com/dashboard`. The URL bar changes
again and it looks like the redirect was never removed.

Naively flipping it to `https://rclipper.com` **breaks the mobile apps**:
`capacitor.config.ts` `allowNavigation` lists `app.rclipper.com` and
`*.rclipper.com`, and the wildcard does *not* match the bare apex — so the
WebView would treat post-login navigation as external and kick the user out to
Safari/Chrome.

**Fix: make the origin per-request.** `src/app/api/auth/[...nextauth]/route.ts`
already resolves options per request (for the Apple SameSite exception), so
there is a natural hook. Add a host allowlist and set the origin from the
incoming `X-Forwarded-Host` before delegating to NextAuth:

- allowlist: `rclipper.com`, `www.rclipper.com`, `app.rclipper.com`,
  `api.rclipper.com`, plus `localhost:3000` for dev
- unknown host → fall back to the `NEXTAUTH_URL` env value (fail closed)
- pass the resolved origin through `authOptionsForProvider(providerId, origin)`
  so the existing Apple cookie branch is preserved

Same treatment for the `redirect` callback so `baseUrl` follows the request host
rather than the env var.

Also update `APP_URL` (`.env.local:36`). Note: `grep` shows `APP_URL` is not
referenced anywhere in `src/` — it is currently cosmetic, so this is
housekeeping, not a functional change.

---

## Step 5 — Session cookie scope

Session cookies set on `rclipper.com` are not sent to `app.rclipper.com` and
vice versa. Two choices:

- **(a) Leave as-is.** Each hostname keeps its own session. Simplest, zero risk.
  A user logged in on the web who then opens the mobile app logs in again —
  which is already true today.
- **(b) Share sessions** by setting the session cookie `domain: ".rclipper.com"`
  in `authOptions.cookies`. Caveats: the apex must be added *carefully*
  alongside the existing Apple-only cookie override in
  `authOptionsForProvider()`, and **changing the cookie domain invalidates every
  existing session** — all users get logged out once, on deploy.

Recommend **(a)** for this change and treat (b) as a separate, deliberate
deploy if cross-host SSO is ever wanted.

---

## Step 6 — OAuth provider consoles (required, easy to forget)

Login from the apex 400s until these are registered:

- **Google Cloud Console** → OAuth client:
  - Authorised JavaScript origin: `https://rclipper.com`
  - Authorised redirect URI: `https://rclipper.com/api/auth/callback/google`
  - Keep the existing `app.rclipper.com` entries.
- **Apple Developer** → Services ID: add `rclipper.com` as a domain and
  `https://rclipper.com/api/auth/callback/apple` as a return URL.

---

## Step 7 — Mobile: what changes, what doesn't

**Deliberately unchanged.** `capacitor.config.ts` keeps
`server.url = "https://app.rclipper.com"`, so shipped builds are unaffected. No
resubmission required for this work.

Two safety items, both requiring a rebuild + resubmission — defer unless a
concrete need appears:

- `allowNavigation` does not include the bare `rclipper.com`. If any in-app link
  ever points at the apex, the WebView will punt it to the system browser.
  Adding `"rclipper.com"` to the array closes that hole.
- Universal/App Links are pinned to `app.rclipper.com` in
  `ios/App/App/App.entitlements` (`applinks:app.rclipper.com`) and
  `android/app/src/main/AndroidManifest.xml` (`android:host="app.rclipper.com"`).
  Apex links will not deep-link into the app. `public/.well-known/apple-app-site-association`
  is served by Next and will therefore be served on both hosts automatically —
  but the entitlement is the binding side, so the apex needs adding there too.

**Pre-existing gap, unrelated but noted:** `docs/MOBILE_STORE_COMPLIANCE.md:77`
references `/.well-known/assetlinks.json`, but `public/.well-known/` contains
only the AASA file. Android App Links verification (`autoVerify="true"`) cannot
be passing. Worth a separate ticket.

---

## Step 8 — Make the apex canonical (not optional)

Since `rclipper.com` is the address users are meant to remember, `app.` must
stop competing with it:

- **Canonical tag.** Add `metadata.metadataBase = new URL("https://rclipper.com")`
  plus `alternates.canonical` in the root layout (`src/app/layout.tsx`). Next 14
  emits `rel="canonical"` from this, so pages served on `app.rclipper.com` point
  search engines back at the apex.
- **De-index the subdomain.** In the nginx block, for `app.rclipper.com` only,
  `add_header X-Robots-Tag "noindex, nofollow" always;`. Belt and braces with
  the canonical tag — without it, Google may index and *show* the `app.` URL.
- **Outbound links.** Anything that emits an absolute URL should use the apex:
  `APP_URL` in `.env.local` (step 4), transactional email templates
  (`src/lib/email.ts` callers), and any share/deep links. Currently none of
  these hardcode a host, so this is mostly about setting `APP_URL` correctly
  and keeping it that way.
- **Store listings & marketing.** App Store / Play Store "marketing URL" and
  support URL should read `https://rclipper.com`, not `app.`.

---

## Verification

```bash
curl -sSI https://rclipper.com/          # 200, no Location header
curl -sSI https://www.rclipper.com/      # 301 → https://rclipper.com/
curl -sSI https://app.rclipper.com/      # 200, no Location header
curl -s   https://rclipper.com/.well-known/apple-app-site-association
```

Manual:

1. Log in with Google at `rclipper.com` — URL bar must still read `rclipper.com`
   at `/dashboard`.
2. Log in with credentials at `app.rclipper.com` — still lands on
   `app.rclipper.com`, unchanged.
3. Open the shipped iOS app — loads, logs in, no bounce to Safari.
4. `npm test` and `npm run build`.

## Risk summary

| Step | Risk | Reversible? |
|---|---|---|
| 1 diagnose | none | n/a |
| 2 DNS | apex briefly unresolvable during propagation | yes |
| 3 nginx + certbot | cert issuance can fail if DNS hasn't propagated | yes |
| 4 NEXTAUTH_URL | **highest** — a bug here breaks login on *all* hosts | yes, env + code revert |
| 5 cookies (option b) | logs out all users | one-way in practice |
| 6 OAuth consoles | additive only | yes |
| 7 mobile | untouched by default | n/a |
