# Device validation for phone rendering

The build-and-test procedure for the phone video editor. What the renderer is
supposed to produce is in `docs/device-render-parity.md`; what is implemented is
in `docs/on-device-rendering.md`.

**Nothing in this document is a result.** A successful build is not a successful
render, and a successful render on one phone is not a pass. Record what you
actually observed, including the model and OS version.

---

## 1. Android — build the APK against the droplet

Build and install steps live in **`docs/mobile-app-build.md`**, which is the
one place that describes how the app is targeted. The short version: unset
`CAP_SERVER_URL`, `npx cap sync android`, `gradlew assembleDebug`, `adb install
-r`. The app then talks to `https://app.rclipper.com` and needs no computer on
the network.

Before testing, make sure the droplet has migrations 035 and 036 applied and
`DEVICE_RENDER_LAB_TEST_EMAIL` set to your account — without it the studio page
and its API routes return 404 in production, by design.

Then:

1. Launch RClipper and open **Video studio** from the menu.
2. Check the header badge names the live host rather than a LAN address.
3. Check the capability notice says this phone can render. If it reports a
   plugin version below 5, the APK is stale — a website deploy cannot update the
   native plugin inside an installed app.
4. When a render fails, capture the log immediately:

   ```powershell
   adb.exe logcat -d -t 2000 > render-failure.txt
   ```

   Send the error text, the step it failed on, and the formats of the media you
   selected. Keep the originals private unless you explicitly want them shared.

## 2. Android — the draft chain

Each of these exercises the same manifest and the same renderer the production
path uses, so a failure here is a real failure.

1. **Silent montage.** Add two photos and two short MP4 clips with clearly
   different movement and audible camera sound. Set each still to a different
   camera move (zoom in, zoom out, pan left, pan right) and drag the focus
   sliders off centre on one. Render the draft with no voice.
   - Both clips move, in the order you set, with **no camera sound**.
   - The stills animate, and the one with an off-centre focus zooms toward that
     point rather than the photo's middle.
   - The scene joins dissolve. **Check the result card**: if it says "Hard cuts",
     the two-sequence composition did not export on this device — record that,
     it is a real difference from the Mac output.
2. **Trim and slow-fill.** Set one clip's window shorter than its on-screen
   time. The editor says it will play slower; confirm it does, and that it does
   not freeze or go black instead.
3. **Sound.** Add a short speaking-voice file and a music file, then render
   again.
   - The clip opens on **0.6 s of music alone**.
   - The voice is clearly audible over the bed.
   - The bed **drops under speech and comes back between sentences** — not
     inaudible, not unchanged.
   - The music keeps playing after the narration ends.
   - Run it once with music and once without; without music there is no 0.6 s
     intro.
4. **Captions and template.** Choose Thai + English + Chinese and a decorated
   template, then render again.
   - Captions are stacked from the bottom in Thai, English, Chinese order, with
     Chinese in yellow.
   - They are in sync with the speech — a caption that is consistently 0.6 s
     early means the lead-in shift was lost.
   - The template's frame and decor are drawn, and do not cover the captions.
5. **Ratios.** Repeat with 16:9, 1:1 and 4:5. Confirm the framing fills the
   canvas without letterboxing or squashing, and portrait footage is rotated
   correctly.
6. **Interruption.** Start a long render and background the app; then start one
   and force-quit. Confirm nothing is left half-written and the next render
   still works.
7. **Low storage.** Fill the phone to under a gigabyte free and confirm the
   claim is refused with a clear reason rather than failing mid-render.

## 3. Android — a real request

Only with `DEVICE_RENDER_ENABLED=true` and the tester email set.

1. Take a request to the point where its overlay step is queued.
2. Open the editor with `?request=<id>`. Confirm the panel says the phone can
   take it and names the ratio.
3. Render. Watch for: progress that moves, an upload that completes, and a
   server message confirming the video was checked and attached.
4. Check the request page: the captioned export is there with a poster taken
   from the video's own frames.
5. **Retry.** Turn airplane mode on just as the upload finishes, then off.
   The completion retries and you end up with **one** export, not two.
6. **Reclaim.** Start a render and force-quit the app mid-export. Confirm the
   task returns to the queue and the Mac worker finishes it, and that the
   phone's late completion is refused rather than overwriting the worker's
   result.
