# Device render parity contract

The exact behaviour a phone render must reproduce, traced from the existing
Remotion + FFmpeg pipeline that runs on the Mac Mini render worker. Every number
here is read out of the current code, not invented; each row names its source so
a change on the server side can be followed into the native engines.

This document is the acceptance specification for
`src/lib/mobile/deviceRenderContract.ts` (manifest v4) and for the two native
renderers. `docs/on-device-rendering.md` tracks what is implemented;
`docs/mobile-rendering-mac-mini.md` is the device validation procedure.

---

## 1. Canvas, timing and frame rate

| Property | Value | Source |
| --- | --- | --- |
| Frame rate | 30 fps everywhere (montage segments, overlay renders, final exports) | `config/montage.ts` `MONTAGE_FPS`, `remotion/types.ts` `FPS`, `ffmpegService` `fps=30` in `crossfadeConcatLocal` |
| 9:16 | 1080 × 1920 | `RATIO_OUTPUT_DIMENSIONS` in `ffmpegService.ts` |
| 16:9 | 1920 × 1080 | same |
| 1:1 | 1080 × 1080 | same |
| 4:5 | 1080 × 1350 | same |
| Primary ratio | `PLATFORM_ASPECT_RATIOS[targetPlatforms[0]]`, defaulting to 9:16 | `VideoGenerationService._montageCanvasRatio` |
| Required ratios | union over the request's platforms: tiktok/travy_app → 9:16, youtube/facebook/cdn → 16:9, instagram → 4:5; empty → 9:16 | `getRequiredRatiosForPlatforms` |
| Video codec / container | H.264 in MP4, `yuv420p`, `+faststart` on the styled pass | `composeSingleRatio`, `overlayOnMaster` |
| Audio codec | AAC, 48 000 Hz | `composeSingleRatio` (`-c:a aac -ar 48000`) |

**Scene duration allocation.** Each scene's `durationSeconds` comes from the
approved scene plan. Within a scene, `allocateAssetFrames` splits the scene's
frame count between its assets in proportion to each asset's `durationSeconds`,
guarantees every asset at least one frame, and gives the final asset the
rounding remainder so the ranges are contiguous and sum exactly
(`remotion/montageMotion.ts`).

**Total length.** The merged export runs for
`max(baseVideoDuration, voiceDuration + leadIn)`
(`composeSingleRatio`). When the picture is shorter than the audio by more than
0.05 s, the shortfall is filled with **black frames**, not a frozen last frame
(`tpad=stop_mode=add:color=black`, padded by the deficit + 0.5 s); when the
picture already covers the voice, only 0.5 s of clone padding is added to absorb
frame rounding. `-t` then trims to exactly the computed length.

---

## 2. Still images — camera motion

`remotion/montageMotion.ts` `getKenBurnsKeyframes`. Progress `p` runs 0 → 1
linearly across the asset's on-screen frames; the transform is
`scale(s) translate(tx%, ty%)` about a transform origin of
`focusX*100% focusY*100%` (defaults 50 %/50 %), with `object-fit: cover`.

| Preset | scale from → to | translateX % from → to | translateY |
| --- | --- | --- | --- |
| `ken_burns_in` | 1.00 → 1.12 | 0 → 0 | 0 |
| `ken_burns_out` | 1.12 → 1.00 | 0 → 0 | 0 |
| `pan_left` | 1.08 → 1.08 | −4 → +4 | 0 |
| `pan_right` | 1.08 → 1.08 | +4 → −4 | 0 |
| `static` | 1.00 → 1.00 | 0 → 0 | 0 |

Note the sign convention: the image translates **opposite** to the camera, so
`pan_left` moves the oversized image rightwards to reveal its left edge. The
translate is a percentage **of the element's own box**, applied after the scale,
matching the CSS `transform` order `scale() translate()`.

`focusX`/`focusY` come from Gemini subject detection
(`VideoGenerationService._detectFocusByIndex`, box centre ÷ 1000, clamped to
0…1) and are the transform origin — they steer both the Ken Burns zoom and the
cover crop toward the dish or signage.

---

## 3. Source clips

* Clips always play with **`motion: "static"`** — `toRenderAssetSpecs` forces it
  and the manifest validator rejects anything else.
* `trimStartSeconds` / `trimEndSeconds` select the footage window. Where the plan
  carries no window, the server probes the real duration with ffprobe and pins
  `trimEnd = min(duration, start + slotSeconds)` before rendering
  (`_buildSceneRenderSpec`).
* **Source audio is discarded** (`<OffthreadVideo muted>`); the merged master's
  only audio is the approved voice plus the selected music.
