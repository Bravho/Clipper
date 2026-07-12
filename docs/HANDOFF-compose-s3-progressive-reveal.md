# Handoff — DO Spaces compose 400 fix + progressive per-ratio reveal

Context: worked in the Video_Processor_RClipper repo. Two things done, one follow-up left for you.

## What changed (already edited in the repo — review the diffs)

1. `src/lib/spaces.ts` — shared `spacesClient` already had
   `requestChecksumCalculation: "WHEN_REQUIRED"` + `responseChecksumValidation: "WHEN_REQUIRED"`.
   The compose/worker upload path (`ffmpegService.uploadToSpaces` → `spacesClient.send(PutObject)`)
   routes through this, so the S3 400 root cause is covered there. No change needed.

2. `scripts/test-spaces.js`, `scripts/retention-sweep.js`, `scripts/backfill-video-thumbnails.js`
   — added the same two checksum options + a comment to each standalone `S3Client`.
   Every `S3Client` in the repo now carries the options (grep-verified).

3. `scripts/run-worker.sh` (launchd entrypoint) — added env fallback:
   `AWS_REQUEST_CHECKSUM_CALCULATION` / `AWS_RESPONSE_CHECKSUM_VALIDATION` default to
   `WHEN_REQUIRED`. Belt-and-suspenders so no future client can re-introduce CRC32 checksums.

4. `src/services/VideoGenerationService.ts` — `_runFFmpegComposition` rewritten for
   PROGRESSIVE reveal:
   - Composes the PRIMARY ratio first; the instant it uploads, writes its
     `finalExport_*_assetId` AND advances the job to `AwaitingFinalApproval`.
   - Each remaining ratio is persisted to its own `finalExport_*` field the moment it
     lands (partial update — merges, never clobbers earlier ratios).
   - Per-ratio try/catch: a later ratio failing is logged and skipped WITHOUT rolling back
     delivered ratios. The step only hard-fails if the primary/first ratio never lands.
   - Added helper `_finalExportFieldForRatio()` mirroring `_captionedFieldForRatio()`.

5. `src/app/api/requests/[id]/pipeline-status/route.ts` — additively returns a `finalExports`
   map of the 4 per-ratio asset IDs (non-breaking) + a TODO for the poller change below.

Installed `@aws-sdk/client-s3` = 3.1004.0 (option names valid).

## Follow-up YOU still need to do (frontend poller — not done)

`src/features/requests/components/PipelineStatusPoller.tsx` early-returns for
`AwaitingFinalApproval` (not in `POLLING_STEPS`), so after the first ratio it stops polling
and later ratios only appear on manual reload. Change it to keep polling while
`currentStep === AwaitingFinalApproval` AND not all required ratios are present, and call
`router.refresh()` as the non-null set grows.
- Required ratios: `ffmpegService.getRequiredRatiosForPlatforms(request.targetPlatforms)`
- Fields to compare (now in the status response under `finalExports`):
  `finalExport_9_16_assetId`, `finalExport_16_9_assetId`, `finalExport_1_1_assetId`,
  `finalExport_4_5_assetId`.
The request-detail page already rebuilds its clip list from those fields on each render, so
once polling continues the reveal is automatic.

## Verification status

- Targeted test `_runFFmpegComposition … creates final export assets` PASSES; output shows
  `[compose:9:16] persisted → job (AwaitingFinalApproval)`.
- Full `npx jest`: 297 passed / 2 failed. Both failures (`clipRequestSchema.test.ts` and the
  montage `'Approve all'` test) are PRE-EXISTING — reproduced identically on a reverted tree,
  so NOT regressions. (`UploadService` suite is the known sandbox-only `sharp` native-module
  issue; fine on the Mac.)
- NOT done: live end-to-end worker run (was in a Linux sandbox, no Mac/ffmpeg/Spaces creds).

## Live check on the Mac Mini

    launchctl kickstart -k gui/$(id -u)/com.rclipper.worker
    tail -f ~/Library/Logs/rclipper/worker.out.log

Expect each ratio to log `[compose:<ratio>] persisted → job`, the first advancing to
`AwaitingFinalApproval`, and no S3 400 on the compose upload.
