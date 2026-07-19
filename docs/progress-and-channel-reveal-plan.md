# Plan: Per-step % Progress + Progressive Per-Channel Video Reveal

Decisions confirmed:
- % bars only where progress is truly measurable (render/FFmpeg steps). AI-API steps
  (AnalyzingContent, GeneratingSceneDesign, GeneratingVoice) keep the current spinner — no %.
- ช่องทางอื่น reveal = per-channel grid: finished videos playable immediately,
  pending channels show spinner + %, panel stays until all done.

---

## Part 1 — % progress for generating steps

### 1.1 Where real progress signals exist

| Step | Compute | Signal |
|---|---|---|
| GeneratingBaseVideo (per-scene segment) | Remotion `renderMedia` (`montageService.renderScene`) | `onProgress` callback (0–1) — currently unused |
| GeneratingBaseVideo (merge, `RenderStep.MontageMerge`) | FFmpeg concat | `-progress pipe:1` → `out_time` vs known total duration (`voiceDurationSeconds` / ffprobe) |
| GeneratingAnimations / GeneratingOverlay | Remotion (`remotionService`, 2 `renderMedia` call sites) + FFmpeg composite | Remotion `onProgress` weighted ~70%, FFmpeg composite ~30% |
| ComposingFinalVideo | FFmpeg (`_runFFmpegComposition`) | FFmpeg `out_time` per ratio + ratio count (units) |
| GeneratingAdditionalRatios | Loop over remaining ratios + inline Travy | Unit-based: `(ratiosDone + currentRatioProgress) / totalUnits`; per-ratio fine progress from Remotion/FFmpeg |

### 1.2 Persistence (migration `src/db/migrations/016_render_progress.sql`)

```sql
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_progress        REAL;    -- 0..100, NULL = unknown
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS render_progress_detail JSONB;   -- e.g. {"unit":"16:9","unitsDone":1,"unitsTotal":3}
```

- Additive, safe to re-run (matches existing migration style).
- `VideoGenerationJob` model: `renderProgress?: number | null`, `renderProgressDetail?: { unit?: string; unitsDone?: number; unitsTotal?: number } | null`.
- Postgres repo: add to row mapper + camel→snake column map. Mock repo: plain fields.
- Reset to `NULL` at every step transition into a generating step — do this centrally in
  `_dispatchHeavy` (both enqueue and inline-fallback paths) so worker and inline behave identically.

### 1.3 Progress writer (service-side helper)

Add a small private helper on `VideoGenerationService`:

```ts
private _progressWriter(jobId: string) {
  let last = 0; let lastAt = 0;
  return (pct: number, detail?: ProgressDetail) => {
    const now = Date.now();
    if (pct < 100 && pct - last < 3 && now - lastAt < 3000) return; // throttle: ≥3 pts or ≥3s
    last = pct; lastAt = now;
    videoGenerationJobRepository
      .update(jobId, { renderProgress: pct, renderProgressDetail: detail ?? null })
      .catch(() => {}); // fire-and-forget: progress must never fail a render
  };
}
```

- Works identically on the web droplet and the Mac render worker — both write to the shared
  Postgres, and the poller reads from the web droplet. No new worker protocol.
- **Deploy coupling:** service signature changes ship to droplet + worker together (known gotcha).

Wire it in:
1. `montageService.renderScene` / `renderMerge`: accept optional `onProgress?: (fraction: number) => void`,
   pass to `renderMedia({ onProgress: ({ progress }) => onProgress?.(progress) })`.
2. `remotionService` (both `renderMedia` call sites): same optional callback.
3. `ffmpegService`: add one `runFfmpegWithProgress(args, totalDurationSeconds, onProgress)` that uses
   `spawn` with `-progress pipe:1 -nostats`, parses `out_time_us`, and computes `out_time / total`.
   Convert only the long-running calls (merge, ratio composite/export) — keep `execFileAsync` for
   short probes/trims. Preserve the existing `summarise exec error` signal/code logging in the
   spawn wrapper (empty-stderr SIGKILL diagnosis must not regress).
4. Multi-unit steps compute overall % before calling the writer:
   - `_renderAllSceneSegments`: `((sceneIdx + sceneFraction) / sceneCount) * 100`
   - `_runFFmpegComposition`: same over required ratios
   - `_runAdditionalRatiosOverlay`: units = remaining ratios (+1 if Travy renders inline);
     detail = `{ unit: ratio, unitsDone, unitsTotal }`

### 1.4 API + polling

- `pipeline-status` route: return `renderProgress` and `renderProgressDetail` (additive fields).
- `PipelineStatusPoller`: extend the existing client-state callback pattern (same as
  `onVideoGenStatus` — intra-step changes must NOT rely on RSC refresh) with
  `onProgress?: (pct: number | null, detail) => void`, fired on every poll while
  `POLLING_STEPS.includes(currentStep)`.
