# Render performance: local master + Remotion tuning

Two changes aimed at the `additional_ratios` step, which measured **41.5 min of a
61 min job** on the Mac Mini worker.

## What was actually slow (read this first)

The original plan assumed one master video was being downloaded once per output
size. It isn't. **Each ratio has its own master** (`finalExport_<ratio>_assetId`),
and `_runFFmpegComposition` deliberately composes only the PRIMARY ratio so the
requester's review gate stays fast. Every other ratio's master is therefore built
*inside* `_runAdditionalRatiosOverlay`, on demand, by `_composeMasterForRatio`.

Per non-primary ratio that means:

| Work | Roughly |
|---|---|
| `_renderMontageBaseAtRatio` — a full Remotion montage render, one pass per scene | ~10.6 min (same work `montage_all_segments` measures) |
| `concatVideosWithCrossfade` — download segments, xfade, upload | ~1.6 min |
| `composeAndExport` — download base + voice, libx264 with music, upload | ~1.4 min |
| `renderTemplatedVideo` — the styled/captioned render | ~5.8 min |

**The montage re-render is the single biggest block, and neither change below
touches it.** Reusing one montage base across ratios would be the big win, but
`_renderSceneClipAtRatio` re-renders natively per ratio on purpose — every ratio
uses the same approved assets, durations, motion and subject-focus points, with
only the canvas differing, so there is no cropping. Changing that changes how the
videos are framed, which is a product decision, not a performance fix.

## Change 1 — serve the master from local disk

`_renderCaptionedRatio` used to pull the whole master from DO Spaces **twice** per
ratio: once in `probeAudioDurationSeconds` (which downloads a file just to read
its duration) and again inside Remotion, which fetches `masterUrl` over HTTPS from
sgp1.

Now `_renderStyledFromMaster` downloads it **once**, ffprobes that local copy, and
serves the same file to Remotion over loopback.

It has to be loopback HTTP, not a path: Remotion's asset downloader
(`@remotion/renderer/dist/assets/read-file.js`) accepts only `http://` and
`https://` and throws on anything else, so `file://` would break the render.
`src/lib/ai/localMediaServer.ts` binds a one-file server on `127.0.0.1` with an
ephemeral port, supports Range requests, and shuts down in a `finally`.

If the download fails the render still works — it falls back to the old behaviour
(probe by key, Remotion fetches the public URL). A Spaces hiccup costs time, not
the job.

### Temp file cleanup

The cached master is deleted in a `finally`, so it goes whether the render
succeeds, throws, or is cancelled. Ordering is safe: the loopback server is
closed by `withLocalMediaUrl`'s own `finally` before `_renderStyledFromMaster`'s
`finally` removes the directory.

The one case a `finally` cannot cover is the process being SIGKILLed mid-render
(OOM, power loss, `launchd` hard kill). For that, `sweepStaleRenderTemp()` runs at
worker startup and removes `clipper-*` temp directories in the OS temp dir older
than 6 hours. The age gate means it can never delete an in-flight render. The
worker's own scratch root is plain `clipper` with no dash, so it is not matched.

## Change 2 — Remotion render settings

`renderMedia` was called with only `codec` and `pixelFormat`; everything else was
default, meaning roughly half the cores and libx264's `medium` preset. All knobs
now live in `src/config/renderTuning.ts` and apply to the styled render, the
montage scene render, and the overlay render.

| Env var | Default | Effect |
|---|---|---|
| `REMOTION_CONCURRENCY` | number of CPU cores | Frames captured in parallel. **Lower this first** if 16 GB comes under pressure — each worker is a headless Chromium holding decoded frames. |
| `REMOTION_X264_PRESET` | `veryfast` | libx264 speed/compression trade-off. `medium` restores the old behaviour. |
| `REMOTION_HARDWARE_ACCELERATION` | `if-possible` | VideoToolbox H.264 on Apple silicon. Safe by construction — Remotion falls back to software when unsupported. `disable` forces software. |
| `RENDER_LOCAL_MASTER` | on | `false` goes back to fetching the master over the internet per ratio. |

Note the two encode settings interact: when hardware encoding engages,
`x264Preset` no longer applies (it is a libx264 option). Compare them
independently, not together.

## Measuring

These changes are **unverified against a real render.** They were developed in a
Linux sandbox with no route to Spaces or to the droplet's Postgres, so no request
was run and no output video was watched. Please do both.

Restart the worker so it picks up the new settings, then run one request:

```bash
# on the Mac Mini
launchctl kickstart -k gui/$(id -u)/com.rclipper.worker   # or: npm run worker
```

Before/after timings:

```sql
SELECT step, duration_ms
  FROM render_tasks
 WHERE state = 'done'
 ORDER BY finished_at DESC
 LIMIT 10;
```

Expect movement in `additional_ratios`, `overlay_composition` **and**
`montage_all_segments` — the last one only from change 2, since it renders no
master.

To isolate the two changes, run once with `RENDER_LOCAL_MASTER=false` (change 2
only), then once with it on.

### Watch the finished videos

A broken render does not raise an error, so check each output by eye:

