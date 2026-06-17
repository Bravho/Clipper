# Audio-First Pipeline Restructure — Implementation Plan

## -1. Scope addition: remove Staff role (requester self-service)

Decided 2026-06-14: the Staff/Editor role is being removed entirely. The
requester now performs every action currently gated behind Staff:
- Triggering the pipeline on their own `ClipRequest` (was: staff-initiated)
- Voice recording step (was: staff records, then ElevenLabs converts)
- All approval gates: content, video, voice, animation, final (was: split
  staff/requester approvals — now all requester)

Implications across the codebase (found via the 86 pre-existing TS errors
plus `src/middleware.ts` / `src/config/routes.ts`):
- `src/domain/enums/Role.ts` — remove `Staff`/`Editor`, keep `Requester`
  and `Admin` (Admin role/usage TBD — currently out of scope unless it
  blocks compilation)
- `src/middleware.ts` — remove `/staff` route protection block entirely
- `src/config/routes.ts` — remove staff home path from `getRoleHomePath()`
- `src/services/staff/*` (`StaffWorkflowService`, `StaffRequestPresentationService`,
  `VideoGenerationService`) — fold staff-only methods into requester-facing
  services, or move under a non-staff-namespaced location or `features/requests/`
- `src/app/(auth)/staff/**` pages and `src/features/staff/**` components —
  remove or fold into requester dashboard (`(auth)/dashboard`)
- API routes under `src/app/api/staff/**` — remove or move to
  `src/app/api/requests/[id]/*` with requester-only auth checks
- `CapCutProjectRef`/`editingProgressNote`/`exportReady` fields referenced
  by failing tests appear to belong to a staff-only "editing" workflow —
  likely removable along with Staff, but verify nothing else depends on them
  before deleting
