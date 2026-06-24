# Real-Media Motion-Graphics Migration Plan

**Project:** clipper_agent
**Goal:** Replace the Veo-3.1 generative-video core with a real-media Remotion montage engine that animates the client's actual uploaded photos and clips, while keeping the audio-first voice → subtitles → 4-ratio export → publishing pipeline intact.
**Status:** Plan for approval — no code to be written until approved.

---

## 0. Decisions captured from open questions

1. **Uploads are a mix of stills and clips.** The renderer must sequence images (Ken Burns) and real video clips (trim + play) together. New upload rules: **video clips ≤ 45s each** and a **capped total upload size** per request.
2. **No "AI cinematic" promise was made**, but output must look professional. → **Veo is demoted** to an optional/internal engine: (a) automatic fallback when a request has no usable real media, and (b) an opt-in "AI intro / B-roll" add-on. It never sits on the default path.
3. **Remotion is the primary renderer** for the montage (asset layout, Ken Burns, transitions, text). **FFmpeg** stays for final mux: crop/scale to ratios, music ducking, voice mux, subtitle/overlay composite, concat.

---

## 1. Architectural strategy — preserve the `baseVideoAssetId` contract

The single most important property of the current code is that **everything downstream of video generation consumes exactly one field: `job.baseVideoAssetId`.** Animation overlays, FFmpeg crop/export, retry, and the review UI all read that one asset. Voice, subtitles, export, and publishing never knew or cared that Veo produced it.

**The migration keeps that contract.** The montage engine's job is to produce a `baseVideoAssetId` — a single concatenated real-media video at the primary platform's canvas size — exactly where Veo used to. Downstream code is then almost entirely unchanged, which is what makes the rollout safe.

### Pipeline mapping (states preserved, semantics swapped)

| Phase | Current (Veo) | New (Montage) | Enum state |
|------|----------------|---------------|------------|
| 1 | Vision writes Thai script | **Vision writes script + a rough storyboard (scenes with snapshots of the chosen photos/clips), approved together** | `AnalyzingContent` → `AwaitingContentApproval` |
| 2 | ElevenLabs voice + ffprobe duration + Gemini alignment | **+ displays the approved storyboard (read-only) so the user visualizes the story while reviewing the voice** | `GeneratingVoice` → `AwaitingVoiceApproval` |
| 3 | Vision writes scene plan (visual descriptions for Veo) | **Vision turns the approved storyboard + measured voice duration into the detailed montage plan (assets, motion presets, exact timing)** | `GeneratingSceneDesign` → `AwaitingSceneDesignApproval` |
| 4 (loop) | Per scene: Veo create/extend → review cumulative clip | **Per scene: Remotion renders that scene's real-media segment → review segment** | `AwaitingSceneScriptApproval` → `GeneratingBaseVideo` → `AwaitingVideoApproval` |
| 4-end | last scene = full cumulative Veo video | **concat approved segments → `baseVideoAssetId`** | → `GeneratingAnimations` |
| 5 | Claude motion specs + Remotion caption overlays per ratio | *(unchanged)* | `GeneratingAnimations` → `AwaitingAnimationApproval` |
| 6 | FFmpeg crop + overlay + music + subs, 4 ratios + Tvent | *(unchanged)* | `ComposingFinalVideo` → `AwaitingFinalApproval` |
| 7 | Social publishing | *(unchanged)* | `Publishing` → `Complete` |

**We keep the enum values** `GeneratingBaseVideo` / `AwaitingVideoApproval` (no DB churn, no `failedAtStep` migration) and only change their human-readable labels and internal behavior. The existing **per-scene requester approval loop driven by `currentSceneIndex` is retained verbatim** — that UX is exactly what the user wants to keep.

### The one semantic change inside the loop