* When a clip's slot is longer than its footage, the clip is **slowed** to fill
  the slot: `playbackRate = clamp(footage / slot, 0.8, 1)`
  (`computeClipPlaybackRate`, `MIN_CLIP_PLAYBACK_RATE = 0.8`, i.e. at most a
  1.25× stretch). A rate below that floor is not used — the planner is expected
  to move the surplus to stills.
* Framing is `object-fit: cover` on the target canvas with the focus point as
  transform origin — fill and centre-crop, never letterbox, never squash.

---

## 4. Transitions

**Within a scene** (`remotion/MontageScene.tsx`): `TRANSITION_DURATION_SECONDS =
0.2` (6 frames at 30 fps). Every asset after the first mounts `fadeFrames`
early, overlapping the previous asset's tail, and cross-dissolves in over that
window — a true dissolve, never a dip to black. The overlap borrows from the
adjacent slot rather than trimming, so the scene's total length is unchanged and
the voiceover stays in sync. The dissolve is clamped to at most half of the
shorter of the two neighbouring shots. `transition: "cut"` sets the fade to 0.

The named transitions layer an extra flourish on top of the same dissolve:

| Transition | Extra transform while fading in |
| --- | --- |
| `cut` | none, and no dissolve |
| `fade` | none |
| `slide` | `translateX((1 − fade) × 12 %)` |
| `zoom` | `scale(1.04 − 0.04 × fade)` |

**Between scenes** (`ffmpegService.crossfadeConcatLocal`): an `xfade` of
`fadeSeconds = 0.2`, never longer than half the shortest segment and never below
0.05 s. Join *k*'s offset is the running accumulated duration minus the fade.
Because each overlap shortens the result, the concatenated base is padded by
`fade × (n − 1) + 0.2` s of cloned final frame so the base outlasts the voice;
the compose step's black tail covers any remaining shortfall. A failed xfade
degrades to a hard-cut concat rather than losing the render.

**On Android** (`ManifestRenderer.buildMontage`) there is no transition
primitive at all, so the dissolve is built out of TWO video sequences: shot *i*
goes on sequence *i* % 2, and `CrossDissolveCompositorSettings` ramps the alpha
of sequence 1 across each join. Three consequences follow from that, and all
three are load-bearing:

- Sequence 1's first entry is shot 1, which only appears once shot 0 has been on
  screen for a while, so **that sequence always opens with a gap**. Since Media3
  1.8 a sequence whose first item is a `Gap` cannot infer what to fill it with,
  and `EditedMediaItemSequence.Builder.build()` throws *"If the first item in the
  sequence is a Gap, then forceAudioTrack or forceVideoTrack flag must be set"*
  — before a single frame is encoded. Both lanes therefore set
  `experimentalSetForceVideoTrack(true)`; the montage is picture only, so the
  gap fills with blank frames, invisible because the compositor holds lane 1 at
  alpha 0 for exactly that span.
- A single shot leaves lane 1 empty, and a timeline of pure cuts leaves it
  holding nothing but gaps. Media3 rejects both, so `buildMontage` picks the
  single-sequence build in those cases rather than discovering it by exception.
- `ManifestJob` BUILDS as well as exports inside the hard-cut fallback, because
  the two-sequence composition can be refused at build time. A rejected
  composition and a rejected export are the same outcome for the requester:
  hard cuts are a real video, a raw Media3 message is not.

---

## 5. Audio

Constants in `src/lib/ai/ffmpegService.ts`; the filtergraph is
`buildMusicMixFilters`.

| Property | Value |
| --- | --- |
| Music-only lead-in | `MUSIC_LEAD_IN_SECONDS = 0.6` — the voice is delayed by this; the export length is extended to match so no narration is clipped |
| Music bed level | `MUSIC_BED_VOLUME = 0.3` (linear) |
| Voice loudness normalisation | `loudnorm=I=-16:LRA=11:TP=-1.5` |
| Ducking | `sidechaincompress=threshold=0.03:ratio=2.5:attack=20:release=300` keyed by the **delayed** voice |
| Music looping | `aloop=-1` then `atrim` to the full clip length — music covers the intro, the narration and the trailing ending |
| Voice padding | `apad=whole_dur=<total>` **before** the sidechain split, so the key runs the whole clip and the music recovers to full level under the ending |
| Final mix | `amix=inputs=2:normalize=0` then `alimiter=limit=0.95:level=false` |
| No music selected | the voice is simply padded with trailing silence to the full clip length; there is no lead-in (`leadIn = 0`) |

