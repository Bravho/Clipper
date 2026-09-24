# On-device rendering implementation

The exact behaviour a phone render must reproduce — timing, motion, transitions,
audio, captions, templates, ratios, cover — is traced from the Remotion/FFmpeg
pipeline in **`docs/device-render-parity.md`**. That document is the acceptance
specification; this one tracks what is implemented and what is not.
`docs/mobile-rendering-mac-mini.md` is the device validation procedure.

## Production-hosted preview

The phone editor can be served from the production HTTPS host for one signed-in
tester by setting `DEVICE_RENDER_LAB_TEST_EMAIL` on the droplet to that
account's email, then rebuilding and restarting Next.js. The server checks the
session email before rendering the page **and** before every
`/api/device-render/*` route, so without the variable production returns 404 for
both. The Android APK must be synced and rebuilt with
`CAP_SERVER_URL=https://app.rclipper.com` and the current `DeviceVideoRender`
native plugin; a server deploy cannot update the native plugin inside an
installed APK.

`DEVICE_RENDER_ENABLED` is the separate switch that lets a phone claim real
production render work. It is off by default. Turning it on is the last step of
the release checklist below, not the first.

## Where the editing happens

There are two phone screens, and the difference between them is the difference
between arranging a video and approving one.

This section used to say there was no phone editor and never should be. That
was the right call while the phone's only job was to render someone else's
approved plan, and it is the wrong call now: the product is a short-clip editor
people use on the phone, so the arranging happens there. What has NOT changed is
the reason the old rule existed — approvals, credits, job state and publishing
have exactly one implementation, and it is the server's.

So the split is by responsibility, not by screen:

| Runs on the server | Runs on the phone |
| --- | --- |
| Script generation, scene design, storyboard planning, ElevenLabs voice | Arranging: brief, material, storyboard review, timeline, sound, captions |
| Approvals, credits, job state, publishing | Every frame of every render |

**`MobileVideoEditor`** (`src/features/device-render/`) is the studio: seven
steps — Brief, Media, Storyboard, Sound, Graphic, Render, Channels — and it drives the
real pipeline rather than a parallel one. Every server call it makes is one the
web flow already makes.

- **Brief** collects the web form's fields. The location is found from the
  place name with the same Google Maps Geocoder the web form's picker uses
  (`geocodePlaceName`), and the picker opens only to confirm or move the pin.
  Saving writes a Draft request straight to the database (`POST /api/requests`,
  then `PUT` while it is a Draft); the studio attaches to the returned id in
  place (`history.replaceState`, no navigation) and moves on to Media.
- **Media** ends in a Submit button under the grid. Submitting copies each
  original into the app's private storage (`retainLocalFile`, the same
  `localId` scheme and index the request form's local-first path uses), then
  calls `POST /api/requests/[id]/submit` with `localMedia` — descriptors, one
  small analysis JPEG per item and the device's render capability. Nothing is
  uploaded; the request is marked for on-device rendering and the job starts.
  After that the material is locked: the pipeline's storyboard indexes it by
  position.
- **Storyboard** (formerly Timeline) shows "planning" until the job leaves
  `analyzing_content`, then fills itself from the job's storyboard, read via
  `GET /api/device-render/content`. At the top, `StoryboardPreview` plays the
  whole edit in the WebView (clips in their trimmed window, photos with their
  camera move, scene fades) — picture only; captions, template and voice are
  added by the render. Clips are trimmed with the request page's own
  `ClipTrimBar` (filmstrip, drag handles, looping preview); the kept window is
  the shot's length. Photos get an on-screen slider, camera move and focus.
  The length is checked against the brief's target, and once the voice exists
  against voice + intro + ending (`minMontageTotalSeconds`, the gate's own
  rule), with a one-tap fit. **Approve the storyboard** sits at the bottom and
  moves on to Sound; it never starts a render. It is pressable whenever there
  are shots — a storyboard shorter than the voice is flagged, and Render will
  not start until it is fitted.
