# Continuation prompt — clipper_agent (paste into a new chat)

---

You are continuing a multi-phase re-architecture of my Next.js app at `D:\coding\clipper_agent`.
Read these first, in order — they are the source of truth: `D:\coding\clipper_agent\CLAUDE.md`,
`D:\coding\clipper_agent\docs\real-media-montage-migration-plan.md`, and this file. Also load the
project memory (`phase3-montage-swap`, `phase4-veo-removal-quality`, `phase5-batch-scene-review`,
`per-scene-video-pipeline`).

## Project in one line
"clipper_agent" turns a restaurant client's uploaded photos/clips into a short promo video
(Thai/EN/ZH script + AI voiceover + burned-in subtitles + background music, exported in up to 4
aspect ratios, auto-published to TikTok/Facebook/Instagram/YouTube/Travy). The product priorities
are FAST, PROFESSIONAL, and above all AUTHENTIC — the video must show the client's ACTUAL food /
venue / signage, never AI-invented imagery.

## Stack & architecture
Next.js 14 App Router, TypeScript, Tailwind, NextAuth v4, Zod, react-hook-form, PostgreSQL (`pg`).
Layered: `domain/` (types) → `repositories/` (mock + postgres; **single registry/swap point
`src/repositories/index.ts`**) → `services/` → `app/` (routes + pages) → `features/` (UI). The video
pipeline lives in `src/services/VideoGenerationService.ts` and persists jobs in Postgres
(`PostgresVideoGenerationJobRepository`). Media is stored in DigitalOcean Spaces (S3-compatible),
optionally fronted by a CDN (`DO_SPACES_CDN_ENDPOINT`).

## The migration (DONE): Veo → real-media Remotion montage
We REMOVED the Google Veo 3.1 generative-video core (it fabricated the dish/venue and produced
disjointed, non-continuous scenes) and replaced it with a real-media **Remotion montage** engine
that animates the client's actual photos/clips (Ken Burns zoom/pan over stills, real clips played
as-shot), concatenated by FFmpeg. Voice + music are mixed ONCE at the final compose step over the
whole concatenated video. There is ONE voiceover for the whole video; scene timings/scripts derive
from it. Veo is fully removed from the live path but `veoService.ts` is PARKED (unreferenced) for an
easy revert.

## Pipeline flow (current, BATCH model)
1. AnalyzingContent → AwaitingContentApproval: Gemini Vision writes the Thai script + a rough
   storyboard (Stage-1).
2. GeneratingVoice → AwaitingVoiceApproval: ElevenLabs voice (eleven_v3, Thai), ffprobe duration,
   Gemini alignment. **At voice approval the requester picks distribution channels** (multi-select;
   the FIRST clicked = PRIMARY → sets the base video's aspect ratio; "Travy App"/Tvent is mandatory,
   locked, light-grey, and adopts the primary's ratio). Persisted to `clipRequest.targetPlatforms`
   (primary first).
3. GeneratingSceneDesign → AwaitingSceneDesignApproval: Vision scene plan (all scenes on one page,
   editable). No-media guard: if zero usable uploads, fails with `NoUsableMediaError`. Motion is
   inferred from each scene's description (`inferMotionFromText`: "zoom out/ถอยห่าง", "zoom in/ซูมเข้า",
   "pan") and subject-focus is baked from Gemini `detectProductCoordinates`.
4. Approving the scene design → GeneratingBaseVideo: **renders EVERY scene** up front
   (`_renderAllSceneSegments`) → AwaitingVideoApproval.
5. AwaitingVideoApproval (combined review): ALL scene videos shown together; the requester reviews
   each, edits any one individually ("แก้ไขฉากนี้" → re-renders ONLY that scene, re-infers its motion
   from the edited script), then clicks "อนุมัติทุกฉาก" (Approve all) → concatenates all segments into
   the single `baseVideoAssetId`.
6. GeneratingAnimations → AwaitingAnimationApproval: Claude motion specs + Remotion transparent
   caption overlay per ratio (subtitle-language picker here).
7. ComposingFinalVideo → AwaitingFinalApproval: FFmpeg crop/scale + overlay + music (sidechain
   ducked) + per-ratio exports; Travy export uses the PRIMARY ratio (no longer forced 9:16).
8. Publishing → Complete.

## Phases — status
- **Phase 0 — upload caps**: DONE (≤45s/clip, ≤500MB total).
- **Phase 1 — montage engine in isolation**: DONE (`remotion/MontageScene.tsx`, `montageMotion.ts`,
  `montageService.renderScene`, `src/config/montage.ts`, shared `remotionBundle`).