`sceneVideoAssetIds` changes from **cumulative** (scene 1, then 1+2, then 1+2+3 — forced by Veo's extension model) to **per-scene independent segments** (scene 1, scene 2, scene 3). The concatenation that Veo did implicitly now happens explicitly with the already-existing `ffmpegService.concatVideos()` after the final scene is approved. This is simpler and removes the entire "extension" concept.

### Canvas / ratio decision (important quality note)

For the safe migration, the montage renders **once at the primary platform's canvas** (mirroring `toVeoAspectRatio`), and FFmpeg smart-crops to the other ratios exactly as today. This preserves the downstream contract with zero export changes.

**Caveat:** Ken Burns framing on a 16:9 base that is then cropped to 9:16 can lose intended composition. A clean **follow-up phase (8, optional)** moves to **per-ratio montage rendering** in Remotion (the `OverlayComposition` already proves per-ratio rendering via `RATIO_DIMENSIONS` + `calculateMetadata`). I recommend shipping single-base first, then upgrading to per-ratio once the engine is proven, rather than doing both at once.

### Storyboard — a new Stage-1 artifact carried through the early stages

A **storyboard** is generated at Stage 1 alongside the script and approved with it. It is a *rough, pre-voice* visual breakdown — an ordered set of scenes, each with a one-line summary and thumbnail snapshots of the photos/clips that scene will draw from. It is deliberately lighter than the montage `ScenePlan`: **no motion presets and no exact durations yet** (those are decided at Stage 3 once the real voice length is known).

- **Stage 1 (`AnalyzingContent` → `AwaitingContentApproval`):** Vision produces `storyboard` from the script + the canonical ordered asset list; the requester reviews/edits and approves it together with the script (stored as `approvedStoryboard`).
- **Stage 2 (`AwaitingVoiceApproval`):** the approved storyboard is shown **read-only** beside the voice player so the requester can picture the story while judging the voiceover.
- **Stage 3 (`GeneratingSceneDesign`):** `generateSceneDesignFromScript` takes `approvedStoryboard` as its **seed** and refines it into the detailed montage `ScenePlan` (assigns motion presets, snaps scene/asset durations to the measured voice length, optionally splits/merges scenes). The storyboard's asset selection/order is preserved unless the requester changed it.

Because the storyboard, the montage plan, the approval panels, and the renderer all index into the **same** `getOrderedSourceAssets()` ordering, an asset thumbnail shown in the Stage-1 storyboard is guaranteed to be the same asset rendered in Stage 4 — the alignment guarantee now spans the whole pipeline.

---

## 2. Remotion montage template spec

A new composition `MontageScene` renders **one scene segment** (so the per-scene approval loop can preview/approve each independently). A scene is an ordered list of real assets, each with a motion preset and on-screen duration.

### Inputs (`MontageSceneInputProps`)

```ts
interface MontageAsset {
  url: string;                 // DO Spaces public URL of the real photo/clip
  kind: "image" | "clip";
  motion: "ken_burns_in" | "ken_burns_out" | "pan_left" | "pan_right" | "static";
  durationSeconds: number;     // on-screen time for this asset
  trimStartSeconds?: number;   // clips only (OffthreadVideo startFrom)
  trimEndSeconds?: number;     // clips only (OffthreadVideo endAt)
  focusX?: number;             // 0..1 Ken Burns / crop focus (reuse Gemini coords)
}

interface MontageSceneInputProps {
  ratio: VideoRatio;           // canvas size from RATIO_DIMENSIONS
  durationSeconds: number;     // scene total (sum of asset durations)
  assets: MontageAsset[];
  transitionIn: "cut" | "fade" | "slide" | "zoom";
  // captions/text are NOT here — they stay in the existing Overlay pass (phase 5)
}
```

### Rendering rules

- **Images → Ken Burns.** `<Img src={url}/>` inside a `<Sequence>`, with `interpolate(frame, [0, durFrames], [scaleStart, scaleEnd])` driving a CSS `transform: scale()/translate()`. Presets map to scale/translate keyframes (`ken_burns_in` 1.0→1.12, `pan_left` translateX 0→-6%, etc.). `focusX` shifts the transform-origin so motion centers on the dish/signage (reuse `geminiSubtitlesService.detectProductCoordinates`, already called at compose time).
- **Clips → trimmed playback.** `<OffthreadVideo src={url} startFrom={trimStart*FPS} endAt={trimEnd*FPS}/>`. Enforce the 45s cap upstream; renderer additionally clamps `endAt - startFrom` to the asset's `durationSeconds`.
- **Transitions.** Use `@remotion/transitions` (`<TransitionSeries>` with `fade()`, `slide()`, `wipe()`) between assets and at scene boundaries. Default `fade` ~300ms. Keep it tasteful (one transition style per video for a professional look).
- **Cut timing.** Phase 1: asset durations come from `_allocateSceneDurations()` (already exists) scaling scene durations to the real voice length. **Beat-synced cuts** are a later enhancement (phase 8) requiring music onset analysis.
- **Audio.** None — montage segments are silent video. **Background music and the voiceover are both retained and added at the FFmpeg compose step (Stage 6), unchanged.** `composeSingleRatio` already loads the chosen track from `public/music/{selectedMusicTrack}.mp3`, loudness-normalizes the voice, ducks the music under it via `sidechaincompress`, mixes, and limits — that logic stays exactly as-is. The requester still selects the track (`selectedMusicTrack`) at the animation-approval step, and it flows through to every ratio export plus the Tvent export. Keeping music out of the silent montage segments is deliberate: it lets one continuous, voice-ducked music bed run across the whole concatenated video instead of restarting per scene.
- **Output.** `montageService.renderScene()` renders H.264 MP4 (`codec: "h264"`, `pixelFormat: "yuv420p"`) at the chosen ratio's dimensions and FPS=30 (matches `remotion/types.ts` `FPS` and the export step's expectations), uploads to DO Spaces, returns the stored segment.