- **Sound** shows the speaking script and caption. Approving calls
  `POST /api/requests/[id]/start-production` with the storyboard's scene order
  and material. Then the generated voice plays here with **Approve the voice**
  (`approve-voice`, channels ordered so the primary one's shape is the shape
  edited in Media) or **Make it again** (`voice/regenerate`). Below that, the
  background tracks (each with a ▶ preview from `/music/<id>.mp3`) and the
  caption languages (at most two — the scene-design approval keeps two), then
  **Confirm the sound**, which needs an approved voice and moves on to Graphic.
- **Graphic** is the Look. Each template shows an example frame drawn on the
  phone from the request's own first picture at the main video's shape
  (`TemplateExample.tsx`, the same geometry as `TemplatePainter.java`, default
  palette). **Confirm the look** moves on to Render.
- **Render** shows a checklist (storyboard approved and covering the voice,
  script and voice approved, sound and look confirmed, scene-design gate
  reached) and **Render the main video**. That sends the studio's full plan:
  `scenePlanFromScenes` turns every shot — trim, camera move, focus, and each
  scene's transition — into `ScenePlan.assets`, sent to
  `POST /api/requests/[id]/scene-design/approve` with the studio's music,
  caption languages and template and `autoApproveRemaining: true`. The server
  keeps montage plans as sent, so the manifest the phone renders is the edit
  made in the studio. The phone then passes the retained originals
  (`loadLocalMediaIndex`) to `runDeviceRender` and keeps claiming the next task
  until the server has nothing more for it — montage, master, final. On Android
  the final pass retries without the motion template (captions kept) if the
  two-overlay export fails, and reports `templateDropped`. For a device
  request the express lane stops at the captioned video's review
  (`applyDeviceRenderResult` turns `autoApproveRemaining` off there), so the
  video plays in Render, from `outputs` in `GET /api/device-render/content`,
  with **Approve the video** (`approve-overlay`) under it.
- **Channels** lists the brief's channels grouped by shape. The main video's
  shape is done; the person picks which other shapes to make, and
  `generate-additional-ratios` is called with `ratios`. **Finish with the main
  video only** sends an empty list, which delivers straight away. Travy is not
  offered in the studio for now.
- A studio reopened on a submitted request rebuilds its media from private
  storage using the job's `localMedia` list, so the storyboard has its pictures
  again; any original that has gone is named, because that phone can no longer
  render the request.

**Which steps a device request renders on the phone.** A request with
`render_location = 'device'` (every studio submission that the app build can
render — `localMedia.renderOnDevice` — and every submission that keeps a clip)
has all of its heavy steps queued `device_only`: the Mac Mini skips them and
there is no server fallback. The phone renders the montage in ONE pass — all
scenes, dissolves included — so `applyDeviceRenderResult` treats
`montage_all_segments`, `montage_scene_segment` and `montage_merge` alike: the
upload is the merged base video. Approving that video
(`approveBaseVideoByRequester`) then skips the server merge for a device
request; dispatching one would clear the video and queue the phone to render
it again, which on the express lane never ends.

**One encode from the originals (plugin v6).** The server's pipeline makes the
delivered video in three encodes — montage, then master (voice and music), then
the styled render — each built on the previous one's download. For a
device-only task claimed by a build reporting `nativePluginVersion >= 6`
(`SOURCE_EDIT_PLUGIN_VERSION`), `DeviceRenderService` instead hands out a
master or final manifest with `buildFromSources: true`: the scene plan and the
originals' handles, the voice, the music, and for a final the captions,
languages, template and palette. The phone composes the whole edit — shots,
trims, camera moves, focus, dissolves, the ducked mix, the template and the
captions — and encodes it ONCE from the camera originals (Android: composition
effects over the picture's sequences plus an audio sequence; iOS: the montage
composition plus an audio track and a Core Animation layer tree). Nothing is
downloaded but the voice and the music. The Android final falls back in
order: hard cuts instead of dissolves, then no template (captions are never
dropped); iOS drops the template if the decorated export fails. A v5 build is
never sent this flag and keeps the download path. For an extra channel shape,
a v6 build is handed the shape's montage link as its master straight away
(the silent montage would only be thrown away); `applyDeviceRenderResult`
follows the attempt's stage, so the chain continues with that shape's final.

