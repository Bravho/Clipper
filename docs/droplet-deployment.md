# RClipper — Droplet deployment (web + mobile backend)

> Plan / runbook. 2026-07-05. Target: fresh Ubuntu droplet `178.128.63.236`, run
> the Next.js app under **pm2** (not Docker), behind **nginx + TLS**, as the shared
> backend for the web app **and** the new mobile app. Job/request state is the
> managed Postgres; media is DO Spaces `sgp1`; heavy render steps offload to the
> Mac Mini worker when its heartbeat is fresh, else run inline on the droplet.
>
> Assumes: the droplet is **still blank**. The code is currently only on your dev
> machine (this repo) — §0.5 covers getting it onto the droplet; you run the git
> commands yourself. Migration 010 is **already applied** to the shared Postgres.

---

## 0. Before you touch the droplet — decisions & facts to have ready

1. **A domain name (required for mobile).** Native mobile apps refuse plain HTTP by
   default (iOS App Transport Security, Android cleartext blocked). You need a
   hostname with a real TLS cert — a raw IP + self-signed will not work in a
   shipped app. Pick e.g. `api.rclipper.com` (backend) and point an **A record →
   `178.128.63.236`**. If the web app has its own host (e.g. `app.rclipper.com`),
   point that at the same droplet too. Do the DNS change first so the cert step
   later just works.
2. **Managed Postgres trusted sources.** In the DO/RDS console, make sure the
   droplet's IP (`178.128.63.236`) is allowed to connect. `src/lib/db.ts` already
   uses SSL (`rejectUnauthorized:false`), so no cert bundling is needed.
3. **Secrets on hand:** `NEXTAUTH_SECRET` (generate fresh), Spaces key/secret,
   `PG*` creds, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, Google OAuth client
   id/secret, and the social-publishing tokens. Same values as the Mac's
   `.env.local`, plus the two URL vars re-pointed at the public domain.
4. **Droplet size / RAM.** A production Next build + Remotion bundling is
   memory-hungry. If this droplet is ≤ 2 GB RAM, add swap in §1 or the build can
   OOM-kill.

---

## 0.5. Get the code onto the blank droplet (you run git; I won't)

The code is on your dev machine at commit `18c4207` (Phase 1–3). The droplet is
empty. Pick one path:

**Path A — clone from GitHub (preferred, if the commit is on `origin/main`).**
Since you were able to pull `18c4207` onto this machine, it is almost certainly
already on `github.com/Bravho/Clipper.git`. On the droplet:

```bash
cd ~ && git clone https://github.com/Bravho/Clipper.git
cd Clipper && git log --oneline -1     # expect 18c4207 … Phase 1-3
```

Use `/path/to/Clipper` in the sections below = `~/Clipper` (or wherever you cloned).
Private repo → use a fine-grained PAT or a read-only deploy key for the clone.

**Path B — copy straight from your dev machine (if GitHub push is still 403 and
the commit never landed on origin).** From the **dev machine**, push the tree to
the droplet (the droplet accepts inbound SSH; the Mac's outbound-only limit does
not apply here). From this repo directory:

```powershell
# from D:\coding\clipper_agent on your dev machine
scp -r . deploy@178.128.63.236:~/Clipper     # or use rsync/WinSCP
```

Exclude `node_modules` and `.next` from the copy — you'll rebuild those on the
droplet in §5. (`rsync -a --exclude node_modules --exclude .next ./ deploy@178.128.63.236:~/Clipper/`
if you have rsync.)

Either way, **do not** copy your dev `.env.local` blindly — you'll write a
droplet-specific one in §4 (different `NEXTAUTH_URL`/`APP_URL`).

---

## 1. Provision the base OS

SSH in as root (or your sudo user) and harden the box.

```bash
# --- packages & updates ---
apt update && apt -y upgrade
apt -y install build-essential git curl ufw nginx

# --- a non-root deploy user (skip if you already have one) ---
adduser deploy && usermod -aG sudo deploy
# copy your SSH key to deploy, then log back in as deploy for the rest

# --- swap (do this if RAM <= 2 GB; harmless otherwise) ---
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# --- firewall: SSH + HTTP + HTTPS only ---
ufw allow OpenSSH
ufw allow 'Nginx Full'      # opens 80 + 443
ufw --force enable
```

The app port **3000 stays closed to the internet** — nginx proxies to it on
localhost. The Mac worker needs **no** inbound rule (it's outbound-only; it reaches
Postgres and Spaces itself).

---

## 2. Node, pm2, and build toolchain

Use Node 20 LTS (Next 14 + Remotion 4 supported; avoids odd 22 edge cases).

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node -v          # expect v20.x
sudo npm i -g pm2
```

---

## 3. System deps for the **inline render fallback**

This is the step people miss. The render-queue seam only offloads to the Mac when
a worker heartbeat is fresh (`RENDER_WORKER_FRESH_SECONDS`, default 45 s). **Any
time the Mac is offline, the droplet runs the heavy step itself** — so the droplet
must be able to run FFmpeg and Remotion, or those fallback renders fail.

```bash
# FFmpeg for composition / subtitle burn-in
sudo apt -y install ffmpeg
ffmpeg -version | head -1