- **Phase 2 — data model + Stage-1 storyboard UI**: DONE (migration `006_real_media_montage.sql`,
  canonical ordering `src/lib/sourceAssets.ts`).
- **Phase 3 — core swap (montage is the default engine)**: DONE.
- **Phase 4 — Veo removal + image-motion quality**: DONE. Veo fully removed (parked); no-media guard
  (`NoUsableMediaError`); subject-aware focus; frame-accurate durations; motion variety +
  script-inferred motion (`inferMotionFromText`); very-short-fade transitions (within-scene
  cross-dissolve + xfade scene joins with hard-cut fallback); `fileSizeBytes:0` fix; channel→ratio at
  voice approval; Travy export at primary ratio; removed the redundant animation-step channel
  selector; fixed the transparent-overlay render crash (`imageFormat:"png"`).
- **Phase 5 — batch scene review + Approve-all merge**: DONE. Replaced the sequential per-scene gate
  with render-all → review-all → edit-per-scene → one Approve-all merge. Same-origin stream route
  `/api/requests/[id]/stream?assetId=` exists as a fallback, but media now use DIRECT CDN URLs for
  speed (the "silent voice" turned out to be a muted browser, not a CDN/Range issue). Poller interval
  dropped 30s→5s.
## NEXT PHASES — the remaining pipeline polish (Phase 6 → 8, in order)

These complete steps 6–7 of the pipeline (compose) and step 7→8 (multi-ratio export). IMPORTANT:
much of this is ALREADY wired in `ffmpegService.composeAndExport` / `composeSingleRatio` /
`_runAnimationGeneration` — these phases are mostly VERIFY/REFINE/COMPLETE, not build-from-scratch.
Read the existing code first so you don't re-implement working pieces.

- **Phase 6 — Background music + voice-aware ducking (partially built).**
  Goal: mix the requester's SELECTED background track under the voiceover and AUTOMATICALLY duck
  (lower) the music whenever the speaking voice is loud, so narration is always clear.
  Already built: `composeSingleRatio` mixes music with `loudnorm` → `asplit` → `sidechaincompress`
  (music keyed off the voice) → `amix` → `alimiter`; the track is chosen via `selectedMusicTrack` at
  animation approval; files live in `public/music/{id}.mp3`; a "no music" option exists.
  REMAINING: (a) the compose hardcodes `-t 15` / `-shortest` and the music `atrim=0:15` — make these
  DYNAMIC to the real voice/video duration (probe it) so longer/shorter clips aren't clipped and the
  music covers the whole video; (b) tune the duck threshold/ratio/attack/release so music drops
  clearly under speech and recovers in the gaps; (c) confirm the per-track volume + the selection UX.

- **Phase 7 — Remotion/"hyper-frame" animation + multilingual subtitles (partially built).**
  Goal: add kinetic motion-graphics + burned-in subtitles in the requester's SELECTED subtitle
  languages (any combo of th/en/zh), timed to the voice.
  Already built: `_runAnimationGeneration` → `remotionService.renderOverlay` renders one transparent
  (alpha, `imageFormat:"png"`) Remotion caption/motion-graphics overlay PER ratio from
  `subtitleTimeline` + `subtitleLanguages` (chosen at animation approval), composited onto the base at
  compose; Claude produces the `animationSpec`; Gemini `alignAudioWithScript` provides per-sentence
  timing and EN/ZH translations.
  REMAINING: (a) improve the kinetic/"hyper-frame" caption + motion-graphics quality in the Remotion
  overlay composition; (b) fix the non-fatal `[animationService] Claude API 400` (it currently falls
  back to default specs); (c) verify EN/ZH translation accuracy + subtitle timing and legibility
  across ratios; (d) ensure only the selected languages render (NOTE: the Travy export always carries
  EN+ZH regardless of the requester's choice — that's a platform rule).

- **Phase 8 — Multi-ratio export, REUSING generated parts (the "change aspect ratio" step; the FINAL
  pipeline phase).**
  Goal: from the parts already produced, output a final video for EACH selected distribution
  channel's aspect ratio. This MUST reuse the already-generated parts — the concatenated base video,
  the voiceover, the music mix, and the per-ratio overlays — and only re-crop/re-compose per ratio.
  It must NOT regenerate the montage or re-run earlier steps.
  Already built: the base is rendered once at the PRIMARY channel's ratio (`targetPlatforms[0]`);
  `composeAndExport` loops `getRequiredRatiosForPlatforms(targetPlatforms)` and crops/scales the base
  to each ratio (subject-aware crop via Gemini `detectProductCoordinates`) + composites that ratio's
  overlay + muxes voice+music; the Travy export uses the primary ratio.
  REMAINING: (a) confirm exports are generated ONLY for the channels the requester actually selected
  (not always all four); (b) verify the subject-aware crop keeps the hero (dish/sign) in frame at
  every ratio; (c) double-check nothing already generated is re-rendered (pure crop/recompose, reuse
  base + overlays + audio).