- subtitles present, correctly timed, not clipped at the frame edge
- **Thai glyphs** — tone marks and upper/lower vowels sit correctly, no tofu boxes
- template frame / decorative graphics intact at every ratio
- audio in sync with the picture, and the clip runs the master's FULL length
  (a truncated clip means the duration probe fell back — check the logs for
  `failed to probe master duration`)

Also confirm nothing is left behind after a job:

```bash
ls -la "${TMPDIR:-/tmp}" | grep clipper-    # expect nothing from a finished job
```

## Baseline at time of change

`npx tsc --noEmit -p tsconfig.json` → 101 errors, all pre-existing and unrelated
(stale `.next/types`, missing optional deps `recharts` and
`@capacitor/push-notifications`). `npx jest --maxWorkers=2` → 3 suites / 4 tests
failing, all reproduced on a pristine tree: `UploadService` (sharp native module),
three `RequestPresentationService` date/queue display tests, and one
`VideoGenerationService` render-queue enqueue test. Identical counts before and
after these changes.

---

# Round 2 — the montage path

The three changes above left the biggest block untouched: the montage re-render
inside `additional_ratios`. These three attack the *waste around* it. None of
them changes a single output pixel. The irreducible part — actually rendering
every scene at every canvas — is still there, and still only removable by
cropping (see the top of this doc).

## Change 3 — one Chromium per step, not two per scene

`selectComposition` and `renderMedia` each launch their own headless browser
when no `puppeteerInstance` is passed, and `_renderMontageBaseAtRatio` calls
both **once per scene** — then the whole thing repeats per ratio. Six scenes
across four ratios was roughly 48 cold starts doing no rendering work.

`withSharedBrowser` (`src/lib/ai/remotionBrowser.ts`) opens one browser and
passes it to every render in the step. Scoped to a step, not the process: a
browser held for days accumulates memory on 16 GB, and a crashed one would
poison every later render.

**The gate you need to know about.** `openBrowser` on a machine with no Chromium
tries to download one, and when that download fails Remotion emits a *transient
unhandled rejection* before the error reaches our `catch` — which Node kills the
process for by default. `onBrowserDownload` does not prevent it (verified: the
download runs regardless). So nothing is opened until `prepareSharedBrowser()`
has confirmed at worker startup that a browser is present. The web server and
the test suite never call it, so both keep the old browser-per-render behaviour
exactly. The worker logs `shared render browser {enabled: true|false}` at
startup — check that line first if this change seems to do nothing.

## Change 4 — montage segments stay on disk

For a non-primary ratio, `renderScene` uploaded every scene segment to Spaces
and `concatVideosWithCrossfade` downloaded all of them straight back. Those
segments are pure intermediates — `_renderMontageBaseAtRatio` creates no
`UploadedAsset` for them and nothing ever surfaces them. Two full transfers of
the whole video, per ratio, for files nobody sees. (They weren't leaked
forever — `ai_videos/` has a 7-day lifecycle rule — but you paid the bandwidth
and the wait.)

`renderSceneToFile` + `concatLocalVideosWithCrossfade` keep them local and
upload only the finished base. The crossfade filtergraph is now shared between
the local and stored-key paths rather than duplicated, since the xfade offsets
and the `tpad` length correction are subtle enough that a second copy would
drift. The local path degrades the same way on failure: crossfade → hard cut.

**The primary ratio is deliberately unchanged.** Its segments become
`UploadedAsset` rows the requester reviews scene by scene, so they must be
stored.

## Change 5 — source assets cached across ratios

Each `renderMedia` keeps its own download cache, so the requester's photos and
clips came down from Spaces again for every scene render and every ratio.

`withLocalAssetCache` holds them on disk and serves them over the same loopback
mechanism as the master. Note this is scoped to the **whole additional-ratios
loop**, not to one ratio — the scenes within a ratio use different photos, so
all of the saving comes from the second and later ratios reusing what the first
already fetched. Scoping it per ratio would have made it pointless.

Per-asset fallback: an asset that fails to download keeps its Spaces URL and
Remotion fetches it as before, so one unreachable photo cannot fail a render.

## Extra env switches

| Env var | Default | Effect |
|---|---|---|
| `REMOTION_SHARED_BROWSER` | on | `false` → a browser per render, as before. |
| `RENDER_LOCAL_SEGMENTS` | on | `false` → upload each montage segment and download it back. |
| `RENDER_ASSET_CACHE` | on | `false` → every render fetches its own copies of the source media. |

Each is independent, so you can bisect a regression to one change without a
deploy: set the variable on the worker and restart it.

## Still unverified

Same as round 1 — no request was run and no video was watched from here. Beyond
the checklist above, this round specifically needs:

- the startup log line showing whether the shared browser engaged
- scene joins still cross-dissolving (change 4 touches the concat path; a hard
  cut at every join means the crossfade fell back — check the logs for
  `local crossfade concat failed`)
- the **primary** ratio's per-scene review thumbnails still appearing, since
  that path deliberately still uploads segments
- `ls "${TMPDIR:-/tmp}" | grep clipper-` clean after a job, now also covering
  `clipper-segments-` and `clipper-assets-`