The ordering matters and is part of the contract: **normalise → delay → pad →
split**, with one branch keying the sidechain and the other going into the mix.
Ducking therefore only engages once the voice actually starts; the music-only
intro, the gaps between sentences and the ending all sit at the full bed level.

`src/lib/mobile/deviceRenderAudio.ts` restates these constants and the
envelope-follower maths in a form both native engines implement directly,
because neither Media3 nor AVFoundation ships a sidechain compressor.

---

## 6. Captions

The captions that ship are drawn by `Subtitles` in `remotion/TemplatedVideo.tsx`
(the styled render `_renderCaptionedRatio` runs). Earlier revisions of this
section described `CaptionOverlay.tsx`, the older transparent-overlay path; the
phone renderers now follow `TemplatedVideo` (plugin v6, 23 Sep 2026).

Every size is multiplied by the SHORT side: `s = min(width, height) / 1080`, so
a 16:9 export gets captions the same size as a 9:16 one (the old `height / 1920`
rule shrank them to 56 % on landscape).

| Language | Font | Size | Colour | Field | Split above |
| --- | --- | --- | --- | --- | --- |
| `th` | Sarabun / Noto Sans Thai | 62 | `#FFFFFF` | `textThai` | 26 chars |
| `en` | Arial / Helvetica | 52 | `#FFFFFF` | `textEnglish` | 30 chars |
| `zh` | Microsoft YaHei / Noto Sans SC | 50 | `#FFE066` | `textChinese` | 16 chars |

* Stack: one bottom-anchored column, `bottom = 150`, `gap = 16`, side margin
  48, languages in the requested order.
* Text: weight 800, line-height 1.22, centred, black stroke `6`
  (`paint-order: stroke fill`), shadow `3px 3px 6px rgba(0,0,0,0.9)` (plain
  pixels, not scaled).
* Wrapping (`wrapCaption`): at or under the language's budget, one line;
  otherwise TWO lines balanced by length on word boundaries — spaces for
  English, dictionary word breaks for Thai and Chinese (`Intl.Segmenter` in
  the browser, `BreakIterator` on Android, `.byWords` on iOS — all ICU). A
  balanced line still wider than the frame wraps again.
* Plate behind the text: `rgba(0,0,0,0.4)`, radius 18, padding `10 / 26`.
* Appearance: linear fade-in over 150 ms with a scale pop `0.96 → 1.00`,
  transform origin bottom centre.
* Only the single cue whose `[startSecond, endSecond]` contains the current time
  is drawn.

**Timing.** The timeline is `job.subtitleTimeline` (falling back to
`voiceTimestamps`), split into display-length cues by `splitSegmentsForDisplay`,
then **shifted by the music lead-in** (`+0.6 s`) because the master opens on
music alone. The render duration is `voiceDuration + leadIn`, floored by the
probed master duration. This shift is the single most common source of
out-of-sync captions and is carried explicitly in the manifest.

**Languages.** `job.subtitleLanguages`, defaulting to `["en", "zh"]`. The Travy
export ignores that and always renders **English + Chinese**.

---

## 7. Templates and graphic motion

`src/config/motionTemplates.ts` names six Looks by `id`. Since 10 Oct 2026 what
they LOOK like — and how they move — is the reference renderer
`src/lib/motionTemplates/templateRenderer.ts` (motion formulas in `motion.ts`),
which the studio's example frames use directly. Android `TemplatePainter.java`
(+ `TemplateMotion.java`) ports it call for call; iOS `OverlayPainter.swift`
builds Core Animation layers whose moving properties are sampled from the same
formulas once per video frame. Change all three together.

**The timeline.** The manifest's template carries `beats` (scene cut times in
picture seconds, mid-crossfade) and `endSeconds` (the finished video's length,
`max(picture, voice + lead-in)`), from `templateTimelineForScenePlan`. Builds
that predate them ignore both; a renderer given neither still enters and
breathes but has no cut accents, progress or outro. Every Look has:

- **intro** (first ~1.5 s): staggered, eased entrances, overshoot on pops
- **idle**: slow low-amplitude loops (breathing, drift, twinkle)
- **beat**: a short accent on every cut, peaking on the cut itself
- **outro** (last ~1.2–1.4 s): a closing gesture that frames the call-to-action

