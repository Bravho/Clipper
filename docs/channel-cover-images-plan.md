# Channel cover images — hook-bearing thumbnails per distribution channel

## Context

**What exists today.** RClipper already extracts stills, in exactly two ways, and both produce the same artifact:

1. **Browser capture at upload** — `NewRequestForm.probeVideo()` (`src/features/requests/components/NewRequestForm.tsx:164-247`) draws a `<video>` frame to a canvas, `toDataURL("image/jpeg", 0.7)`, and posts it as `posterDataUrl` to `src/app/api/uploads/[requestId]/confirm/route.ts`, which calls `storePosterThumbnail()`.
2. **Server-side ffmpeg** — `generateVideoThumbnail()` (`src/lib/thumbnails.ts:151`) probes duration, seeks to `duration / 2`, `-frames:v 1 -q:v 2`. Orchestrated by `ensureAssetPoster()` (`src/services/AssetPosterService.ts`), which is idempotent, never throws, and logs every failure under `[poster]` with a classified reason.

Both funnel into `compressAndUpload()`, which clamps the result to **≤320 px longest edge and <20 KB JPEG**, stored at `thumbnails/{userId}/{date}/{requestId}/{uuid}-{label}.jpg` (`buildThumbnailKey`, `src/lib/spacesKeys.ts:121`) with a 730-day lifecycle.

`VideoGenerationService._attachChannelPreviews()` (line ~3151) then puts that poster on each channel's draft as `ChannelPublishingDraft.previewImageUrl`, using the captioned export at that channel's ratio. `DistributionReviewPanel.tsx` (lines ~640-670) renders it read-only as "ภาพปก" with a download link.

**The three gaps.**

- **No text.** The poster is a bare video frame. Nothing writes a hook, headline or label onto it. The AI *already produces* `hookThai` (`chatGptVisionService.ts` — "the first 3 seconds draw attention from the viewer from scrolling"), but that hook only ever becomes spoken audio and burned-in subtitles. It never reaches the still image a scroller actually sees first.
- **Wrong size.** 320 px / 20 KB is a UI preview. YouTube wants ≥1280×720; every platform's cover minimum is far above this. These images are physically unusable as covers.
- **Never delivered.** `_postToChannel()` (line ~3466) receives `draft` — `previewImageUrl` included — and drops it. There is no `thumbnails.set`, `video_cover_timestamp_ms`, `cover_url` or `thumb` call anywhere in `src/`. Every channel gets whatever frame the platform auto-picks.

**Intended outcome.** Each channel gets a purpose-built cover: a well-chosen frame at full platform resolution with the video's own hook composited on it, respecting that channel's safe area, reviewable and editable by the requester before confirm, and pushed into the platform's real cover field at publish time.

**Scope decisions (confirmed with the user):** generator pipeline only (Management/post-for-me follows later); auto-generate then let the requester edit; push to the platform APIs; headline reuses the existing AI hook rather than adding a new AI call.

---

## Design

### The one architectural decision: Remotion, not ffmpeg `drawtext`

Compositing the headline goes through a new Remotion still, not `drawtext`. Reasons, all evidenced in this repo:

- `AI_CONFIG.ffmpeg.fontFile` still defaults to `C:\Windows\Fonts\tahoma.ttf`, and `ffmpegService.stageFiltergraphSafeFont()` exists purely to work around filtergraph path escaping. Thai text through `drawtext` inherits all of that.
- The Remotion bundle is already built and cached (`getRemotionBundle()`, `src/lib/ai/remotionBundle.ts`), already renders Thai captions correctly (`CaptionOverlay.tsx`), already owns the palette (`paletteService.Palette`) and the template aesthetic (`src/config/motionTemplates.ts`).
- `@remotion/renderer` is pinned at `^4.0.300`, which exposes `renderStill()`. No new dependency.

A cover is therefore a one-frame Remotion composition over a full-resolution extracted frame — visually consistent with the video the requester just approved.

### Poster vs cover — keep them separate