### Why segments, then concat

Rendering per scene keeps the existing per-scene gate UX and lets a single scene be re-rendered on revision without redoing the whole video. All approved segments share identical codec/dimensions/FPS, so `ffmpegService.concatVideos()` can stream-copy them into `baseVideoAssetId` with no re-encode (it already has a re-encode fallback).

---

## 3. Files to add / change / remove

### ADD

- **`remotion/MontageScene.tsx`** — the scene composition described in §2.
- **`remotion/kenBurns.ts`** — pure helpers mapping motion presets → interpolated transform keyframes (unit-testable).
- **`remotion/montageTypes.ts`** (or extend `remotion/types.ts`) — `MontageAsset`, `MontageSceneInputProps`, motion preset enums; reuse `RATIO_DIMENSIONS`, `FPS`.
- **Register `MontageScene`** in **`remotion/Root.tsx`** (second `<Composition>` with `calculateMetadata` for per-ratio dims, same pattern as `Overlay`).
- **`src/lib/ai/montageService.ts`** — server entry: `renderScene(params) → { storageKey, storageUrl, ... }`. Mirrors `remotionService.ts` (lazy `@remotion/bundler`, `selectComposition`, `renderMedia`, upload to Spaces). **Refactor the bundle helper** so `remotionService` and `montageService` share one cached `getBundleLocation()` (avoid bundling twice per process).
- **`src/config/montage.ts`** — motion preset table, default transition, `MAX_CLIP_SECONDS = 45`, `MAX_TOTAL_UPLOAD_BYTES`, base-canvas policy.
- **`src/db/migrations/006_real_media_montage.sql`** — see §4.
- **Tests:** `tests/lib/ai/montageService.test.ts` (pure helpers: duration allocation, asset ordering, preset mapping), `tests/services/VideoGenerationService.montage.test.ts` (per-scene loop, concat, revision/retry), `tests/remotion/kenBurns.test.ts`.

### CHANGE