**Extra channel shapes of a device request.** After the main video is
approved, each chosen shape is rendered on the phone from its own originals —
montage, then master (voice and music), then final (captions and template) —
at that shape's canvas. A job may hold one active render task, so the shapes
run as a chain of `additional_ratios` tasks whose payload names the shape, the
stage and the shapes still to do (`src/lib/mobile/deviceRatioChain.ts`).
`stageForTask` reads the stage from that payload; the master link carries its
own montage's asset id (`baseAssetId`) instead of the job's base video; the
master lands in that shape's `finalExport_*` and the final in its
`captionedExport_*`. `DeviceRenderService.complete` closes the finished
link's task and only then calls `advanceDeviceRatioChain`, which queues the
next link or, after the last final, finalizes the job exactly as the server
path does. A device request never gets a Travy export (it is made from
server-held masters): `_finalizeAndStartTravy` skips it for
`render_location = 'device'`.

There is no local "draft" render button any more. `localDraft.ts` remains as
renderer code but nothing in the studio calls it.

Thumbnails are captured frames, not `<video>` tags. A `<video src=blob:…>` in
the Android WebView draws the system's grey play-button placeholder until it is
played, so a grid of three clips came out as three identical grey squares —
which is exactly what a thumbnail exists to prevent. `probeVideo` reads the
length and a frame in one decode when a file is added; `readImagePoster`
downscales a photo so a grid tile is not holding a 6MB original. A clip's
captured frame is also what becomes its analysis JPEG at submission.

**`DeviceRenderRunner`** is the other screen's whole presence, mounted on
the request page whenever `render_location = 'device'`. It claims whichever
render step the pipeline has queued, renders it, uploads the result, and lets
the server verify and attach it — then immediately looks for the next one,
because a montage is one task per scene.

It runs without being asked, and that is deliberate. A request whose originals
stayed on the phone enqueues its steps as `device_only`; the Mac Mini worker's
claim scan skips them, because it has no copy of the footage. Nothing else will
ever pick that work up. A renderer that waited to be told would be a job that
waits forever.

Three things can stop it, and each says so in the requester's own language
rather than failing quietly:

- **A browser, or a different phone.** The originals are on one device. The
  page says which one to open.
- **An app build older than the manifest renderer.** It says to update.
- **The requester pressing stop.** The lease is released, the task keeps its
  place in the queue, and a button offers to resume.

The lab survives as what it always should have been: a render test page, gated
to one tester account, for comparing a phone export against a Mac Mini export
frame by frame. It says so at the top of the screen.

## Local-first source media

Native iOS and Android submissions with `DeviceVideoRender` plugin version 2 or
newer keep original photos in the WebView origin private file system. The server
receives an opaque `localId`, file metadata, and compact JPEG derivatives for
Gemini and the legacy worker. Original bytes are not uploaded to object storage.
The server persists one resized JPEG derivative per local photo under the
request. Web submissions, resumed legacy drafts and older installed apps
continue through the existing upload flow.
`NEXT_PUBLIC_LOCAL_FIRST_MEDIA=false` is an emergency rollback; the default is
on when the native capability and private storage checks pass.

The native render bridge is **version 5** on iOS and Android. Versions 1–4
staged OPFS files into native cache, hard-joined real video tracks into a silent
montage, and mixed a local voice and music into an audible draft. Version 5 adds
`renderManifest` and `uploadOutput`: a phone renders a whole server-issued
manifest and uploads the result to a key the server minted. Staged inputs and
rendered outputs have separate release methods and path validation confines
every accepted path to the plugin's own render directory.

## Status