`thumbnailKey`/`thumbnailUrl` and `previewImageUrl` keep their current meaning (small UI preview) and current behaviour. The cover is a **new, additional** artifact. Nothing existing changes shape, so `VideoLibrary`, `ClipTrimBar`, `TravyVideoFeedService.resolveThumbnail` and the two backfill scripts are untouched.

### No database migration

`ChannelPublishingDraft` is already persisted as JSONB (`video_generation_jobs.publishing_drafts`, migration `009_publishing_drafts.sql`). Adding an optional `cover` object to that interface needs no DDL.

---

## Implementation

### 1 — Domain & config

**`src/domain/enums/AssetType.ts`** — add `ChannelCover = "channel_cover"`.

**`src/domain/models/VideoGenerationJob.ts`** — extend `ChannelPublishingDraft` (line ~296) with an optional `cover`:

```ts
export interface ChannelCover {
  assetId: string;
  url: string;
  /** Frame position this cover was cut from — also what TikTok receives. */
  sourceTimestampSeconds: number;
  headline: string;
  styleId: string;                 // src/config/coverStyles.ts
  origin: "auto" | "frame_picked" | "headline_edited" | "uploaded";
  /** Small candidate frames for the picker, so the UI never re-renders to browse. */
  candidates?: { seconds: number; url: string }[];
  pushStatus?: "pending" | "pushed" | "unsupported" | "failed";
  pushError?: string | null;
}
```

**`src/config/channelCovers.ts`** (new) — per-channel cover spec: pixel size, `maxBytes`, `headlineMaxChars`, safe-area insets, and `pushMode`. Derive the ratio from `_montageCanvasRatio` rather than hardcoding — there are already **two disagreeing ratio tables** in the repo (`PLATFORM_ASPECT_RATIOS` in `Platform.ts` vs `getRequiredRatiosForPlatforms` in `ffmpegService.ts`, which differ on Facebook/Travy). Do not add a third source of truth; `_postToChannel` uses `_montageCanvasRatio`, so the cover must too.

| Channel | Size | Max bytes | Headline | Push mode |
|---|---|---|---|---|
| YouTube | 1280×720 | 2 MB | ~40 ch | `image_upload` (`thumbnails.set`) |
| Facebook | 1280×720 | 4 MB | ~45 ch | `image_upload` (`thumb`, multipart) |
| Instagram | 1080×1350 | 8 MB | ~35 ch | `cover_url` (public Spaces URL) |
| TikTok | 1080×1920 | — | ~30 ch | `timestamp_only` |

Safe areas matter and are channel-specific: TikTok/Reels UI chrome eats roughly the bottom 20% and right 15%. A headline centred for YouTube sits underneath the TikTok caption stack.

**`src/config/coverStyles.ts`** (new) — 3–4 styles in the same shape as `MOTION_TEMPLATES`: `clean` (no text), `bottom_scrim`, `bold_bar`, `sticker`. Drives the picker UI and validation; the actual rendering lives in the Remotion bundle keyed by `id`, exactly as `motionTemplates.ts` documents for templates.

### 2 — Full-resolution frame extraction

**`src/lib/ai/frameExtract.ts`** (new, or a new export in `src/lib/thumbnails.ts`):

- `extractFrameAtSecond(sourceKey, destKey, seconds)` — modelled on `generateVideoThumbnail` but **without** the 320 px / 20 KB clamp. Keep that function's two hard-won behaviours: the empty-output guard, and letting `ENOENT` propagate unwrapped so the `ffmpeg_missing` vs `generation_failed` classification still works.
- `extractCandidateFrames(sourceKey, n = 5)` — even positions via the existing `frameTimestamps()` helper in `src/lib/ai/videoFrames.ts`; score each with `sharp` stats (sharpness + contrast) and return them ranked so the default frame is a good one rather than a blind midpoint. Store the candidates through the existing `compressAndUpload` path — they are filmstrip thumbnails, 320 px is right for them.

