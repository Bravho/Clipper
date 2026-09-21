# On-device rendering implementation

The Mac Mini build and physical-iPhone smoke-test steps are in
`docs/mobile-rendering-mac-mini.md`.

## Local-first source media

Native iOS and Android submissions with DeviceVideoRender plugin version 2 or
newer keep original photos in the
WebView origin private file system. The server receives an opaque `localId`,
file metadata, and compact JPEG derivatives for Gemini and the legacy worker. Original
bytes are not uploaded to object storage. The server persists one resized JPEG
derivative per local photo under the request. Local video submission is rejected
before credit deduction while the native timeline is connected to the job
completion path; no video poster is accepted as a substitute for moving frames.
Web submissions and resumed legacy
drafts and older installed apps continue through the existing upload flow.
`NEXT_PUBLIC_LOCAL_FIRST_MEDIA=false` is an emergency rollback; the default is
on when the native capability and private storage checks pass.

The native render bridge is version 3 on iOS and Android. It stages an OPFS file into native app
cache in 2 MB chunks and validates the final byte count before Media3 or
AVFoundation opens it. Staged inputs and rendered outputs have separate release
methods and path validation confines deletion to the plugin cache directory.

Status: both native plugins now expose `renderLocalTimeline`, which hard-joins staged real video tracks with trims and aspect fill into a silent **intermediate montage** MP4. Like the original Remotion montage, it discards material clip audio. The **finished MP4 must not be silent**: it must contain the approved speaking voice and the selected background music, mixed with the original lead-in and ducking rules. That final audio stage is not implemented on the phone yet. The JavaScript bridge stages original local clips and calls the intermediate method. Android Java compilation and a debug APK build passed; iOS awaits a Mac/Xcode build and a real iPhone export. Local-first photo requests can still use JPEG derivatives, while local-first video requests fail explicitly until the moving output can be safely used by the pipeline. The full phone montage, captions, templates, verified output upload, and completion protocol remain to be implemented.

## Original behavior to preserve

| Operation | Existing implementation | Phone implementation status |
| --- | --- | --- |
| Source photos | Remotion animates stills with `ken_burns_in`, `ken_burns_out`, `pan_left`, `pan_right`, or `static`, with subject focus | Not implemented in native renderers |
| Source clips | Remotion trims, orders, optionally slows short footage, and **mutes source audio** | Both native engines can trim and hard-join local video tracks silently; slow-down remains missing |
| Scene transitions and merge | Remotion cut/fade/slide/zoom within a scene, FFmpeg crossfade between scenes | Not implemented on phone |
| Voice | ElevenLabs generates the approved voice remotely | Phone must download the generated voice; it must not use source-clip sound |
| Sound composition | FFmpeg adds a 0.6 s music lead-in, normalizes voice, loops music, ducks music under speech, and mixes the two | Not implemented on phone |
| Graphic motion and captions | Remotion renders the selected template and timed multilingual captions over the voiced master | Not implemented on phone |
| Ratios, Travy, cover | Separate ratio exports, EN+ZH Travy captions, JPEG poster from finished MP4 | Not implemented on phone |

An end-to-end phone render therefore needs: a manifest built from the approved
scene plan and cloud audio; native still-image frame generation and camera motion;
video trimming and ordering; transitions; voice/music mixing; template/caption
rendering; independent ratio exports; native streaming upload of **rendered**
outputs; server validation and idempotent job completion; and a cover extracted
from each verified finished video. Only original source media remains private.
The server must continue to own approvals, credits, AI calls, and publishing.

## Existing boundaries