7. **Cancel.** Start a render and press Stop. Confirm the task goes back to the
   queue and the server picks it up.

## 4. iOS — prepare the Mac Mini

**None of the iOS code has been compiled or run.** This workspace is Windows;
the Swift render path was written here and has never seen a compiler. Treat
every step below as unverified until you have done it.

1. Install Xcode 26 or newer, open it once, and accept its components.
2. Install Node.js 22 or newer and CocoaPods. Verify:

   ```sh
   node --version
   xcodebuild -version
   pod --version
   ```

3. Put this exact working tree on the Mac Mini, including uncommitted changes.
   Check `git status --short` there before building — a fresh clone of an older
   commit will not contain the render path.
4. In the project root: `npm ci` and `npx tsc --noEmit -p tsconfig.json`.

## 5. iOS — add the render files to the Xcode project

`ios/App/App/Render/` contains eight new Swift files. Capacitor's project file
does not pick up new sources automatically.

1. Open `ios/App/App.xcworkspace`.
2. Right-click the **App** group, choose **Add Files to "App"…**, select the
   `Render` folder, and make sure **Create groups** is chosen and the **App**
   target is ticked.
3. Confirm all eight appear under Build Phases → Compile Sources:
   `RenderManifest.swift`, `MotionMath.swift`, `AudioMixer.swift`,
   `OverlayPainter.swift`, `StillSegmentWriter.swift`, `ManifestRenderer.swift`,
   `ManifestJob.swift`, `Uploads.swift`.
4. Build the **App** scheme against a simulator first and fix what the compiler
   reports. Expect to spend time here: this code has never been compiled.

## 6. iOS — build and run on a device

1. With the Mac Mini and iPhone on the same network:

   ```sh
   CAP_SERVER_URL=http://<mac-lan-ip>:3000 npx cap sync ios
   npx cap open ios
   ```

2. Connect a physical iPhone, trust the Mac, select it as the run target, set a
   development team under Signing & Capabilities, and run.
3. If prompted, enable Developer Mode in Settings → Privacy & Security, restart,
   and confirm it.
4. This HTTP configuration is for LAN debugging only. Rebuild with the HTTPS
   deployment URL before distributing anything.
5. Work through sections 2 and 3 above on the iPhone, recording each result.

Two iOS-specific things to look at:

- **Stills.** iOS pre-renders each still to its own segment. Confirm the
  animation is smooth and that a long timeline does not run the device out of
  temporary space.
- **Clip entrances.** A slide or zoom entrance on a *clip* is applied at its
  midpoint as a static offset rather than animated. Confirm this reads as
  acceptable, or record it as a defect to fix.

## 7. Compare against the Mac Mini export

Render the SAME request on the Mac worker and on each phone, then compare:

| What | What to check |
| --- | --- |
| Moving video | Same clips, same order, same trims, no camera sound |
| Animated images | Same camera moves, same direction, anchored on the same subject |
| Scene joins | Dissolve on both, or a recorded hard-cut fallback on Android |
| Subtitles | Same text, same languages, same position, same timing |
| Audio | Same 0.6 s intro, same speech level within about a decibel, bed audibly ducking |
| Length | Within a frame or two |
| Ratios | Every required ratio, at exactly 1080x1920 / 1920x1080 / 1080x1080 / 1080x1350 |
| Cover image | Present, and a frame from the video itself |

Record the phone model, OS version, render time, output size and any
difference. A difference that is explained in `docs/on-device-rendering.md` is
expected; anything else is a defect.

## 8. What must pass before switching production requests

- A full approved scene with local images **and** moving clips, in the exact
  selected order, with Ken Burns presets, focus, trims and transitions.
- The downloaded ElevenLabs voice plus selected music, with intro, level
  control, ducking, and no material-clip audio.
- The chosen template, Thai/English/Chinese timed captions, each required
  aspect ratio, and the separate Travy EN+ZH export.
- Output upload to scoped storage, server-side media inspection, idempotent job
  completion, and a JPEG cover extracted from each finished export.
- Force-close, low storage, network loss, retry and worker-reclaim tests on
  physical iOS **and** Android devices.

A successful section 2 is not a completed section 3, and a debug APK build alone
establishes nothing about rendering.