| id | what it draws |
| --- | --- |
| `none` | nothing |
| `clean_frame` | white corner brackets that grow out of the corners with an overshoot, breathe ±5s, punch 16s inward on cuts and close 22s inward at the end; two accent ripples from (13 %, 84 %); a segmented scene-progress bar 54s from the top (plain accent bar with no length) |
| `framed_cream` | the video inset in the white card on a neutral→secondary diagonal wash; two flat colour blobs drifting in the margins (never in the window); branch draws on then sways ±2.5°; wave drifts; dots bob; two sparkles twinkle and pop on cuts; an accent comet runs round the card on each cut, and the card is outlined in accent at the end |
| `editorial` | scrims; hairline frame that draws on (eased); kicker dot pops and pulses on cuts, rule extends; a rolling `02 / 05` scene counter top-right; an accent frame draws over the hairline at the end |
| `bold_pop` | three colour stripes shooting in from top-left and bottom-right and sliding; five floating confetti shapes; a slanted accent + secondary wipe across every cut; a progress line along the bottom edge |
| `cinematic` | letterbox bars sliding in, with accent hairlines; vignette; a drifting secondary light leak; an anamorphic flare (flash + glow + core streak) across every cut; bars close in and the frame darkens at the end |

Android redraws the bitmap every frame (all Looks move all the time); static
parts — scrims, the warm canvas, the card with its blurred shadow, the
vignette — are cached bitmaps blitted per frame. For `framed_cream` the picture
is scaled to cover the card's window before the template layer draws around it.

The old Mac render (`remotion/TemplatedVideo.tsx`) still draws the original,
mostly static versions of the first three Looks; for the new ids the backup
pipeline renders the nearest old one (`legacyTemplateId`: `bold_pop` →
`clean_frame`, `cinematic` → `editorial`). Older phone builds pick by `frame`
for an id they do not know, so both new Looks fall back to `clean_frame`.

The palette (`primary`, `secondary`, `accent`, `neutral`) is derived per job
from the place name, the matching business profile and the script
(`_deriveOverlayPalette`); `DeviceRenderService` now calls the same method
(`deriveOverlayPaletteForJob`) rather than a narrower derivation, defaulting to
`#FF6B35 / #FFB703 / #06D6A0 / #FFFFFF`. The express lane picks a decorated
template at random rather than shipping the bare clean render.

**Scene transitions.** Between scenes the server always crossfades 0.2 s. The
phone honours the studio's per-scene choice instead: a scene whose transition
in is `cut` starts on a hard cut; `fade`, `slide` and `zoom` dissolve.

---

## 8. Exports, Travy and cover

1. `_runFFmpegComposition` composes the **primary ratio's** un-captioned master
   (base + voice + ducked music) and stops at `AwaitingFinalApproval`. Other
   ratios are composed on demand later.
2. `_runOverlayComposition` renders the primary ratio's styled/captioned export
   from that master and stops at `AwaitingOverlayApproval`.
3. `_runAdditionalRatiosOverlay` renders each remaining required ratio,
   composing any missing master on demand. A later ratio failing must not
   discard the ratios that already landed.
4. The **Travy** export is a separate render at the Travy ratio with English +
   Chinese captions, run in the background and **soft-failing**: a Travy error
   sets `travyVideoStatus = "failed"` and never fails the job.
5. Every finished export gets a JPEG **poster** through
   `ensureAssetPoster(assetId, "poster-<ratio>")` — idempotent, never throwing,
   stored under the long-lived `thumbnails/` prefix and carried into RClipper
   Management at transfer time. The poster is extracted **from the finished
   video**, never substituted from a source photo.
6. Masters land under `final_exports/…` via `buildFinalClipKey`; the watermarked
   sibling path (`preview_exports/…`) is retained but dormant.

---

## 9. Ownership that never moves to the phone

Gemini analysis and scene design, ElevenLabs voice generation, approval gates,
credits and allowances, publishing, and the authoritative `VideoGenerationJob`
record all stay on the server. The phone receives a **validated manifest built
from approved job data only**, renders it, uploads the result to a scoped key,
and the server verifies the object before it becomes a `FinalClip`.

The manifest carries short-lived, object-scoped URLs. It never carries provider
keys or Spaces credentials.

---

## 10. Lease, completion and fallback

* One queued `render_tasks` row is claimed for one device attempt
  (`claimForDevice` — requester-scoped, `state = 'queued'` only; a worker claim
  wins any race).
* The attempt row (`device_render_attempts`, migration 035) pins job, step,
  ratio, stage, manifest version and upload key, and holds the lease expiry.
* `touchClaim` is the heartbeat; a stale claim is reclaimed by the Mac worker
  through the normal `claimNext` path, which is the fallback.
* Completion must match the attempt's job, step, ratio, stage and manifest
  version, the uploaded object must pass a storage `HEAD` and a media
  inspection (codec, dimensions, duration, size), and the second completion of
  the same attempt returns the first result unchanged.
* An expired attempt must not overwrite a later worker result: completion is
  refused once the attempt is no longer the claim owner.