- `PipelineSection`: hold `renderProgress` state, pass to `ProductionPipeline` and (new) to the
  additional-ratios grid via context/props.

### 1.5 UI (`ProductionPipeline`)

Under the active phase (only when `isActive && renderProgress != null`):

```
[thin bar: bg-slate-100, fill bg-blue-600, width = pct%]  42% · ช่อง 16:9 (2/3)
```

- Never render a bar for AI-API steps — they don't write progress, `renderProgress` stays `NULL`,
  spinner remains (decision: "don't show").
- Bar never moves backwards within a step (clamp with `Math.max(prev, next)` client-side; reset when
  `currentStep` changes).
- Keep the existing `videoGenStatus` sub-status line; the bar sits below it.

---

## Part 2 — Progressive per-channel reveal (ช่องทางอื่น)

Backend already persists each `captionedExport_<ratio>_assetId` the moment that ratio finishes
(`_runAdditionalRatiosOverlay` writes per-iteration, resumable/idempotent). Only exposure + UI are missing.

### 2.1 API

`pipeline-status` route — add (additive, mirrors `finalExports`):

```ts
captionedExports: {
  "9:16": job.captionedExport_9_16_assetId ?? null,
  "16:9": ..., "1:1": ..., "4:5": ...,
},
```

URLs come from the RSC refresh (page already builds `channelVideos` with storage URLs at
lines ~200–231) — the route only needs ids for change detection.

### 2.2 Poller

In `PipelineStatusPoller`, mirror the existing `revealRatios` pattern:

- New props: `revealCaptioned?: boolean`, `requiredCaptionedCount?: number`,
  `initialReadyCaptionedCount?: number`.
- While `currentStep === GeneratingAdditionalRatios`: count non-null `captionedExports`;
  when the count grows past the ref baseline → `router.refresh()`. (Step change to
  AwaitingDistributionReview already triggers the final refresh.)
- `PipelineSection` computes `revealCaptioned` exactly like `revealRatios`
  (`GeneratingAdditionalRatios` is already in `POLLING_STEPS`, so polling continues regardless —
  this only adds the refresh trigger).

### 2.3 Page (`dashboard/requests/[id]/page.tsx`)

- Compute `requiredCaptionedCount` = `_userRatios(targetPlatforms)` count (all user ratios incl.
  primary; primary is already captioned before this step) and `readyCaptionedCount` from the four
  `captionedExport_*` fields; pass through `PipelineSection`.
- Pass `channelVideos` (already built) + `targetPlatforms`-derived channel labels into
  `VideoApprovalPanel` for the new grid.

### 2.4 UI — per-channel grid in `VideoApprovalPanel`

Shown while `currentStep === GeneratingAdditionalRatios` (replaces the current bare processing
spinner for this step), reusing the visual language of the existing Travy card:

- One card per **ratio** (channels sharing a ratio grouped, labels via `PLATFORM_LABELS` +
  `PLATFORM_ASPECT_RATIOS` — existing convention).
- Ready (`captionedExport` id present + URL in `channelVideos`): `<video controls>` + download link
  — playable immediately while the other ratios keep rendering.
- Pending: spinner card "กำลังสร้างวิดีโอสำหรับช่องนี้..." + % when
  `renderProgressDetail.unit === thisRatio` (from Part 1).
- Travy card: unchanged (already progressive via `tventVideoStatus`).
- Generality: the same grid renders at `AwaitingDistributionReview` fully-ready, so any channel
  count/order works; the compose-step master reveal at `AwaitingFinalApproval` (already shipped)
  is untouched.

---

## Part 3 — Tests & verification

1. Unit tests (`tests/services/`, fresh mock repos per existing pattern):
   - progress writer throttling + never-throws
   - `_runAdditionalRatiosOverlay` unit-% math (ratios done/total, Travy inline unit)
   - step-transition resets `renderProgress` to NULL
2. `pipeline-status` route: `captionedExports` + `renderProgress` fields present (additive contract).
3. `npm run lint` + `npm test`.
4. Manual: 3-channel request (e.g. TikTok 9:16 primary + YouTube 16:9 + IG 4:5) — confirm each
   ratio's card flips to playable while the next renders, bar advances, no regression on the
   single-channel (no-additional-ratios) path.

## Sequencing

1. Migration 016 + model + repos (mock, postgres)
2. ffmpeg/remotion/montage `onProgress` plumbing + service writer
3. pipeline-status route additions
4. Poller + PipelineSection wiring
5. ProductionPipeline bar
6. VideoApprovalPanel per-channel grid
7. Tests; deploy droplet + worker together

Rollback safety: every change is additive (NULL columns, extra JSON fields, optional callbacks);
old worker + new web (or vice-versa) degrade to today's behaviour (no %, reveal on step change).