**`src/lib/spacesKeys.ts`** — add `buildCoverKey(userId, requestId, platform, variant)` → `covers/{userId}/{date}/{requestId}/{platform}/{uuid}-{variant}.jpg`.
**`src/config/spacesLifecycle.ts`** — `covers/` at 730 days, matching `thumbnails/`.
**`src/config/mediaPrefixes.json`** — add the covers prefix so `scripts/retention-sweep.js` skips it.

### 3 — Compositing

**`remotion/CoverCard.tsx`** (new) + registration in `remotion/Root.tsx` with `durationInFrames: 1`, following the existing `calculateMetadata` pattern that derives width/height from `inputProps` (all three current compositions do this).

**`remotion/types.ts`** — `CoverCardInputProps { ratio, frameUrl, headline, styleId, palette, safeArea, width, height }` + `DEFAULT_COVER_CARD_PROPS`.

**`src/lib/ai/remotionService.ts`** — new `renderCover(params)` alongside `renderOverlay` / `renderTemplatedVideo`: `selectComposition` + `renderStill({ imageFormat: "jpeg", jpegQuality })`, then a `sharp` pass to clamp under the channel's `maxBytes`, then `spacesUpload`. Same `getRemotionBundle()` and tmpdir-cleanup shape as its two neighbours.

### 4 — Headline copy (no new AI call)

**`src/lib/publishing/coverHeadlinePolicy.ts`** (new), sitting beside `channelCopyPolicy.ts`:

- `deriveCoverHeadline({ hookThai, title, caption, placeName, platform })` — take `hookThai` (already written by `SCENE_DESIGN_SYSTEM_PROMPT` to grab attention in the first three seconds), strip trailing punctuation and emoji runs, hard-trim on a word boundary to `headlineMaxChars`; fall back title → first caption line → place name.
- `validateCoverHeadline(platform, text)` mirroring `validateChannelCopy` so the UI gets the same live-counter treatment as the caption fields.

This follows the precedent set explicitly in `_shapeDraftForChannel`: *"Content is NOT rewritten by another AI call per channel — it is deterministically shaped here."*

### 5 — Orchestration

**`src/services/ChannelCoverService.ts`** (new) — copy `AssetPosterService`'s contract wholesale: idempotent, never throws, one `[cover]` log prefix, a `CoverFailureReason` union, an early `DO_SPACES_BUCKET` guard, lazy `sharp`/Spaces imports.

- `ensureChannelCover(job, platform, draft)` → candidates → best frame → headline → `renderCover` → create an `UploadedAsset` of type `ChannelCover` → return the `ChannelCover` object.
- `regenerateChannelCover(job, platform, { seconds?, headline?, styleId?, uploadedKey? })` for requester edits.

**`src/services/VideoGenerationService.ts`**

- `_attachChannelPreviews` (line ~3151) keeps its existing poster logic and gains a cover pass.
- **This must be dispatched, not run inline.** `renderStill` boots headless Chromium and the frame extraction downloads the whole MP4; `_attachChannelPreviews` currently executes inline in a web request on the droplet on the no-additional-ratios path. Add `channel_covers` to `RenderStep` (`src/domain/enums/RenderStep.ts`) with its `RENDER_STEP_FAILED_AT` entry and route through `_dispatchHeavy` (line 755). The `switch` in `runQueuedRenderStep` (lines 894-940) ends in `const _exhaustive: never = step`, so the compiler will force the worker path to be handled.
- New `saveChannelCoverByRequester(...)` next to `savePublishingDraftsByRequester` (line 3238).

### 6 — Review UI

**`src/features/requests/components/DistributionReviewPanel.tsx`** — replace the read-only figure at lines ~640-670 with a `ChannelCoverEditor` sub-component per channel card:

