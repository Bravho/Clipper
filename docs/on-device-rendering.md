# On-device rendering implementation

## Local-first source media

Native iOS and Android submissions with DeviceVideoRender plugin version 2 or
newer keep original photos and clips in the
WebView origin private file system. The server receives an opaque `localId`,
file metadata, and compact JPEG derivatives for Gemini and the legacy worker. Original
bytes are not uploaded to object storage. The server persists one resized JPEG
proxy per original under the request so the existing montage worker has an
input. For a local video, that proxy is a still poster; source video motion is
not yet used. Web submissions and resumed legacy
drafts and older installed apps continue through the existing upload flow.
`NEXT_PUBLIC_LOCAL_FIRST_MEDIA=false` is an emergency rollback; the default is
on when the native capability and private storage checks pass.

The native render bridge is version 2. It stages an OPFS file into native app
cache in 2 MB chunks and validates the final byte count before Media3 or
AVFoundation opens it. Staged inputs and rendered outputs have separate release
methods and path validation confines deletion to the plugin cache directory.

Status: contract, admission policy, conditional device claims, local-first intake, a JPEG proxy bridge for the existing worker, and a native **single-master transcode primitive** are implemented. Android Java compilation passed; iOS awaits a Mac/Xcode build. Production rendering remains on the existing Mac worker. Local-first jobs can use the proxy images, but will not preserve source video motion or full original resolution. The full phone montage, captions, templates, verified output upload, and completion protocol remain to be implemented.

## Existing boundaries

- `VideoGenerationService._dispatchHeavy()` queues heavy work in `render_tasks` when a worker heartbeat is fresh.
- `RenderStep.OverlayComposition` starts with a completed, uncaptioned master. Its output is one `captionedExport_*` asset. This is the first integration target.
- `RenderStep.MontageAllSegments`, `MontageMerge`, `FfmpegComposition`, `AdditionalRatios`, and `TravyGeneration` remain worker tasks until their corresponding phone operation passes device validation.
- `DeviceVideoRenderPlugin` on both platforms accepts one completed master URL or one staged local video and writes a local H.264/AAC MP4. It does not draw captions, apply templates, mix separate tracks, upload an output, or finish a pipeline task. Its methods are intentionally not wired to the approval UI.
- AI calls, approval gates, credits, publishing, and the job record remain server-owned.

## Contract

`src/lib/mobile/deviceRenderContract.ts` defines the versioned render manifest. The server must construct it from approved job and asset records only. URLs in the manifest should be short lived and scoped to the exact source objects. Neither provider keys nor Spaces credentials belong in it.

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