- **`src/domain/models/VideoGenerationJob.ts`** — extend `ScenePlan` with `assets: MontageAsset[]` and `transitionIn`; add the `StoryboardScene` type and `storyboard` / `approvedStoryboard` fields; keep `imageIndexes`/`visualDescription` as `@deprecated` for legacy rows. Update the doc comment on `sceneVideoAssetIds` (cumulative → per-scene). Add `videoEngine: "montage" | "veo"` and `aiBrollEnabled`.
- **`src/domain/enums/VideoGenerationStep.ts`** — keep enum values; rewrite `PIPELINE_STEP_LABELS` / `PIPELINE_STEP_DESCRIPTIONS` for the montage wording (e.g. "Building your video from your photos and clips…", "Scene clip ready for review"). `GeneratingBaseVideo` stays in `POLLING_STEPS`.
- **`src/services/VideoGenerationService.ts`** (the core change):
  - **Stage 1:** `_runChatGptAnalysis` also generates the storyboard (via the Vision change above) and persists `storyboard`; `approveContent` / `startFromRequesterApproval` / the analyze route persist `approvedStoryboard` alongside the approved script. **Stage 3:** `_runSceneDesignGeneration` passes `approvedStoryboard` into `generateSceneDesignFromScript`.
  - Replace `_runVideoGeneration` and `_runNextVideoExtension` with a single **`_renderSceneSegment(job, sceneIndex)`** that calls `montageService.renderScene` and writes the segment into `sceneVideoAssetIds[sceneIndex]` (non-cumulative). Run it fire-and-forget like `_runAnimationGeneration` (background, transition to `AwaitingVideoApproval` on completion).
  - Simplify **`checkBaseVideoReady`**: no Veo polling for the montage path — it just returns the job (Remotion render completes inline in the background task and sets the next step). Keep a Veo-polling branch only for AI scenes.
  - **`approveBaseVideoByRequester`**: on the **last** scene, call `ffmpegService.concatVideos(approvedSegmentKeys)` → create base asset → set `baseVideoAssetId` → `GeneratingAnimations`. (Earlier scenes: advance `currentSceneIndex`, unchanged.)
  - **`approveSceneScriptByRequester`**, **`requestVideoRevisionByRequester`**, and the **`retryPipeline` `GeneratingBaseVideo` branch**: swap Veo create/extend calls for `_renderSceneSegment`; the trim-on-revision logic stays but no longer needs cumulative reasoning (drop one scene's segment, re-render that index only).
  - Keep `_allocateSceneDurations` and `_selectSceneImages` (generalize the latter to ordered images **and clips**).
  - Move `_buildVeoScenePrompt`, `createVideo`/`extendVideo`/`pollTaskStatus` usage into a new **`_renderAiScene`** branch used only by the add-on/fallback.
- **`src/lib/ai/chatGptVisionService.ts`** — two changes:
  - **Stage 1:** add storyboard generation — either extend `generateSpeakingScript` to also return a `StoryboardScene[]`, or add `generateStoryboard()`. It uses the canonical ordered asset list and the script to produce rough scenes + asset snapshot selection (no motion/timing yet).
  - **Stage 3:** rework `generateSceneDesignFromScript` to accept `approvedStoryboard` as a **seed**, then **selects/confirms the assets** (images + clips), assigns a motion preset per asset, times scenes to `voiceDurationSeconds`, and returns `assets[]`. Drop the Veo anti-fabrication prompt scaffolding from the default path (it proves the old tool fought the goal).
- **`src/lib/ai/ffmpegService.ts`** — no API change; `concatVideos` is reused for segment assembly; `composeAndExport` unchanged. Confirm segment codecs match so stream-copy concat holds.
- **`src/lib/ai/remotionService.ts`** — only the shared-bundle refactor; overlay rendering otherwise unchanged.
- **`src/lib/ai/animationService.ts`** — unchanged.
- **`src/config/aiTools.ts`** — keep the `veo` block (now used only by the add-on/fallback); add `montage` settings or import from `config/montage.ts`.
- **UI:**
  - **`ContentApprovalPanel.tsx`** (Stage 1) — add a storyboard editor below the script: render each rough scene with its summary and asset thumbnails (from the shared ordered list), let the requester reorder scenes/assets and tweak summaries, and approve script + storyboard together. A new shared `Storyboard` view component is worth extracting here for reuse in Stage 2.
  - **Voice approval panel** (`VideoApprovalPanel`/voice section at `AwaitingVoiceApproval`) — render the approved storyboard **read-only** beside the voice player.
  - **`SceneDesignApprovalPanel.tsx`** — seed the displayed montage plan from the storyboard; show the montage plan (ordered assets + thumbnails + motion preset per asset + scene timing) instead of Veo visual descriptions.
  - **`SceneScriptApprovalPanel.tsx`** — let the requester reorder assets, pick **clips as well as images** (currently filtered to `AssetType.Image` only — include `AssetType.Video`), choose a motion preset, and set clip trim; relabel Thai copy.
  - **`VideoApprovalPanel.tsx`** (1.6k lines) — relabel Veo → montage; review the rendered **scene segment**; keep approve / revise / regenerate actions.
  - **`ProductionPipeline.tsx`** — remove the `GeneratingBaseVideo` "รอ Veo AI…" sub-status strings; relabel phase 3.
- **Uploads (new constraints):** `src/features/requests/validation/clipRequestSchema.ts`, `src/features/requests/components/NewRequestForm.tsx`, `src/app/api/uploads/[requestId]/route.ts` + `.../confirm/route.ts` — enforce **per-clip ≤ 45s** (probe duration on confirm) and **total upload size cap** (sum of `fileSizeBytes`).
- **Persistence:** `PostgresVideoGenerationJobRepository.ts` + the Mock repo — add column mappings for any new job fields (§4). `ScenePlan` changes need no schema change (stored as JSON TEXT).
- **`CLAUDE.md`** — update the "AI video pipeline" section to describe the montage engine.

### REMOVE (Phase 5 cleanup, after montage is verified in prod)

- Cumulative-extension code paths in `VideoGenerationService` and `veoService.extendVideo` (extension is unused once segments+concat replace it; the add-on only needs `createVideo`).
- Dead "cumulative scene" comments/branches in `checkBaseVideoReady`.
- **Do not** remove `veoService.ts` — `createVideo` + `pollTaskStatus` + `downloadAndStore` stay for the add-on/fallback.

---

## 4. Data-model + Postgres migration

Most new per-scene data lives inside the JSON of `approved_scene_plan`, so the migration is intentionally small. New migration **`006_real_media_montage.sql`** (idempotent, `IF NOT EXISTS`, matching the existing migration style):

```sql
ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS video_engine TEXT NOT NULL DEFAULT 'montage',  -- 'montage' | 'veo'
  ADD COLUMN IF NOT EXISTS ai_broll_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS storyboard TEXT,            -- JSON StoryboardScene[] (rough, pre-voice)
  ADD COLUMN IF NOT EXISTS approved_storyboard TEXT;   -- JSON StoryboardScene[]
```

New storyboard type on `VideoGenerationJob` (`storyboard` + `approvedStoryboard`, both `string | null`):

```ts
interface StoryboardScene {
  sceneNumber: number;
  summary: string;          // rough Thai scene description
  assetIndexes: number[];   // snapshots, indexing getOrderedSourceAssets()
  roughDurationHint?: number; // optional pre-voice estimate (not binding)
}
```

- **No change to `scene_video_asset_ids`** column — only its meaning changes (cumulative → per-scene). Legacy rows from in-flight Veo jobs are drained before cutover (§7), so no data reinterpretation is needed.
- `ScenePlan.assets` / `transitionIn` ride inside the existing `approved_scene_plan` TEXT/JSON — covered by `serializeJobValue`/`parseJsonField`, **no column needed**.
- Update `rowToJob`, `JOB_UPDATE_COLS`, the `create` INSERT, and the Mock repo to map `video_engine`, `ai_broll_enabled`, `storyboard`, and `approved_storyboard`.
- Optional `AssetType` additions (enum only, no migration): `MontageSceneSegment` for per-scene clips (or reuse `AIGeneratedBaseVideo` for the concatenated base).

**Sandbox gotcha:** per the project note, run `npm test` / `tsc` **locally** — the sandbox can serve stale/truncated files and report phantom errors. The Read tool is the source of truth.

---

## 5. Keeping Veo as an optional effect (off the main path)

- **Gating:** `job.videoEngine` defaults to `'montage'`. The Veo code path is reached only when `videoEngine === 'veo'` (add-on) or via the **no-media fallback**.
- **No-media fallback:** if `getOrderedSourceAssets(requestId)` returns zero usable images/clips, scene design sets `videoEngine='veo'` and renders via `veoService.createVideo` (Veo 3.1 first+last-frame mode) — the only case the default flow touches Veo.
- **AI intro / B-roll add-on:** `aiBrollEnabled` (set at request submission, priced via credits) inserts a single Veo-generated scene (e.g. an atmospheric intro) into the montage; that one scene renders through `_renderAiScene` and is concatenated with the real-media segments like any other segment. Hero food shots are always real media.
- **Polling:** Veo remains async, so its polling branch in `checkBaseVideoReady` is retained but only exercised for `'veo'` scenes. Montage scenes use the fire-and-forget/transition pattern.

This keeps Veo fully functional and credit-billable without it ever being the default.

---

## 6. Test strategy

Mirror `services/` under `tests/`, instantiate **fresh Mock repos with `new Map()`** (never the global singletons), per CLAUDE.md.

- **`tests/lib/ai/montageService.test.ts`** — pure logic only (no headless Chromium in CI): duration allocation, ordered asset mapping (images+clips index alignment), motion-preset selection, clip-trim clamping. Mock `@remotion/renderer` + Spaces upload.
- **`tests/remotion/kenBurns.test.ts`** — transform keyframe math per preset.
- **`tests/services/VideoGenerationService.montage.test.ts`** — the per-scene loop with `montageService` and `ffmpegService.concatVideos` **mocked**: scene 0 render → approve → scene 1 → … → last scene concat → `GeneratingAnimations`; revision re-renders only the target scene; `retryPipeline` resumes the failed scene; `currentSceneIndex` stays aligned (the known footgun from the current code).
- **Index-alignment test:** a single `getOrderedSourceAssets` ordering is shared by the Stage-1 storyboard, the Stage-3 montage plan, the approval panels, and the renderer — assert the same index resolves to the same asset across all of them (prevents the "scene shows wrong photo" class of bug).
- **Storyboard flow test:** Stage 1 produces + persists a storyboard; approval writes `approvedStoryboard`; Stage 3 seeds the montage plan from it (asset selection/order preserved unless edited).
- **Downstream regression:** existing voice/subtitle/export/publish tests must pass unchanged (proves the `baseVideoAssetId` contract held).
- **Upload constraints:** schema/route tests for 45s clip rejection and total-size-cap rejection.
- Run `npm test` locally (sandbox unreliable).

---

## 7. Safe rollout order

Each phase is shippable and leaves voice/subtitles/export/publishing working.

- **Phase 0 — Upload rules.** Enforce ≤45s clips + total size cap (schema, form, upload routes). Independent; ship first.
- **Phase 1 — Engine in isolation.** Add `MontageScene` composition, `montageService`, shared bundle helper, config, `kenBurns` helpers + unit tests. Not wired into the pipeline yet. Nothing user-facing changes.
- **Phase 2 — Storyboard + scene design + model.** Extend `ScenePlan` (`assets`, `transitionIn`), add `StoryboardScene` + `storyboard`/`approvedStoryboard`, run migration 006. Add Stage-1 storyboard generation (Vision + service + `ContentApprovalPanel` editor + shared `Storyboard` view), show it read-only at Stage 2, and seed `generateSceneDesignFromScript` from it at Stage 3. Update `SceneDesignApprovalPanel` + `SceneScriptApprovalPanel` to show/edit assets + motion + clips. Veo still renders (read assets, ignore for now) so the path stays green.
- **Phase 3 — Swap the renderer (flagged).** Behind `videoEngine`, replace per-scene Veo with `_renderSceneSegment`, switch `sceneVideoAssetIds` to per-scene, add concat at the last scene. Default new jobs to `'montage'`; let in-flight Veo jobs **drain** (don't migrate mid-flight rows). Verify end-to-end on staging, then make `'montage'` the default for all new jobs.
- **Phase 4 — Demote Veo.** Wire the no-media fallback + AI add-on toggle; relabel UI (`ProductionPipeline`, `VideoApprovalPanel`); remove Veo from default copy.
- **Phase 5 — Cleanup.** Remove cumulative-extension code + `veoService.extendVideo`; update `CLAUDE.md`.
- **Phase 8 (optional, later) — Quality upgrades.** Per-ratio montage rendering (best framing per platform) and beat-synced cuts.

Throughout, the unchanged `GeneratingAnimations → ComposingFinalVideo → Publishing` tail guarantees the rest of the system keeps producing finished, multi-ratio, subtitled, published videos.

---

## Key risks & mitigations

- **Ratio cropping of Ken Burns framing** → ship single-base first; upgrade to per-ratio rendering in Phase 8.
- **Index drift between Vision / panel / renderer** → one shared `getOrderedSourceAssets` ordering + a dedicated alignment test.
- **Remotion render time / cold-start** (headless Chromium) on long mixed-media scenes → reuse the lazy cached bundle, fire-and-forget background render with the existing poll-on-step-change UX; cap clip length (45s) and total assets.
- **Concat codec mismatch** → render all segments with identical codec/dims/FPS; `concatVideos` already falls back to re-encode.
- **In-flight Veo jobs at cutover** → drain rather than migrate; gate by `videoEngine`.
- **Sandbox staleness** → verify with local `npm test`; trust the Read tool.
