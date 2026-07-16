# Claude Code prompt — run in the `Video_Processor_RClipper` worker repo

The overlay/captioned render (Remotion "styled" video) and its watermark-preview sibling
upload to DigitalOcean Spaces via `spacesUpload` / `spacesSendWithRetry` in
`src/lib/spaces.ts` (called from `src/lib/ai/remotionService.ts:223`/`232`). These uploads
fail with the DO Spaces checksum 400 — the SAME root cause as the earlier compose 400, but
a DIFFERENT upload path the previous `requestChecksumCalculation: "WHEN_REQUIRED"` fix on the
shared `spacesClient` does NOT cover. Evidence: compose uploads succeed, but
`spacesSendWithRetry` (spaces.ts:75/79/105) 400s on the ~26 MB styled overlay mp4; it only
succeeded after a worker restart, i.e. it's intermittent/uncovered.

## Investigate

1. Open `src/lib/spaces.ts` and read `spacesUpload` and `spacesSendWithRetry` (~lines 75–105).
   Determine how the object is actually sent:
   - Does it use `@aws-sdk/lib-storage`'s `Upload` (multipart)? That's the likely culprit —
     multipart uploads still attach `x-amz-checksum-*` / `x-amz-sdk-checksum-algorithm`
     trailers that DO Spaces rejects, EVEN when the client is `requestChecksumCalculation:
     "WHEN_REQUIRED"`. This is why a ~26 MB file (multipart) 400s while smaller single-PUT
     compose masters succeed.
   - Or does it build a `PutObjectCommand` on a DIFFERENT client than the fixed `spacesClient`?

## Fix (this upload path)

1. Make sure the client used by `spacesUpload`/`spacesSendWithRetry` is the SAME `spacesClient`
   that carries `requestChecksumCalculation: "WHEN_REQUIRED"` + `responseChecksumValidation:
   "WHEN_REQUIRED"` (not a freshly-constructed client).
2. If it uses lib-storage `Upload`, the client option alone may not stop multipart checksums.
   Either:
   - Force a single-part `PutObjectCommand` for these files (styled overlay + watermark are
     ~26 MB — well within a single PUT), OR
   - Configure the `Upload` so no checksum is sent: don't pass `ChecksumAlgorithm`, and set the
     part size larger than the file so it stays one part.
3. Confirm the env fallback `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` /
   `AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED` is present in the worker's RUNTIME
   environment — in the launchd plist `EnvironmentVariables`, not only an `export` in
   `run-worker.sh` (a launchd-spawned process won't inherit a shell script's exports unless it
   actually runs through that script).
4. The watermark sibling (`_renderWatermarkedSibling` → `applyTiledWatermark` → same upload
   helper) must go through the fixed path too — that's why locked requests had no watermarked
   preview.

## Verify

- Render one overlay end-to-end for a FRESH request. Confirm no 400 on the styled upload, and
  that BOTH a `FinalClip` (captioned) AND a `WatermarkedPreview` asset get created:
  `SELECT asset_type, source_asset_id, created_at FROM uploaded_assets WHERE request_id='…' ORDER BY created_at DESC LIMIT 8;`
- Repeat 2–3 times to confirm it's not intermittent (the multipart-checksum bug is size- and
  timing-dependent, so one success isn't proof).
