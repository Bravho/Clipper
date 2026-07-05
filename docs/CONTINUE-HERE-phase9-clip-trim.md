# Continuation prompt — clipper_agent (paste into a new chat session)

You are continuing multi-phase work on my Next.js app at `D:\coding\clipper_agent`. Read these
FIRST, in order — they are the source of truth: `D:\coding\clipper_agent\CLAUDE.md`,
`D:\coding\clipper_agent\docs\real-media-montage-migration-plan.md`,
`D:\coding\clipper_agent\docs\CONTINUE-HERE.md`, and this file. **No coding until you've read the
code and confirmed the plan with me.** I run `npm test` / `npm run build` LOCALLY — the sandbox
truncates files and lacks the linux `sharp` binary, so trust the Read tool / the Windows `D:\` copy.
Apply migrations via `node scripts/apply-migration.js src/db/migrations/<file>.sql`.

## Project overview
clipper_agent turns a local business's (mostly restaurants) REAL uploaded photos/clips into a short
promo video: a real-media Remotion montage (Ken Burns over stills, clips played as-shot) + Thai AI
voiceover + background music ducked under the voice, then subtitles + a selectable motion-graphic
TEMPLATE composited in a single Remotion pass, exported per selected distribution channel's aspect
ratio, then a distribution-review + auto-publish step. Priorities: FAST, PROFESSIONAL, AUTHENTIC
(always the client's real media — never AI-invented imagery).

Stack: Next.js 14 App Router, TypeScript, Tailwind, NextAuth v4, Zod, react-hook-form, PostgreSQL
(via `pg`) for auth/credits/jobs; some Mock repos for assets/publishing. Single repo swap point:
`src/repositories/index.ts`. Paid online AI services in use: Google Gemini (`gemini-2.5-flash` —
scripts, translation, voice-timeline alignment, subject-focus coords, palette, publishing-copy
drafts) and ElevenLabs (`eleven_v3` Thai TTS). Anthropic Claude and Google Veo are NOT on the live
path (Veo removed/parked; Claude removed after motion-graphics moved to Gemini). Storage:
DigitalOcean Spaces (S3-compatible), optionally CDN-fronted.

## Pipeline steps & status (`VideoGenerationStep`)
1. AnalyzingContent → AwaitingContentApproval — Gemini writes the Thai speaking script. ✅ DONE
2. GeneratingVoice → AwaitingVoiceApproval — ElevenLabs Thai TTS + ffprobe duration + Gemini
   per-sentence timeline; requester also picks distribution CHANNELS here (first = primary = base
   ratio; Travy/Tvent is mandatory + locked). ✅ DONE
3. GeneratingSceneDesign → AwaitingSceneDesignApproval — montage scene plan sized to the real voice
   length; Ken Burns subject-focus via Gemini. ✅ DONE
   (AwaitingSceneScriptApproval — legacy per-scene gate, now DEAD/bypassed by the batch flow.)
4. GeneratingBaseVideo → AwaitingVideoApproval — render ALL montage scenes → review all → per-scene
   "แก้ไขฉากนี้" revise → "Approve all" concatenates into the base video. ✅ DONE (batch flow)
5. GeneratingAnimations → AwaitingAnimationApproval — now ONLY the background-MUSIC picker ("3.5"). ✅ DONE
6. ComposingFinalVideo → AwaitingFinalApproval — FFmpeg merges voice + ducked music (0.6s music
   lead-in) into per-ratio MASTERS (no captions). Review shows the primary-ratio merged video;
   requester picks SUBTITLE LANGUAGES (th/en/zh) + a MOTION TEMPLATE here. ✅ DONE
7. GeneratingOverlay → AwaitingOverlayApproval — single-pass Remotion "TemplatedVideo": master plays
   inside the comp (audio intact) + chosen template frame/decor + subtitles → opaque MP4. Templates:
   none, clean_frame, framed_cream, editorial. Review has approve / regenerate / "← edit
   template+language" / DOWNLOAD button. ✅ DONE
8. AwaitingAdditionalRatios → GeneratingAdditionalRatios — explicit button to render the remaining
   selected channels' ratios (shown only when >1 user ratio). ✅ DONE
9. Travy (compulsory channel) auto EN+ZH render — background, `tventVideoStatus`
   (idle|generating|ready|failed). REUSE: if the requester's subtitle languages are exactly {en,zh},
   the primary captioned export is reused as the Travy export (no duplicate render). ✅ DONE
10. AwaitingDistributionReview — NEW (just built). After overlay approval (and any additional ratios),
    the job lands here and the request is set to `ScheduledForPublishing` (stays "in progress", NOT
    Delivered). Shows an AUTO-FILLED (Gemini) per-channel publishing form (title/caption/hashtags,
    tailored per channel — YouTube gets a title, TikTok/IG/FB get caption+hashtags; Travy/CDN
    excluded). Travy render runs fire-and-forget here (leaving the page never stops it). On "confirm
    publish" it posts each not-yet-posted channel via the social services using that channel's
    ratio-matching captioned export (NO fallback — a missing ratio surfaces an error). ALL channels
    must succeed → Publishing → Complete + Delivered; any failure keeps the job on this step with
    per-channel error causes, and resubmit retries only the failed channels (posted ones are skipped
    — no double-post). ✅ DONE
11. Publishing → Complete/Delivered — reached only via confirmed publishing. ✅ DONE

Deferred/parked (left in tree for revert): old alpha-overlay path (renderOverlay, overlayOnMaster,
OverlayComposition, DecorativeGraphics, CaptionOverlay, SceneLowerThird, animationService), veoService.

## What was completed in the previous session (Phase 7/8 polish)
- Fixed the phantom "กำลังประมวลผล..." spinner in `VideoApprovalPanel` (now gated on a positive
  `isProcessing` prop computed in the page from the real generating steps).
- Added a DOWNLOAD button at the subtitle/overlay review step.
- Built the whole AwaitingDistributionReview step: enum already existed; added
  `_generatePublishingDrafts`, `confirmPublishingByRequester`, `savePublishingDraftsByRequester`,
  `_postToChannel`; changed `_finalizeAndStartTvent` to land on the review step (sets
  `ScheduledForPublishing`, not Delivered) + Travy reuse; new routes `confirm-publishing` and
  `publishing-drafts`; new `DistributionReviewPanel`; `src/config/publishFields.ts`.
- Updated/added tests in `tests/services/VideoGenerationService.test.ts` (overlay→distribution-review,
  Travy reuse, publish success, missing-ratio error, partial-failure resubmit no-double-post).
- Data fix: `scripts/reset-predistribution-deliveries.js` reopens legacy requests that were
  Delivered before Phase 8 existed (`current_step='complete' AND publishing_drafts IS NULL`) back to
  `awaiting_final_approval` / `editing` so they flow through the new step. (Mirrors the existing
  `reset-presubtitle-deliveries.js`.)
- Migration `009_publishing_drafts.sql` (JSONB `publishing_drafts`) already exists + is mapped in the
  postgres repo — no new migration was needed.

## NEXT TASK — visual, playable clip-trim bar in the scene-review step
Goal: in the SCENE-review UI, let the requester adjust each uploaded CLIP on a PLAYABLE / ADJUSTABLE
BAR — dragging the start and end handles to set the clip's in/out points (and thereby how long that
clip plays in the scene), with live preview, instead of the current plain numeric "เริ่ม/จบ" inputs.

Current state (verified):
- `MontageSceneAsset` (in `src/domain/models/VideoGenerationJob.ts`) already carries
  `trimStartSeconds?`, `trimEndSeconds?`, `durationSeconds`, `motion`, `focusX/Y`. So the DATA MODEL
  already supports trim — this task is primarily a UI upgrade plus wiring the trimmed duration.
- `src/features/requests/components/MontageSceneAssetsEditor.tsx` is the shared editor. It currently
  auto-distributes each asset's `durationSeconds` evenly from the scene-level `sceneDurationSeconds`
  and exposes clip trim as two `<input type="number">` (start/end). There is NO scrubber and NO
  per-clip length control tied to the trim.
- The editor is used in TWO places: `SceneDesignApprovalPanel.tsx` (step 3,
  AwaitingSceneDesignApproval) and `VideoApprovalPanel.tsx` revise mode (step 4 per-scene
  "แก้ไขฉากนี้" → `requestVideoRevisionByRequester`).
- The renderer honors trim: `toRenderAssetSpecs` / `buildSceneMontageAssets` in
  `src/lib/ai/montagePlan.ts`, and `remotion/MontageScene.tsx` / `remotion/montageMotion.ts`. Confirm
  exactly how `trimStartSeconds`/`trimEndSeconds`/`durationSeconds` are consumed so the new bar writes
  values the renderer already understands.

Design questions to confirm WITH ME before coding:
1. Scope: build the trim bar for CLIPS only (stills have no timeline), or also let stills set their
   on-screen duration on a similar bar?
2. Should the clip's on-screen play duration equal (trimEnd − trimStart), overriding the current
   even-split auto-distribution for that clip — and how should the scene-level total then reconcile
   (auto-grow the scene, or keep scene length fixed and rebalance the other assets)?
3. Preview mechanics: read the real clip length client-side from a hidden `<video>` metadata
   (`durationSeconds`) and render a two-handle draggable range over a scrubbable timeline with a
   play/scrub head that loops the selected in/out range — acceptable, or do you want thumbnail
   filmstrip frames along the bar too (heavier)?
4. Which step gets it first — both the scene-design approval AND the per-scene revise (they share the
   editor, so one change covers both), correct?

Likely files to touch: `MontageSceneAssetsEditor.tsx` (replace numeric trim with the bar), possibly a
new `ClipTrimBar.tsx` component, `montagePlan.ts` (duration reconciliation), and the two panels only
if prop plumbing changes. Keep `npm test` green; I build/test locally.

## CRITICAL gotchas (unchanged, still apply)
- Run `npm test` / `npm run build` LOCALLY; trust the Read tool / Windows `D:\` copy over the sandbox.
- `.next` corruption recurs — `rmdir /s /q .next` then rebuild if the dev server 404s on chunks.
- Client components must not import `getOrderedSourceAssets` (pulls in the pg repo) — only
  `import type { OrderedSourceAsset }`; ordering happens server-side in `page.tsx`.
- Voice: `ELEVENLABS_TTS_MODEL` defaults to `eleven_v3` (only model with Thai). If voice is "silent",
  check the browser/tab isn't muted before touching code.
- Old jobs may carry inconsistent scene/segment data — test with a FRESH request.

## Key files (scene/montage area)
- Editor UI: `src/features/requests/components/MontageSceneAssetsEditor.tsx`,
  `SceneDesignApprovalPanel.tsx`, `VideoApprovalPanel.tsx` (revise mode).
- Montage plan helpers: `src/lib/ai/montagePlan.ts` (`buildSceneMontageAssets`, `toRenderAssetSpecs`,
  `allocateAssetDurations`, `inferMotionFromText`).
- Renderer: `remotion/MontageScene.tsx`, `remotion/montageMotion.ts`, `src/config/montage.ts`.
- Pipeline service: `src/services/VideoGenerationService.ts` (`requestVideoRevisionByRequester`,
  `_renderSceneInto`, `_reinferSceneMotion`, `approveSceneDesignByRequester`).
- Page: `src/app/(auth)/dashboard/requests/[id]/page.tsx`.
- Model: `src/domain/models/VideoGenerationJob.ts` (`MontageSceneAsset`, `ScenePlan`).

Start by reading the files above, then confirm the plan (esp. the 4 design questions) with me before
coding. Use the task list, add a final verification step, and keep tests green between changes.