- `VideoGenerationService._dispatchHeavy()` queues heavy work in `render_tasks` when a worker heartbeat is fresh.
- `RenderStep.OverlayComposition` starts with a completed, uncaptioned master. Its output is one `captionedExport_*` asset. This is the first integration target.
- `RenderStep.MontageAllSegments`, `MontageMerge`, `FfmpegComposition`, `AdditionalRatios`, and `TravyGeneration` remain worker tasks until their corresponding phone operation passes device validation.
- `DeviceVideoRenderPlugin` on both platforms accepts one completed master URL or one staged local video and writes a local MP4. Both also join multiple staged real video clips silently. They do not yet animate stills, draw captions, apply templates, mix separate voice/music tracks, upload an output, or finish a pipeline task. The timeline method is not yet wired to the approval UI.
- AI calls, approval gates, credits, publishing, and the job record remain server-owned.

## Contract

`src/lib/mobile/deviceRenderContract.ts` defines a version 3 render manifest shaped
like the approved scene plan: ordered assets per scene, the original Ken Burns
motion names, clip trims and focus, scene transitions, and an explicit
`sourceClipAudio: false` rule. It distinguishes a silent montage intermediate
from a final export that requires the approved voice, AAC audio, and any selected
music. It is validated but not yet emitted by a server
endpoint or consumed by either native engine. The server must construct it from
approved job and asset records only. URLs in the manifest should be short lived
and scoped to the exact source objects. Neither provider keys nor Spaces
credentials belong in it.

The server should hold a render-task lease for one device attempt. Completion must match its job ID, step, ratio, manifest version, and attempt ID. It must verify the uploaded object with a storage HEAD request and inspect its codec, dimensions, duration, and size before creating the `FinalClip` asset and completing the task. A second completion for the same attempt should return the first result. An expired attempt must not overwrite a later worker result.

The device should download to native files, render to a native file, and use multipart upload directly to Spaces. `nativeDownload.ts` converts an entire response to base64 for sharing; that method must not be used for render inputs or outputs. The client should keep local files until the server confirms completion.

## Native implementation targets

| Operation | iOS | Android |
| --- | --- | --- |
| Input download and output upload | URLSession file tasks | Native streaming transfers |
| Composition and H.264/AAC export | AVFoundation | Media3 Transformer |
| Timed captions and templates | Core Animation or a custom compositor | Media3 overlay effects or custom GL |
| Progress and cancellation | Export progress and task cancellation | Transformer progress and cancel |
| Durable background transfer | Background URLSession | Android background transfer worker |
| Long render after app backgrounding | OS-supported continued task when available; recover on interruption | Foreground service for user-visible export; recover on interruption |

The native engines must share the manifest's timeline semantics. Their output need not be byte-identical to FFmpeg but must meet the visual and audio acceptance fixtures.

## Phase gates

1. **Baseline:** measure one representative request on the Mac and on physical iOS/Android devices. Capture render time, battery drain, thermal state, free space, transfer bytes, and output inspection.
2. **Lease and upload:** atomic phone claim, heartbeat, expiry, multipart upload, verified idempotent completion, and Mac fallback. Test force-close and network-loss races.
3. **Primary export:** render one 9:16 master with captions and selected template on each OS. Compare to the Mac output.
4. **Montage and audio:** implement scene timeline, still-image motion, cropping, joins, voice, music, and ducking. The current crossfade requires custom Android work or an approved visual change.
5. **Ratios and Travy:** render each selected ratio independently and preserve completed assets if a later ratio fails. Travy always uses English and Chinese captions.
6. **Release:** server feature flag, device admission via `deviceRenderEligibility.ts`, staged cohorts, fallback metrics, and support tools.

## Test fixtures and release bar

Use a consented sample request containing a still image, a phone-shot video, Thai/English/Chinese captions, music, and voice. Assert duration, 30 fps, H.264/AAC MP4, exact canvas size, audio sync, captions, fonts, subject framing, and every requested output ratio. Include a low-storage phone, a low-memory Android model, an older supported iPhone, app termination, lost Wi-Fi, expired upload URL, and worker reclaim.

Do not turn on the server flag until the Android build, iOS Xcode build, and physical-device exports pass. iOS build and iPhone validation must be run later on a Mac; this workspace is Windows.
