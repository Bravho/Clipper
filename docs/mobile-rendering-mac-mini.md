# iPhone and Android validation for phone rendering

This is a development checklist for the current **native video-track smoke test**.
The lab exports a silent **intermediate montage** on purpose. The delivered MP4
must include the approved speaking voice and selected background music; the
phone audio-composition stage is still outstanding.
It does not certify the complete phone pipeline: still-image motion, scene
transitions, voice/music mix, graphics, captions, output upload, and Android
montage remain outstanding. The production request form intentionally rejects
phone-local videos until those pieces are connected.

## 1. Prepare the Mac Mini

1. Install Xcode 26 or newer from Apple, open it once, and accept its components.
2. Install Node.js 22 or newer and CocoaPods. Verify in Terminal:

   ```sh
   node --version
   xcodebuild -version
   pod --version
   ```

3. Put this exact working tree on the Mac Mini, including the current uncommitted
   mobile changes. Check `git status --short` there before building. A fresh clone
   of an older commit will not contain the native timeline or render lab.
4. In the project root, run `npm ci` and `npx tsc --noEmit --incremental false`.

## 2. Run the development web app

1. Supply the normal development database/auth/environment variables described
   by `.env.example`. Do not put production keys in a test checkout.
2. Find the Mac Mini's LAN address, for example `192.168.1.42`.
3. Run `npm run dev -- --hostname 0.0.0.0` in the project root.
4. On the iPhone's Safari, check that
   `http://<mac-lan-ip>:3000/device-render-lab` loads. The page only exists when
   the Next.js server runs in development mode.

## 3. Build and install the iOS shell

1. With the Mac Mini and iPhone on the same local network, run in a second
   Terminal from the project root:

   ```sh
   CAP_SERVER_URL=http://<mac-lan-ip>:3000/device-render-lab npx cap sync ios
   npx cap open ios
   ```

2. In Xcode, select the **App** scheme and an iPhone simulator. Build once to
   catch Swift and CocoaPods errors.
3. Connect a physical iPhone, trust the Mac, choose the iPhone as run target,
   set a development team under Signing & Capabilities, and run the app.
4. If prompted, enable Developer Mode in iPhone Settings > Privacy & Security,
   restart, and confirm it. This is required for a locally installed Xcode app.
5. Launch the installed RClipper app. The test URL above opens the lab as its
   initial WebView page. This HTTP configuration is for LAN debugging only;
   rebuild with an HTTPS
   deployment URL before distributing an app.

## 4. Test the current native primitive

1. Record two short MP4 clips with clearly different movement and audible
   camera sound. Use MP4/H.264 test files if the iPhone camera saves HEVC/MOV.
2. Select both files in the render lab and tap **Render real clips on phone**.
3. Confirm the exported preview shows the moving frames from both clips in
   selection order, approximately five seconds per clip, with **no original
   camera sound**. The page must report a nonzero output size.
4. Repeat with one portrait and one landscape source. Confirm rotation and
   aspect-fill framing are correct and the app stays responsive.
5. Test cancellation or app interruption only after the primary export succeeds;
   the complete interruption recovery protocol is not implemented yet.
6. Save the Xcode build log, iPhone model/iOS version, and any render error.
   Report the exact error text and which step above failed so the native code can
   be corrected without guessing.

## 5. Repeat the native smoke test on an Android phone

Use a physical Android phone with Developer options and USB debugging enabled.
Connect it to the development computer by USB, accept the trust prompt, and
confirm `adb devices` lists it as `device` (not `unauthorized`). Keep the phone
and development computer on the same LAN.

1. Run the same development web server from step 2. On the computer used to
   build Android, run from the project root:

   ```sh
   CAP_SERVER_URL=http://<dev-computer-lan-ip>:3000/device-render-lab npx cap sync android
   cd android
   ./gradlew :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

   On Windows PowerShell, set `$env:CAP_SERVER_URL` first and use
   `npx.cmd`, `gradlew.bat`, and `adb.exe` instead of the Unix commands.

2. Launch RClipper on the phone, select two short MP4s, and render. Check that
   both real clips move in order, are aspect-filled, and carry no camera audio.
3. Repeat with portrait and landscape sources, a longer clip, low storage, and
   app background/foreground transitions. Capture the phone model, Android
   version, output size, elapsed time, and any error. A debug APK build alone
   does **not** establish device render success.
4. When an export fails, save a log immediately with `adb logcat -d -t 1000`
   and send the error plus the selected media formats. Keep the original clips
   private unless you explicitly want them shared for debugging.

This workspace currently has no Android device attached, so a physical-phone
result must be provided from your device. The development-only HTTP shell must
not be distributed; rebuild with the production HTTPS URL afterward.

## 6. What must pass before switching production requests

- A full approved scene with local images **and** moving clips, in the exact
  selected order, with Ken Burns presets, focus, trims, and transitions.
- Downloaded ElevenLabs voice plus selected music, with intro, level control,
  ducking, and no material-clip audio.
- The chosen graphic template, Thai/English/Chinese timed captions, each
  required aspect ratio, and the separate Travy EN+ZH export.
- Output upload to scoped storage, server-side media inspection, idempotent job
  completion, and a JPEG cover extracted from each finished export.
- Force-close, low storage, network loss, retry, and worker-reclaim tests on
  physical iOS and Android devices.

Do not interpret a successful step 4 smoke test as completion of step 5.
