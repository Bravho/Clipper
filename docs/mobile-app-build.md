# Building the app against the droplet

The app is a native shell around the deployed site. A build with no
`CAP_SERVER_URL` targets **https://app.rclipper.com** — the droplet — and works
anywhere the phone has a network, with no computer involved.

That is the build you almost always want. A LAN build, pointed at `npm run dev`
on a PC, only works while the phone is on the same Wi-Fi as that machine and the
dev server is running; off that network it shows a blank page with nothing on
screen to explain why. Since it is easy to set `CAP_SERVER_URL` once and forget,
`capacitor.config.ts` now refuses a plain-http target unless `CAP_ALLOW_LAN=1`
is also set — so a LAN build is a deliberate act and the accident is loud.

The app's header shows which server it actually loaded, so you never have to
guess: the live host, or an amber "LAN build" badge.

---

## 1. Build the Android APK against the droplet

From the project root, on the machine with the phone attached.

**The prompt tells you which shell you are in.** `D:\coding\clipper_agent>` is
Command Prompt; `PS D:\coding\clipper_agent>` is PowerShell. They clear an
environment variable differently, and the wrong one just errors out.

Command Prompt:

```bat
:: Clear anything left over from a LAN build. An empty value unsets it.
set CAP_SERVER_URL=
set CAP_ALLOW_LAN=

:: Confirm: CMD echoes the literal %NAME% back when a variable is unset.
echo %CAP_SERVER_URL%

npx.cmd cap sync android
cd android
gradlew.bat :app:assembleDebug
adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

PowerShell:

```powershell
Remove-Item Env:CAP_SERVER_URL -ErrorAction SilentlyContinue
Remove-Item Env:CAP_ALLOW_LAN  -ErrorAction SilentlyContinue

# Confirm: prints nothing when unset.
$env:CAP_SERVER_URL

npx.cmd cap sync android
cd android
.\gradlew.bat :app:assembleDebug
adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

Simplest alternative to either: **open a new terminal window.** `set` and
`$env:` only last for the session that ran them, so a fresh window starts clean.
The exception is `setx`, which writes to the registry permanently — if you ever
used that, `set CAP_SERVER_URL=` clears it only for the current window, and you
need `setx CAP_SERVER_URL ""` plus a new window to be rid of it.

`cap sync` prints the target it used. Check it says
`[capacitor] Building against https://app.rclipper.com`, and check that
`android/app/src/main/assets/capacitor.config.json` carries the same URL — an
installed APK does not pick up a new server from a website deploy.

No dev server, no LAN address, no laptop. The phone talks to the droplet.

## 2. What the droplet needs

On the server, in the app's environment:

| Variable | Why |
| --- | --- |
| `DEVICE_RENDER_LAB_TEST_EMAIL` | The tester gate. The studio page **and** every `/api/device-render/*` route return 404 to anyone else, so the feature stays private while it is unfinished. |
| `DEVICE_RENDER_ENABLED=true` | Lets a phone claim real production render work. Leave it off to keep the studio a draft tool. |

Apply migrations **035** and **036** before turning either on:

```sh
node scripts/apply-migration.js src/db/migrations/035_device_render_attempts.sql
node scripts/apply-migration.js src/db/migrations/036_device_held_media.sql
```

Then rebuild and restart Next.js. Both migrations are additive and idempotent.

## 3. A LAN build, when you actually want one

Only for stepping through server code against a phone.

Command Prompt — quote the WHOLE assignment, or a trailing space ends up inside
the value (harmless here because the config trims it, but it is the habit that
saves you elsewhere):

```bat
set "CAP_SERVER_URL=http://192.168.1.42:3000"
set "CAP_ALLOW_LAN=1"
npx.cmd cap sync android
cd android
gradlew.bat :app:assembleDebug
adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

PowerShell:

```powershell
$env:CAP_SERVER_URL = "http://192.168.1.42:3000"
$env:CAP_ALLOW_LAN  = "1"
npx.cmd cap sync android
cd android; .\gradlew.bat :app:assembleDebug
adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

Note `CAP_SERVER_URL=value npx cap sync` — the Unix form — does **not** work in
either Windows shell. CMD reports `'CAP_SERVER_URL' is not recognized as an
internal or external command`.

Use the port Next.js actually printed — if 3000 was taken it may have chosen
3001, and the APK has to be rebuilt to change it. Check the lab URL loads in the
phone's browser before you build. Never distribute this build; clear both
variables and re-sync when you are done.

## 4. What travels over the network

The point of the phone renderer is that your footage does not.

| Stays on the phone | Goes to the droplet |
| --- | --- |
| Original photos | One resized JPEG per photo (analysis + thumbnails) |
| Original clips | One poster frame per clip (analysis + thumbnails) |
| Every intermediate render | The finished export, once, after the phone has made it |
| | Script text, the ElevenLabs voice file, publishing metadata |

A clip that would have been a 200 MB upload becomes a poster frame of a few tens
of kilobytes. The voice comes **down** from the server because ElevenLabs runs
there — it is a short audio file, not a video.

## 5. Which renderer runs

Decided per request, at submission, and recorded on the request:

- **`render_location = 'device'`** — you kept clips on the phone. The montage,
  the merged master and the final export run there. Those queue rows are marked
  `device_only`, so the Mac Mini worker never sees them: it has no copy of the
  footage, and a claim could only end in a failed step.
- **`render_location = 'server'`** — the default, every request made before
  migration 036, and every request from an older app build. Uploads, the render
  queue, the Mac Mini. Completely unchanged.

An app that predates the phone renderer declares nothing, so the server refuses
to let it keep a clip locally and it takes the upload path — which is exactly
why older installs keep working.

## 6. Where you actually make the video

On the request page, the same one as always: storyboard, per-scene script,
voice, music, subtitle languages, motion template, channel ratios, cover. The
phone does not get a separate editor — it gets a renderer that runs inside that
flow. See `docs/on-device-rendering.md`, "Where the editing happens".

The link in the navigation reading **On-device render test** is not the editor.
It is a tester-only page for comparing a phone export against a Mac Mini export,
and it says so at the top.