- Approval gate consolidation: with one role approving everything, consider
  whether separate `contentApprovedBy`/`videoApprovedBy`/`voiceApprovedBy`/
  `animationApprovedBy`/`finalApprovedBy` fields are still meaningful as
  distinct fields (they'll all be the same user) — likely keep them for
  audit/history but all populated with the requester's id.
- Seed accounts table in `CLAUDE.md` needs updating to drop the
  `staff@clipper.internal` row once Staff is removed (note for later,
  not done as part of code changes).

This is being done as **Phase 0**, before the audio-first reordering,
because it's needed to get the baseline compiling and because the new
step ordering's approval-gate design (section 3 below) depends on knowing
there's only one approving role.

## 0. Repo state warning (read first)

Two files central to this work are currently **uncommitted and truncated mid-edit**:
- `src/domain/models/VideoGenerationJob.ts` (cuts off mid-property: `failedAtSt...`)
- `src/lib/ai/geminiSubtitlesService.ts` (cuts off mid-comment before `generateAssSubtitles`)

`git status` shows ~17 modified files, all uncommitted, from a previous in-progress edit. Before any restructure work starts:

1. Decide whether to recover the in-progress edit (check editor autosave / IDE history / `git stash list` / `git fsck --lost-found`) or revert these two files to last commit (`a577aa3`) and re-apply intended changes manually.
2. Get the project back to a state where `npm run build` and `npm test` succeed.
3. Commit a clean baseline before touching the pipeline. This is a hard prerequisite — the restructure touches both files directly.

## 1. Goal

Reorder the pipeline so the **voice track (with real timestamps) becomes the timing source of truth**. Script → Voice → Music → Subtitles (from real timestamps) → per-scene video generation (correct durations + per-scene prompts/images) → motion-graphics/transition compositing → final export.

## 2. New pipeline step order

Current:
```
1. ContentAnalysis (script+scene plan)
2. Kling base video (combined prompt, fixed 15s)
3. Voice recording + ElevenLabs conversion
3.5. "Animation" (Gemini subtitle alignment + FFmpeg drawtext overlays)
4. FFmpeg composition (subtitles, music, multi-ratio export)
5. Social publishing
```

Proposed:
```
1. ContentAnalysis (script + scene plan, per-scene durations as estimates only)
2. Voice recording + ElevenLabs conversion  [MOVED UP]
   -> capture real per-segment/word timestamps from TTS output
3. Music selection/generation [MOVED UP — can run in parallel with step 2]
4. Subtitle generation from real timestamps (replaces Gemini re-alignment)
5. Per-scene video generation (Kling), each scene sized to its real
   duration from step 2's timestamps, using its own visual description
   + assigned images (imageIndexes, currently discarded)
6. Motion-graphics/transition compositing layer
   (the real "step 3.5" — kinetic captions, scene transitions,
   lower-thirds — driven by the same timestamp data)
7. FFmpeg final composition: concat per-scene clips, burn subtitles +
   overlays, mix music, export 4 ratios + Tvent variant
8. Social publishing (unchanged)
```

## 3. Status enum changes (`VideoGenerationStep` / job status)

New ordering of `VideoGenerationStep` enum + corresponding `AwaitingXApproval` statuses:

- `AnalyzingContent` → `AwaitingContentApproval` (unchanged)
- NEW: `GeneratingVoice` → `AwaitingVoiceApproval` (replaces old voice step, now runs earlier)
- NEW: `SelectingMusic` (or fold into voice approval gate — requester picks track alongside voice approval)
- NEW: `GeneratingSubtitles` (likely fast/no approval gate, or combine with voice approval)
- `GeneratingBaseVideo` → `AwaitingVideoApproval` (now per-scene, Kling runs after voice/timestamps known)
- `GeneratingAnimations` → `AwaitingAnimationApproval` (now real motion-graphics/transition compositing, not drawtext)
- `ComposingFinalVideo` → `AwaitingFinalApproval` (unchanged role, simpler — most timing decisions already made)
- `Publishing` → `Complete`

Approval gates may need consolidation — re-ordering increases the number of steps; consider whether all need separate staff/requester approval or whether some can be merged (e.g., voice+music+subtitles reviewed together).

`failedAtStep` / `retryPipeline()` logic in `VideoGenerationJob.ts` and `VideoGenerationService.ts` must be updated for the new step list so retries resume correctly.

## 4. Data model changes (`VideoGenerationJob.ts`)

- Add `voiceTimestamps: TimedSegment[]` — real per-segment timing from ElevenLabs output (word or sentence level), captured at the voice step. This replaces the post-hoc `subtitleTimeline` produced by Gemini alignment.
- `ScenePlan[]` entries need `imageIndexes` to actually be consumed downstream (currently parsed but unused) — verify this field survives once the corrupted file is restored.
- Per-scene video assets: replace single `baseVideoAssetId` with `sceneVideoAssetIds: string[]` (one Kling output per scene) plus a concat step before final composition.
- `selectedMusicTrack` stays as-is, just selected earlier in the flow.
- Update `subtitleTimeline` to be derived directly from `voiceTimestamps`, not from Gemini re-alignment of audio (Gemini's `alignAudioWithScript` becomes unnecessary if TTS timestamps are reliable — verify ElevenLabs actually returns usable timestamp data for Thai before removing the alignment fallback entirely).

## 5. Service-level changes

- **`elevenLabsTtsService`**: confirm/extend to request and return word/character-level timestamps (ElevenLabs supports this via a timestamps endpoint or response field — needs verification). This becomes the new source of truth.
- **`chatGptVisionService`**: scene plan durations become *initial estimates* only; real durations come from step 2. English/Chinese script translation (currently lazy, done during old step 3.5) should move earlier so all three language scripts exist before voice generation, since voice is generated per target language... or confirm: is voice generated once and subtitles multi-language, or per-language voice tracks? (Needs clarification — see Open Questions.)
- **`geminiSubtitlesService`**: `alignAudioWithScript` likely removed or demoted to fallback-only. `generateAssSubtitles` reused but fed directly from `voiceTimestamps` instead of Gemini-aligned `subtitleTimeline`. Restore truncated file first.
- **`klingService`**: change from one call with combined prompt + full image set to N calls (one per scene), each with that scene's `visualDescriptionThai`, its `imageIndexes`-selected images, and `durationSeconds` from real voice timing for that scene.
- **`animationService`**: repurpose from FFmpeg drawtext text-overlay specs to real motion-graphics/transition definitions (concrete implementation depends on chosen compositing approach — FFmpeg filter graphs for transitions/kinetic text vs. a templating tool like Remotion). This is the largest open design question (see below).
- **`ffmpegService`**: add a concat step for per-scene clips before the existing composition step; subtitle burn-in now reads `voiceTimestamps`-derived ASS directly; remove the crude `buildBilingualSrt` fallback once timestamp-based subtitles are reliable (keep as last-resort fallback only).

## 6. Sequencing / migration approach

Recommend implementing in phases rather than one big rewrite:

**Phase 1** — Fix repo state (section 0), restore corrupted files, get a clean committed baseline.

**Phase 2** — Reorder steps without changing per-scene video generation: move voice generation before Kling, generate subtitles from real TTS timestamps (if available) instead of Gemini re-alignment, keep Kling as a single combined-prompt call but now sized to the real total voice duration instead of a fixed 15s. This alone should fix subtitle/script mismatch and audio/video length mismatch with the smallest change.

**Phase 3** — Per-scene Kling generation using `imageIndexes` and real per-scene durations from timestamps; add concat step.

**Phase 4** — Replace drawtext-based "animation" step with real motion-graphics/transition compositing.

Each phase is independently shippable and testable, and Phase 2 alone addresses the two specific complaints (subtitle mismatch, missing animation polish gets partially better from correct timing even before Phase 4).

## 6.5 Phase 4 decision: Remotion-based compositing layer (multi-ratio)

Decided 2026-06-14: Phase 4 ("GeneratingAnimations" step) will use Remotion to
render motion-graphics/caption/transition overlays, driven by
`voiceTimestamps`/`subtitleTimeline`/`animationSpec`. Key requirements:

- **Multi-aspect-ratio support is required from the start.** The final export
  step already produces 4 ratios (9:16, 16:9, 1:1, 4:5) + a Tvent-specific
  9:16 variant (`getRequiredRatiosForPlatforms`, per the selected
  `targetPlatforms`). Remotion overlays must be rendered per-ratio, since
  caption placement/sizing and any transition graphics need to fit each
  aspect ratio's frame, not just be cropped from one master.
- **Architecture**: Remotion renders one transparent (alpha-channel) overlay
  clip per required ratio — captions, kinetic text, lower-thirds, and any
  scene-transition graphic elements that can be expressed as an overlay.
  Clip-to-clip blending between Kling scene clips (if any "goo"-style scene
  transition is wanted) likely still happens in the existing FFmpeg concat
  step (section on per-scene Kling/concat) — Remotion overlays sit on top of
  the already-concatenated base video.
- **Pipeline integration**: `GeneratingAnimations` step renders N Remotion
  overlay clips (N = number of required ratios for the request's
  `targetPlatforms`), stores them (new job field, e.g.
  `animatedOverlayAssetIds: Record<string, string>` keyed by ratio string,
  JSON-serialized like other map/array fields). `AwaitingAnimationApproval`
  review shows one representative ratio (e.g. 9:16) composited preview.
- **Final composition (`ComposingFinalVideo`)**: for each required ratio,
  FFmpeg takes (a) the base video scaled/cropped to that ratio, (b) that
  ratio's Remotion overlay clip, (c) voice + music, and composites into the
  final per-ratio export — replacing the current drawtext-based overlay
  step entirely for ratios Remotion covers.
- **New infra**: Remotion render runs via `@remotion/renderer` (Node API,
  headless Chromium) — needs to be invokable from the existing service layer
  (likely a new `src/lib/ai/remotionService.ts` alongside `ffmpegService.ts`,
  `klingService.ts`). Needs its own timeout/error handling distinct from
  FFmpeg's, and `failedAtStep`/retry must cover Remotion render failures.
- **Template scope for first pass**: start with one composition template
  covering kinetic captions (driven by `subtitleTimeline`, in the
  ThaiStyle/EngStyle/ChiStyle languages already configured) plus simple
  scene-number-based motion (e.g. animated lower-third per scene from
  `scenePlan`). True "goo"/morph transition graphics can be a follow-up
  template once the rendering plumbing is proven.

## 7. Open questions to resolve before/during Phase 1

1. Does ElevenLabs return reliable word-level timestamps for Thai (`eleven_v3`)? If not, the Gemini alignment step may need to stay as primary, with this plan instead fixing *only* the ordering (voice before Kling) and improving the alignment prompt/fallback.
2. Is one voice track generated per request (with multilingual subtitles overlaid), or per-language voice tracks? Affects whether script translation must complete before or after voice generation.
3. What's the target for "goo animation" — literal goo/morph transitions, or general motion graphics polish? This determines whether Phase 4 is an FFmpeg filter-graph effort or requires a templating tool (Remotion, After Effects automation, etc.) — worth a focused spike before committing to an approach.
4. How many approval gates does the team actually want in the new flow — consolidating voice+music+subtitle review into one gate vs. three separate ones is a UX decision, not just technical.

## 8. Testing strategy

- Per `CLAUDE.md`, all service tests use fresh Mock repos via `new Map()`. New/changed services (`elevenLabsTtsService` timestamp handling, per-scene `klingService` calls, updated `ffmpegService` concat+compose) need unit tests following this pattern.
- Add a fixture-based test for `generateAssSubtitles` driven by sample `voiceTimestamps` data to lock in the subtitle-sync fix independent of live API calls.
- Manual end-to-end test on one real request through the full new pipeline before removing old code paths (Gemini alignment, drawtext animation) entirely.
