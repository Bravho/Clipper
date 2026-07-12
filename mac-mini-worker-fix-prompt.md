# Claude Code prompt — run in the `Video_Processor_RClipper` worker repo on the Mac Mini

Paste everything below the line into Claude Code, from inside
`/Users/admin/Projects/Video_Processor_RClipper`.

---

You are working in the `Video_Processor_RClipper` render-worker repo. There are two
tasks: (1) fix an S3 upload crash, and (2) make ratio composition surface each finished
video to the user progressively instead of all-or-nothing. Investigate before editing —
don't assume file names.

## Task 1 — Fix the DigitalOcean Spaces 400 "UnknownError" on compose upload

**Symptom.** During the `ffmpeg_composition` step, the 9:16 / 16:9 / 4:5 masters compose
and upload fine, then the step fails with:

```
step FAILED ffmpeg_composition
name: "Unknown"  message: "UnknownError"
awsMetadata: { httpStatusCode: 400, attempts: 1 }
stack: AwsRestXmlProtocol.handleError
       @aws-sdk/middleware-flexible-checksums/dist-cjs/index.js
       @aws-sdk/middleware-sdk-s3/dist-cjs/index.js
```

**Root cause.** `@aws-sdk/client-s3` >= 3.729 adds CRC32 integrity checksums by default
(`x-amz-checksum-*` request headers and response checksum validation). DigitalOcean
Spaces rejects these with an opaque 400. The `middleware-flexible-checksums` frame in the
stack is the tell. The sibling web app (`clipper_agent`) already solved this in
`src/lib/spaces.ts` by only sending/validating checksums when the API requires them.

**Do this:**

1. Find every S3 client in this repo:
   `grep -rn "new S3Client\|S3Client(" src` (and anywhere else the worker constructs one).
2. On EACH `S3Client({...})` construction, add these two options (keep existing
   `endpoint`, `region`, `credentials`, `forcePathStyle: true`):

   ```ts
   requestChecksumCalculation: "WHEN_REQUIRED",
   responseChecksumValidation: "WHEN_REQUIRED",
   ```

3. If the worker builds S3 clients in more than one place, factor them through a single
   shared client module (mirror `clipper_agent`'s `src/lib/spaces.ts`) so this can't drift
   again.
4. As a belt-and-suspenders fallback that needs no code change, confirm the worker's
   process environment (launchd plist / `.env` / start script) can also set:
   ```
   AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
   AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
   ```
   Add them to the worker's env file/launch config if that's how this box is configured.
5. Check the installed SDK: `npm ls @aws-sdk/client-s3`. If it's older than 3.729 the
   option names still apply; if it's much newer, verify the option names haven't changed.

Verify the fix by re-running the compose step for one request and confirming all ratios
upload with no 400.

## Task 2 — Progressive per-ratio reveal (don't wait to show the first video)

**Current behavior.** The compose step composes every required ratio in a loop, uploads
each, and only writes the results / advances the job status AFTER the whole loop finishes.
So if a later ratio fails (as in Task 1), the user sees nothing — even the ratios that
already uploaded are effectively discarded.

**Desired behavior.** As soon as the FIRST ratio finishes composing and uploading,
persist it and surface it to the user so they can watch it. Then keep composing the
remaining ratios in the background WITHOUT waiting for any user confirmation — each one
appears to the user as it completes.

**Do this:**

1. Locate the compose loop (the code emitting `[compose] request … start` /
   `[compose:9:16] uploaded → …` logs).
2. Move the "persist this ratio's asset + expose it to the user" work INSIDE the loop, so
   it runs immediately after each ratio uploads — not after the loop. In the `clipper_agent`
   schema this means writing the matching `finalExport_9_16_assetId` /
   `finalExport_16_9_assetId` / `finalExport_1_1_assetId` / `finalExport_4_5_assetId` field
   as each ratio lands, and advancing the job to the review/awaiting-final state once the
   FIRST ratio is available (rather than only at the end). Match whatever status enum and
   job fields this worker actually uses.
3. Make a later ratio's failure NON-fatal to already-completed ratios: wrap each
   iteration so one ratio erroring is recorded but does not roll back or hide the ratios
   that already succeeded. The step should only be marked fully failed if the FIRST/primary
   ratio never lands.
4. Keep it non-blocking: there is no user approval gate between ratios. The user simply
   sees videos appear one by one.
5. Make sure the frontend/status endpoint the web app polls will report ratios as
   "ready" incrementally (per-field), not gated on all being present. If the poll contract
   currently assumes all-or-nothing, note exactly what needs to change on the `clipper_agent`
   side and leave a TODO — but do not break the existing contract silently.

## Deliverable

- Summarize the S3 clients you patched and the compose-loop changes.
- Note any change required on the `clipper_agent` web app / status-poll side so the two
  repos stay in sync (list file + field names; don't guess).
- Run the worker against one real request end to end and paste the compose logs showing
  all ratios uploading and the job advancing after the first ratio.
