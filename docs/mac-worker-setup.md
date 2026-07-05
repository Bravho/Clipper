# Mac Mini render worker — Phase 0 setup runbook

Run these on the **Mac Mini** (M4, 16 GB) that will act as RClipper's render worker.
Each numbered block is copy-paste. Where it says **PASTE BACK**, send me the output so I
can verify before we move on. The Mac is outbound-only: it never needs an inbound port.

Assumes the repo is cloned to `~/Projects/Video_Processor_RClipper`. Adjust `REPO` if not.

```bash
export REPO=~/Projects/Video_Processor_RClipper
```

---

## 1. Identity: arch, Node, Homebrew

```bash
echo "arch: $(uname -m)"                 # expect: arm64
node -v 2>/dev/null || echo "node: MISSING"
which brew || echo "brew: MISSING"
brew --version 2>/dev/null | head -1
```

- `uname -m` **must** be `arm64`.
- If Homebrew is missing: install from https://brew.sh (the official one-line script).
- **Node must match the droplet.** On the DigitalOcean droplet (178.128.63.236) run `node -v`
  and tell me the version; we'll match it here. If you'd rather not check, install Node 20 LTS:
  `brew install node@20 && echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc`.

**PASTE BACK:** the block output above + the droplet's `node -v`.

---

## 2. FFmpeg with libass (subtitles) + freetype

```bash
brew install ffmpeg
which ffmpeg                              # note this path — goes in .env.local
ffmpeg -hide_banner -buildconf | grep -E "enable-libass|enable-libfreetype"
```

Both `--enable-libass` and `--enable-libfreetype` must appear. The brew bottle includes them;
if for some reason one is missing, tell me and we'll `brew install ffmpeg --with-...` or use a
full build.

**PASTE BACK:** the `which ffmpeg` path and the two grep lines.

---

## 3. Thai-capable font (for FFmpeg drawtext / burned subtitles)

```bash
brew install --cask font-noto-sans-thai
ls -1 ~/Library/Fonts | grep -i thai
# also check the cask's staged copy if the above is empty:
ls -1 "$(brew --prefix)/Caskroom/font-noto-sans-thai" 2>/dev/null
find ~/Library/Fonts /Library/Fonts -iname "*thai*" 2>/dev/null
```

I need the **absolute path** to a Thai `.ttf`/`.otf` (e.g.
`~/Library/Fonts/NotoSansThai-Regular.ttf` or a variable `NotoSansThai[wdth,wght].ttf`).
The repo default in `src/config/aiTools.ts` points at a Windows `tahoma.ttf` path — that
**must** be overridden here via `FFMPEG_FONT_FILE`.

**PASTE BACK:** the font path(s) found.

---

## 4. .env.local

Create `$REPO/.env.local`. Fill Spaces + Postgres from the **same values the droplet uses**
(copy the droplet's `.env.local`; they point at the same DO Spaces bucket and managed
Postgres). Then set the three FFmpeg vars to Mac-local values. Replace `<...>` placeholders.

```bash
cat > "$REPO/.env.local" <<'EOF'
# ---- Storage (DigitalOcean Spaces, sgp1) — same as droplet ----
DO_SPACES_KEY=<spaces_key>
DO_SPACES_SECRET=<spaces_secret>
DO_SPACES_ENDPOINT=https://sgp1.digitaloceanspaces.com
DO_SPACES_BUCKET=<bucket_name>
DO_SPACES_REGION=sgp1
# DO_SPACES_CDN_ENDPOINT=https://<bucket>.sgp1.cdn.digitaloceanspaces.com

# ---- Managed Postgres — same as droplet, SSL required ----
PGHOST=<pg_host>
PGDATABASE=<pg_database>
PGPORT=5432
PG_USER=<pg_user>
PG_PASSWORD=<pg_password>

# ---- FFmpeg — MAC-LOCAL values (override the Windows repo defaults) ----
FFMPEG_PATH=<paste the `which ffmpeg` path from step 2>
FFMPEG_TMP_DIR=/Users/Shared/clipper-scratch
FFMPEG_FONT_FILE=<paste the Thai font path from step 3>

# ---- AI pipeline keys — same as droplet (needed if this Mac ever runs a full step) ----
GEMINI_API_KEY=<gemini_key>
ELEVENLABS_API_KEY=<elevenlabs_key>
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
EOF

mkdir -p /Users/Shared/clipper-scratch
chmod 700 "$REPO/.env.local"
echo "written; keys present:"; grep -E "^(FFMPEG_|DO_SPACES_BUCKET|PGHOST)=" "$REPO/.env.local"
```

> `FFMPEG_FONT_FILE` is already read by `src/config/aiTools.ts`; setting it in `.env.local`
> is all that's needed — no code change for the font.

**PASTE BACK:** the final `grep` line (values are fine to redact except confirming they're set).

---

## 5. Remotion headless render on arm64 (Overlay composition)

This proves headless Chromium / `headless-shell` runs on Apple Silicon.

```bash
cd "$REPO"
npm ci   # if node_modules not already installed
# Ensure Remotion's headless browser is present (downloads on first use):
npx remotion browser ensure
# Render the existing "Overlay" composition to a throwaway file:
npx remotion render remotion/index.ts Overlay /tmp/overlay-smoke.mp4 --log=verbose
ls -lh /tmp/overlay-smoke.mp4 && rm -f /tmp/overlay-smoke.mp4
```

If it fails with a Chromium/headless-shell error, paste the error — common fixes are
`npx remotion browser ensure` (above) or a Rosetta/permissions issue I'll walk you through.

**PASTE BACK:** the final `ls -lh` line (success) or the error output (failure).

---

## 6. Connectivity: Spaces + managed Postgres from this Mac

```bash
cd "$REPO"
# Spaces — uses the repo's existing test script (reads .env.local):
node scripts/test-spaces.js

# Postgres over SSL — quick reachability + row count:
node -e '
const fs=require("fs"),path=require("path");
const env=fs.readFileSync(".env.local","utf8");
const g=k=>(env.match(new RegExp("^"+k+"\\s*=\\s*(.+)$","m"))||[])[1]?.trim();
const {Client}=require("pg");
const c=new Client({host:g("PGHOST"),database:g("PGDATABASE"),port:+g("PGPORT")||5432,
  user:g("PG_USER"),password:g("PG_PASSWORD"),ssl:{rejectUnauthorized:false}});
c.connect().then(()=>c.query("select now() as t, count(*)::int as jobs from video_generation_jobs"))
  .then(r=>{console.log("PG OK:",r.rows[0]);return c.end();})
  .catch(e=>{console.error("PG FAIL:",e.message);process.exit(1);});
'
```

**PASTE BACK:** both outputs (`test-spaces.js` result + the `PG OK:` line).

---

Once 1–6 are green, Phase 0 is done and I'll wire the worker's env to these exact values.