- the composited cover at that channel's true ratio, with a dashed **safe-area guide** overlaid
- a filmstrip of the candidate frames plus a scrubber for an arbitrary timestamp
- the headline input with a live char counter — same pattern as the existing caption fields (`validateChannelCopy`, lines 578-590)
- a style chip row, shaped like the motion-template picker
- "upload your own cover" file input
- a regenerate button; the render is async, and `PipelineStatusPoller` already polls this step

**`src/app/api/requests/[id]/channel-cover/route.ts`** (new, PATCH) — modelled directly on `publishing-drafts/route.ts`: same session/`Role.Requester`/ownership guards, same `{ jobId, ... }` body shape, same 400-vs-500 error split.

### 7 — Delivery to the platforms

All four adapters gain an optional `cover` parameter. **A cover push must never fail the post** — the video is already live by then; catch, record `pushStatus: "failed"`, carry on.

- **`youtubeService.ts`** — after `uploadVideo` returns `videoId`, `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=…` with the JPEG body. ⚠️ **Ops prerequisite:** the stored refresh token must carry the `youtube` scope (not just `youtube.upload`) and the channel must be phone-verified. If it returns 403, degrade to `"unsupported"`, not `"failed"`, and surface that distinction — same reasoning as `AssetPosterService`'s ops-vs-media split.
- **`facebookService.ts`** — add `thumb` to the finish phase. This changes the request from a JSON body to multipart `FormData`, so it is a real edit, not a field addition.
- **`instagramService.ts`** — add `cover_url` (a public Spaces URL) to the REELS container create call. `thumb_offset` is the fallback if the URL is rejected.
- **`tiktokService.ts`** — add `post_info.video_cover_timestamp_ms` from `sourceTimestampSeconds * 1000`. **Be honest in the UI:** TikTok accepts a *frame choice*, not an image. The composited headline cannot reach TikTok through the API — it only arrives if burned into the video's opening frames. Mark TikTok's `pushStatus` as `"unsupported"` for the image and offer the download.
- **`_postToChannel`** (line ~3466) — pass `draft.cover` into each call and merge the push outcome back onto the draft, alongside the existing `status`/`url`/`error` merge.

---

## Verification

1. `npm run lint` and `npx tsc -p tsconfig.check.json` — the `never` exhaustiveness check on `runQueuedRenderStep` is the main compile-time gate.
2. Unit tests in `tests/` following the repo's fresh-mock-repo pattern (`new MockUploadedAssetRepository(new Map())`):
   - `deriveCoverHeadline` — trimming, word boundaries, each fallback rung, per-channel limits.
   - `ChannelCoverService` — idempotency (second call is a no-op), and that every failure path returns `null` instead of throwing.
   - Cover-spec table — every `PUBLISHABLE_PLATFORMS` entry has a spec, and its ratio agrees with `_montageCanvasRatio`.
3. `npx remotion studio` against `remotion/index.ts` — eyeball `CoverCard` at all four ratios with real Thai headlines. Check descender clipping and safe-area collisions; this is the step that catches font problems before a render costs five minutes.
4. End-to-end on dev: run a request through to `awaiting_distribution_review`, confirm a cover appears per channel, pick a different frame, edit the headline, regenerate, and verify the new asset lands under `covers/` in Spaces at full resolution.
5. Publish path: start with **Instagram or Facebook**, not YouTube — YouTube's `thumbnails.set` needs the scope and channel-verification work done first, and it will 403 until then.

## Risks

- **YouTube scope.** The current refresh token almost certainly lacks the `youtube` scope. Re-consent is an ops task with a lead time; plan the push work around it rather than blocking on it.
- **Worker load.** Each cover is a headless-Chromium boot plus an MP4 download. Four channels per job is four of each. Render candidates *once per ratio* and share them across channels that map to the same ratio (YouTube and Facebook both use 16:9) rather than fanning out per channel.
- **`.remotion-bundle` is currently empty on this machine** — the first cover render will pay a full bundle build.
- **Style-vs-substance.** A composited headline can trip platform policy on "misleading thumbnails". `moderatePublishingContent` already gates title/caption/video; the headline should be added to that same gate rather than getting its own.