- **Phase 9 (OPTIONAL / later) — quality.** Per-ratio Remotion RENDER (re-render the montage natively
  at each ratio for perfect framing instead of cropping one base) and beat-synced cuts (align
  scene/asset cuts to the music beat). Heavier; only pursue if cropped framing proves insufficient.

## Other open items (not phase-blocking)
1. Review-page polish: poster thumbnails on each scene `<video>`; lighter-bitrate review encodes for
   faster loading; an optional per-scene "generating…" indicator during a single-scene re-render.
2. Dead-code cleanup: the `AwaitingSceneScriptApproval` step + `approveSceneScriptByRequester` + the
   `scene-script/approve` route + the page's `isAwaitingSceneScriptApproval` branch are now unreached
   by the batch flow — safe to remove.
3. Consider deleting parked `veoService.ts` + its `aiTools.ts` config + `VEO_*` env if Veo is never
   coming back.

## CRITICAL gotchas (read before running)
- **Run `npm test` and `npm run build` LOCALLY.** The sandbox bash mount truncates/corrupts files
  mid-session, so tsc/jest there emit phantom errors and lack the linux `sharp` binary. Trust the
  Read tool; the Windows `D:\` copy is authoritative.
- **`.next` corruption is recurring.** Symptoms: 404 on `_next/static` chunks, or build error
  `Cannot find module './1682.js'`. Fix: stop dev, `rmdir /s /q .next`, then `npm run dev` /
  `npm run build`. Clear `.next` whenever the dev server crashes or you switch between `build` and
  `dev`.
- DB: migrations live in `src/db/migrations/`; apply with
  `node scripts/apply-migration.js src/db/migrations/<file>.sql`. **No new migration is needed** for
  Phase 4/5 (they reuse existing `currentSceneIndex` / `sceneVideoAssetIds`; the `video_engine` column
  stays but is unused).
- Client components must NOT import `getOrderedSourceAssets` from `@/lib/sourceAssets` (pulls in the
  pg repo) — only `import type { OrderedSourceAsset }`; ordering happens server-side in `page.tsx`.
- `jest.config.js` excludes 3 integration suites needing live Postgres — don't delete them.
- Voice engine: `ELEVENLABS_TTS_MODEL` defaults to `eleven_v3` (only model with Thai). If voice is
  ever silent, FIRST check the browser/tab isn't muted before touching code.
- When testing the pipeline, **use a FRESH request** — old jobs were mutated across many code
  versions and may have inconsistent scene-plan/segment data.

## Key files
- Pipeline service: `src/services/VideoGenerationService.ts` (`_renderSceneInto`,
  `_renderAllSceneSegments`, `approveBaseVideoByRequester` = Approve-all, `requestVideoRevisionByRequester`
  (per-scene, re-infers motion), `_reinferSceneMotion`, `_setDistributionChannels`, `_concatMontageBaseVideo`).
- Montage plan helpers: `src/lib/ai/montagePlan.ts` (`buildSceneMontageAssets`, `pickMotionForIndex`,
  `inferMotionFromText`, `allocateAssetDurations`, `toRenderAssetSpecs`).
- Renderer: `remotion/MontageScene.tsx`, `remotion/montageMotion.ts`, `src/config/montage.ts`.
- FFmpeg: `src/lib/ai/ffmpegService.ts` (`concatVideos`, `concatVideosWithCrossfade`, `composeAndExport`).
- Overlay render: `src/lib/ai/remotionService.ts` (`renderOverlay`, needs `imageFormat:"png"`).
- UI: `src/features/requests/components/VideoApprovalPanel.tsx` (voice approval + channel picker +
  combined scene review + per-scene revise + Approve-all), `SceneDesignApprovalPanel.tsx`,
  `SceneScriptApprovalPanel.tsx` (dead), `PipelineStatusPoller.tsx`.
- Page: `src/app/(auth)/dashboard/requests/[id]/page.tsx` (builds `sceneVideos`).
- Stream route: `src/app/api/requests/[id]/stream/route.ts`.

Start by confirming the plan for the next task with me before coding. Use the task list, keep tests
green between changes, and have me run `npm test` / `npm run build` locally.