| Operation | Server implementation | Phone implementation |
| --- | --- | --- |
| Still-image motion | Remotion `ken_burns_in/out`, `pan_left/right`, `static`, about a subject-focus origin | **Implemented.** Android: a `MatrixTransformation` per frame. iOS: each still is pre-rendered to a segment by `StillSegmentWriter`, drawn frame by frame. Both use the keyframe table in `deviceRenderCaptions.ts`. |
| Subject focus / cover crop | `object-fit: cover` with the Gemini focus point as transform origin | **Implemented** on both, from the same focus values in the manifest. |
| Clip trims, ordering, muting | Remotion trims, orders and mutes source audio | **Implemented** on both. Material clip audio is discarded, and the contract refuses a manifest that says otherwise. |
| Slow-fill for a short clip | `playbackRate = clamp(footage/slot, 0.8, 1)` | **Implemented.** Android: `SpeedChangeEffect`. iOS: `scaleTimeRange`. |
| Within-scene dissolve | 0.2 s cross-dissolve, mount-early overlap | **Implemented** on iOS (`setOpacityRamp`). **Implemented with a fallback** on Android: shots ping-pong between two sequences with a `VideoCompositorSettings` alpha ramp, and if that composition will not export the montage falls back to hard cuts and says so in the result. |
| Between-scene crossfade | FFmpeg `xfade`, 0.2 s | **Implemented** by the same mechanism as the within-scene dissolve. |
| Slide / zoom entrance | Extra transform layered on the dissolve | **Implemented** on Android and for stills on iOS. For an iOS *clip* the flourish is applied at its midpoint as a static offset, not animated. |
| Voice and music mix | `loudnorm` → `adelay` → `apad` → sidechain duck → `amix` → `alimiter` | **Implemented** as hand-written DSP in `AudioMixer` on both platforms, from the constants and formulas in `deviceRenderAudio.ts`. Neither Media3 nor AVFoundation has a sidechain compressor or a loudness normaliser. |
| Timed multilingual captions | Remotion `CaptionOverlay` | **Implemented.** Android: a `BitmapOverlay` redrawn per frame with Canvas. iOS: one CALayer per cue through `AVVideoCompositionCoreAnimationTool`. |
| Graphic templates | Remotion `TemplatedVideo` + `DecorativeGraphics` | **Implemented for frame, decor and palette.** Decor is drawn in its settled state; the server animates it. |
| Aspect ratios | Separate export per required ratio | **Implemented** — a manifest carries one ratio, and the server issues one attempt per ratio. |
| Travy EN+ZH export | Separate render at the Travy ratio | **Contract support implemented** (`travy: true` forces EN+ZH). Not yet issued to devices; `AdditionalRatios` and `TravyGeneration` remain worker steps. |
| Cover still | `ensureAssetPoster` extracts a JPEG from the finished video | **Implemented.** The device extracts it from its own finished export and uploads it; the server verifies it and falls back to extracting one itself. |
| Output upload | — | **Implemented.** Presigned multipart parts, streamed from disk; a cover goes up as a single PUT. |
| Lease, progress, completion | — | **Implemented.** See below. |

## Ownership and boundaries

- Gemini analysis and scene design, ElevenLabs generation, approval gates,
  credits and allowances, publishing and the authoritative `VideoGenerationJob`
  all stay on the server.
- `VideoGenerationService._dispatchHeavy()` queues heavy work in `render_tasks`
  when a worker heartbeat is fresh. That is unchanged.
- `DEVICE_RENDER.eligibleSteps` names which steps a phone may claim. It
  currently contains **`RenderStep.OverlayComposition`** only: that step starts
  from a completed, uncaptioned master and produces exactly one
  `captionedExport_*` asset, so a wrong render costs one reviewable video rather
  than the pipeline. `MontageAllSegments`, `MontageMerge`, `FfmpegComposition`,
  `AdditionalRatios` and `TravyGeneration` remain worker steps until their phone
  equivalents pass the fixtures in `docs/device-render-parity.md`. The manifest
  builder already produces montage and master manifests, so adding a step is a
  config change.
- `VideoGenerationService.applyDeviceRenderResult()` does the job bookkeeping a
  heavy step does at its end — write the asset into the right field, move to
  that step's review gate — so the device path and the inline path cannot drift.

## Contract