# Headless-Chromium shared libraries Remotion needs to render
sudo apt -y install \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 fonts-liberation

# writable scratch dir referenced by FFMPEG_TMP_DIR
sudo mkdir -p /tmp/clipper && sudo chown deploy:deploy /tmp/clipper
```

Remotion downloads its own Chromium on first render; the libs above are what that
Chromium links against. (If you would rather the droplet **never** render and
always wait for the Mac, you can instead leave these out and accept that heavy
steps stall while the worker is down — not recommended for a production backend.)

---

## 4. Environment file

Put everything in **`.env.local` at the repo root** (Next loads it in production;
same convention as the Mac worker via `scripts/bootstrapEnv.ts`). Copy the Mac's
values, then change the two URL vars and confirm the render-queue vars.

```bash
cd /path/to/Clipper          # wherever you pulled it
cp .env.example .env.local
nano .env.local
```

Must-set / must-change for the droplet:

| Var | Value | Note |
|---|---|---|
| `NEXTAUTH_URL` | `https://api.rclipper.com` | **public https origin**, not localhost — NextAuth builds callback URLs from this |
| `APP_URL` | `https://api.rclipper.com` | keep aligned with the above |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | fresh strong value |
| `NODE_ENV` | `production` | |
| `PGHOST/PGDATABASE/PGPORT/PG_USER/PG_PASSWORD` | managed PG creds | same DB the Mac worker uses |
| `DO_SPACES_*` | Spaces creds + `sgp1` | same bucket as the worker |
| `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, … | pipeline keys | needed for inline fallback + non-heavy steps |
| `FFMPEG_TMP_DIR` | `/tmp/clipper` | writable dir from §3 |
| `RENDER_QUEUE_ENABLED` | `true` (default) | leave on so the droplet enqueues when the Mac is alive |

Render-queue knobs default sensibly (`RENDER_WORKER_FRESH_SECONDS=45`,
`RENDER_STALE_CLAIM_SECONDS=600`); only override if you have a reason. **Do not**
set `DO_SPACES` writes to private / change ACL — the `ACL:"public-read"`
privatisation is deferred (see `storage-lifecycle-design.md` B.6).

> Google OAuth: the redirect URI must match the new origin —
> `https://api.rclipper.com/api/auth/callback/google` — add it in the Google Cloud
> console (§7) or Google login will fail.

---

## 5. Build and run under pm2

```bash
cd /path/to/Clipper
npm ci                       # clean install from package-lock
npm run build                # production build (watch for OOM → §1 swap)
```

Create a pm2 ecosystem file so restarts are reproducible:

```js
// ecosystem.config.js  (repo root)
module.exports = {
  apps: [{
    name: "rclipper-web",
    script: "npm",
    args: "run start",          // next start, listens on 3000
    cwd: __dirname,
    instances: 1,               // single instance: keeps SSE (/stream, pipeline-status) simple
    exec_mode: "fork",
    max_memory_restart: "1G",
    env: { NODE_ENV: "production", PORT: "3000" },
  }],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save                       # persist the process list
pm2 startup systemd            # prints a command — run it to auto-start on reboot
pm2 logs rclipper-web          # confirm it booted, listening on :3000
```

**On every future redeploy** (after you `git pull` yourself):
`npm ci && npm run build && pm2 restart rclipper-web`.

> Keep a single instance for now. Cluster mode would round-robin the Server-Sent
> Events streams (`/api/requests/[id]/stream`) across workers and break live
> pipeline updates. Scale later with sticky sessions if needed.

---

## 6. nginx reverse proxy + TLS

Proxy the public hostname to `localhost:3000`. The **upload size limit** matters —
nginx defaults to 1 MB and will reject photo/video uploads without this.

```nginx
# /etc/nginx/sites-available/rclipper
server {
    server_name api.rclipper.com;      # + app.rclipper.com if same box

    client_max_body_size 512m;         # allow large uploads (tune to your cap)
    proxy_read_timeout 300s;           # long AI/render requests

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;         # SSE / websockets
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;                            # don't buffer SSE
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rclipper /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS via Let's Encrypt (edits the server block to add 443 + redirect)
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d api.rclipper.com   # add -d app.rclipper.com if used
```

Certbot installs the cert and a renewal timer. After this, `https://api.rclipper.com`
serves the app.

---

## 7. Finish the auth wiring

1. **Google OAuth:** in Google Cloud console → Credentials → your OAuth client, add
   authorized redirect URI `https://api.rclipper.com/api/auth/callback/google` and
   authorized origin `https://api.rclipper.com`.