`src/lib/mobile/deviceRenderContract.ts` defines the **version 4** manifest:
ordered scenes of shots, the original Ken Burns motion names, clip trims, focus,
playback-rate fill, within-scene and between-scene transitions, an explicit
`sourceClipAudio: false` rule, the full audio mix parameters, timed
multilingual caption cues already shifted by the music lead-in, the chosen
template with its palette, the required ratio, and the cover. It distinguishes
three stages, matching the three renders the server actually performs:

- **montage** — approved photos and clips become one silent intermediate.
- **master** — that montage plus the approved voice and selected music.
- **final** — that master with the template and captions burned in, plus a cover.

Only `final` may be delivered. The server builds a manifest from approved job
and asset records only (`deviceRenderManifestBuilder.ts`), validates what it
built, and signs short-lived object-scoped URLs into it. Neither provider keys
nor Spaces credentials belong in it. `nativeDownload.ts` converts a whole
response to base64 for sharing; that method is not used for render inputs or
outputs, which stream through a 64 KB buffer on both platforms.

## Lease and completion

`device_render_attempts` (migration 035) is the receipt for one phone attempt.
The flow:

1. `POST /api/device-render/claim` — the device offers its capabilities; the
   server checks ownership, the step's eligibility, the inputs it would need and
   `assessDeviceRenderEligibility`, then atomically claims the queued task
   (`state = 'queued'` only, so a worker claim always wins) and returns the
   manifest.
2. `POST /api/device-render/[attemptId]/progress` — heartbeat and percentage.
   Extends the lease, mirrors the percentage onto the job's existing progress
   bar, and tells the device when its work has been reclaimed.
3. `POST /api/device-render/[attemptId]/upload` — `authorize` mints presigned
   part URLs for the key the attempt was given (never one the device chooses);
   `finish` assembles them.
4. `POST /api/device-render/[attemptId]/complete` — checks the completion
   against the attempt (job, step, stage, ratio, manifest version, upload key),
   then inspects the object: it must exist, be large enough to be a video, be
   H.264 at the exact canvas size for its ratio, be about the length the device
   reported, and **carry an audio track** unless it is a montage. A second
   completion returns the first result; one asset, never two.
5. `POST /api/device-render/[attemptId]/release` — hands the task back with its
   FIFO position and priority intact, so the Mac Mini worker takes it next.

Every refusal path leaves the task queued. A phone that cannot render is a phone
that renders nothing, never a job that stalls.

## Release gates

1. **Baseline:** measure one representative request on the Mac and on physical
   iOS/Android devices. Capture render time, battery drain, thermal state, free
   space, transfer bytes, and output inspection.
2. **Primary export:** render one 9:16 captioned master with the selected
   template on each OS and compare against the Mac output. This is the step the
   config currently admits.
3. **Montage and audio:** enable `MontageMerge` and `FfmpegComposition` only
   once the scene timeline, still-image motion, cropping, joins, voice, music
   and ducking match the fixtures. On Android, confirm whether the cross-dissolve
   composition exports on the target devices or falls back to hard cuts.
4. **Ratios and Travy:** enable `AdditionalRatios`, rendering each ratio
   independently and preserving completed assets if a later ratio fails. Travy
   always uses English and Chinese.
5. **Release:** turn on `DEVICE_RENDER_ENABLED`, admit devices through
   `deviceRenderEligibility.ts`, stage cohorts, watch fallback metrics.

## Test fixtures and release bar

Use a consented sample request containing a still image, a phone-shot video,
Thai/English/Chinese captions, music and voice. Assert duration, 30 fps,
H.264/AAC MP4, exact canvas size, audio sync, captions, fonts, subject framing,
and every requested output ratio. Include a low-storage phone, a low-memory
Android model, an older supported iPhone, app termination, lost Wi-Fi, an
expired upload URL, and worker reclaim.

Do not turn on `DEVICE_RENDER_ENABLED` until the Android build, the iOS Xcode
build, and physical-device exports on both platforms pass. **iOS has not been
built or run on a device from this workspace — it is Windows.** The Swift render
path is written and must be compiled and exercised on a Mac before any claim
about it is made.