2. Confirm `.env.local` `NEXTAUTH_URL` / `APP_URL` are the same https origin, then
   `pm2 restart rclipper-web`.
3. Smoke-test: open `https://api.rclipper.com`, log in with a seed account
   (`user@example.com` / `password123`), reach the dashboard.

---

## 8. Verify the enqueue → Mac-worker loop (task #1 acceptance)

The whole point of getting this code onto the droplet: it's the droplet that
**decides to enqueue**. With the Mac worker running and heartbeating (~10 s):

1. Log in on the droplet's site, submit a test request, drive it to the first
   heavy step (start production / analyze → base-video generation).
2. On the **Mac**, `tail -f ~/Library/Logs/rclipper/worker.out.log` should show:
   ```
   claimed step {"job":"…","step":"montage_all_segments",…}
   step done   {"job":"…","step":"…","seconds":NN.N}
   ```
3. The web UI advances through the approval gates to a final clip in all four
   ratios (9:16, 16:9, 1:1, 4:5).

Resilience (from `docs/mac-worker-launchd.md` §4):
- **Kill the worker mid-job** → after `RENDER_STALE_CLAIM_SECONDS` (600 s) the claim
  goes stale and the next worker run reclaims and resumes it.
- **Stop the worker entirely** → after `RENDER_WORKER_FRESH_SECONDS` (45 s) with no
  heartbeat, the droplet stops enqueuing and runs the step **inline** (this is why
  §3's ffmpeg/Chromium libs must be present) — the pipeline still completes.

---

## 9. Serving both web **and** mobile from this backend

The web app already works against this droplet (cookie sessions, same origin). The
mobile app needs a bit more, because NextAuth here is **cookie-session based**,
which native apps don't handle cleanly. Two gaps to close (design now, build as a
separate task — not part of this deploy):

**a) CORS.** Right now nothing sets `Access-Control-*`. If the mobile app (or a
separately-hosted web frontend) calls the API from a different origin, browser/
webview requests are blocked. Add an allowlist (env-driven) in `middleware.ts` or a
small wrapper: allow your app origins, handle `OPTIONS` preflight, echo
`Access-Control-Allow-Credentials` if you keep cookies. Same-origin web app doesn't
need this; a cross-origin mobile/web client does.

**b) A token auth path for native.** Cookie sessions assume a browser. Cleanest for
mobile is a **bearer/JWT** flow: a `/api/auth/*` login endpoint that returns a
signed access token (NextAuth v4 already issues JWTs internally — you can expose a
mobile-facing token endpoint or add a credentials-based `/api/mobile/login`), then
have the mobile client send `Authorization: Bearer …`. The API route handlers
(they use `getServerSession`) would gain a fallback that also accepts the bearer
token. Note the current `middleware.ts` only guards **page** routes
(`/dashboard`, `/admin`, `/account`) — the `/api/*` routes do their own
session checks, which is where the bearer fallback would slot in.

**c) Stable API base + versioning.** Give the mobile app a documented base
(`https://api.rclipper.com`) and consider freezing the request/pipeline endpoints
under a versioned prefix before the app ships, so backend changes don't break
released app versions.

I can turn (a)–(c) into a concrete implementation plan (endpoints, token lifetime,
refresh, CORS allowlist shape) whenever you want to start the mobile backend — say
the word and I'll spec it against the existing `src/app/api` + auth code.

---

## 10. Operations

- **Logs:** `pm2 logs rclipper-web`; nginx at `/var/log/nginx/`.
- **Restart after deploy:** `npm ci && npm run build && pm2 restart rclipper-web`.
- **Reboot safety:** `pm2 save` + `pm2 startup` already done → app returns on boot.
- **Health:** consider a lightweight `/api` health check + `pm2 monit`; optionally a
  DO uptime alert on `https://api.rclipper.com`.
- **Retention sweep** runs on the **Mac** (launchd, still in `--dry-run`) — the
  droplet does not need a cron for it. Go-live is a separate decision (see below).
- **Backups:** app is stateless; state is managed Postgres (use its automated
  backups) and Spaces. Nothing on the droplet's disk needs backing up beyond
  `.env.local` — keep a copy of that off-box.

---

## Sequencing summary

1. DNS A-record → droplet; allow droplet IP on managed Postgres.
2. §0.5 get the code onto the droplet (clone from GitHub, or scp from dev machine).
3. §1 base OS + firewall (+ swap if small).
4. §2 Node 20 + pm2.
5. §3 ffmpeg + Chromium libs (fallback renders).
6. §4 `.env.local` (URLs → public origin).
7. §5 `npm ci && npm run build`, pm2 up + save + startup.
8. §6 nginx + certbot TLS.
9. §7 Google OAuth redirect + login smoke-test.
10. §8 submit a test request → confirm Mac `worker.out.log` shows claim/done, and
    inline fallback when the Mac is off.
11. §9 (later) CORS + bearer auth for the mobile client.
