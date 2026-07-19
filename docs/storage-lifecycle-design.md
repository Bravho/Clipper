# RClipper — Storage Management & Data-Lifecycle Design

> Status: design proposal (no code yet). Author: planning session, 2026-07-05.
> Scope: how RClipper stores, retains, and deletes media across DigitalOcean
> Spaces and the Mac Mini render worker — optimised for cost, productivity
> (retries/revisions without re-upload), user experience, and data minimisation.

---

## 1. Guiding principles

1. **Spaces is the store of record; the Mac Mini is compute scratch only.**
   Raw uploads and deliverables live in object storage. The worker holds files
   only transiently in local `/tmp` during a render and wipes them in a
   `finally` block. No user data is ever left at rest on the Mac.
2. **Keep only what has downstream value.** Everything transient or cheaply
   reproducible is deleted as early as it is safe to do so. Only the *source*
   (until delivery) and the *deliverable* (long term) justify real retention.
3. **Delete on purpose, sweep as backstop.** Primary deletion is an explicit
   application call fired on a workflow state change ("immediate"). S3 lifecycle
   rules and a nightly orphan sweep exist only to catch abandoned/failed jobs.
4. **Privacy by default.** Raw uploads are treated as short-lived. What survives
   long term (the finished clip, small thumbnails) is documented and intentional.

---

## 2. Current state (from `src/lib/spacesKeys.ts`) and its problems

| Prefix | Content | Current lifecycle | Live callers? |
|---|---|---|---|
| `tmp/` | In-transit upload chunks | 7 days | yes (`buildTmpKey`) |
| `processing/` | Reserved / unused | 7 days | no |
| `request_mat/` | Confirmed **raw uploads** (images & video) | 90 days | yes (`buildRequestMatKey`) |
| `thumbnails/` | Previews of uploads and final clips | 5 years | yes (`buildThumbnailKey`) |
| `clips/` | Legacy final-clip prefix | 8 years (`expire-clips-8y`) | **0 — dead** (real deliverable is `final_exports/`) |
| `ai_videos/` | Base video output (still written **post-Veo**) | 90 days (`expire-ai-videos-90d`) | yes — live intermediate (`buildAiVideoKey`) |
| `voice_recordings/` | Staff voice | **none** | **0 — dead** |
| `processed_audio/` | Legacy audio | **none** | **0 — dead** |
| `animated_videos/` | Base + overlays pre-final | **none** | **0 — dead** |
| `animated_overlays/` | Remotion transparent overlays per ratio | **none** | **0 — dead** |
| `final_exports/` | Final per-ratio MP4s (**the real deliverable**) | **none — never expires!** | yes (`buildFinalClipKey`) |

> Read from the lifecycle/policy commands you supplied (not a live account query).
> The delivered clips under `final_exports/` currently have **no expiration rule**,
> so they accumulate forever — this is the most important gap to close.

Problems this creates:

- **8-year retention on nearly everything**, including large, reproducible
  intermediates. This is the single biggest cost driver — you are paying
  GB-months for years on files that stop being useful the moment the final clip
  is approved.
- **Dead storage classes still carry 8-year rules.** Four prefixes have no live
  writers but their objects (if any exist from earlier builds) sit for 8 years.
- **`ai_videos/` lingers post-Veo.** Two references remain after Veo was
  disconnected; they should be audited and removed.
- **Raw uploads kept 90 days** with no explicit early delete — at odds with the
  "delete the user's uploads promptly" requirement.
- **No documented delivery/egress strategy** (CDN vs direct), which drives
  bandwidth cost when clips are served and published repeatedly.

---

## 3. The tier model

Every object maps to one of five tiers. The tier decides *when* it dies.

### Tier 0 — Transient (life: minutes–hours)
`tmp/`, `processing/`, and the worker's local `/tmp` scratch.
Deleted immediately after the step that consumes them. Lifecycle backstop: **1 day**.

### Tier 1 — Source (life: until delivery + grace)
`request_mat/` raw uploads.
These are needed for the whole production run *and* for any revision/retry
(`retryPipeline`, `regenerateAnimationByRequester`, revise-video/-audio). Deleting
them too early breaks the ability to re-render. Deleted on **Delivered/Published
+ 7-day grace**. Lifecycle backstop: **30 days** (catches abandoned requests).

### Tier 2 — Intermediate (life: until final approval)
`ai_videos/` (legacy), `animated_videos/`, `animated_overlays/`, `processed_audio/`,
the merged base video, and per-ratio overlay renders.
All are reproducible from Tier 1 + the pipeline, or are superseded by the final
export. Deleted the moment the request reaches **AwaitingFinalApproval → approved**.
Lifecycle backstop: **14 days**. This is the **biggest cost win** — it stops years
of hoarding large mid-pipeline video.

### Tier 3 — Deliverable (life: long, business-defined)
`final_exports/` (and legacy `clips/`).
The paid output. Kept long term, served via CDN. Recommend dropping the blanket
8-year rule to a **business/legal-justified window** (see §7). Note: the final
clip is *composed of* the user's uploaded images, so deleting Tier 1 does **not**
remove that imagery from your systems — it persists inside the retained clip.
This should be reflected in your privacy wording.

### Tier 4 — Thumbnails (life: long, negligible cost)
`thumbnails/` — both upload previews and final-clip previews.
Per your decision, **upload thumbnails are kept for request-history UX**. At
~20 KB each these are effectively free; keep them at **5 years** (or align to
Tier 3). Caveat to note internally: an upload thumbnail is a downsized copy of
the user's photo, so "we delete your uploads" means the full-resolution source,
not this preview.

---

## 4. Deletion mechanism — three layers

1. **Primary: explicit deletes at workflow transitions (the "immediate" path).**
   - On **final-video approval** → `DeleteObjects` for that request's Tier 2
     intermediates.
   - On **Delivered/Published + grace** → `DeleteObjects` for that request's
     Tier 1 raw sources (thumbnails retained).
   Centralise this in one `StorageLifecycleService.purgeForRequest(requestId, tier)`
   so every transition calls the same audited path, and record what was deleted
   (keys + timestamp) for compliance.

2. **Backstop: S3 lifecycle rules per prefix** (Tier expiries above). These only
   ever fire for objects the primary path missed — abandoned drafts, crashed
   jobs, orphans.

3. **Reconciliation: nightly orphan sweep.** A scheduled job compares Spaces
   keys against live DB records and deletes objects whose request is terminal or
   nonexistent. Catches partial failures that leave stray intermediates.

---

## 5. Mac Mini worker and storage

- The worker **streams inputs from Spaces → local `/tmp/clipper/<jobId>/`**, runs
  FFmpeg/Remotion, **uploads outputs back to Spaces**, then **deletes the scratch
  dir in a `finally` block** regardless of success/failure.
- A small `launchd`/cron guard clears any `/tmp/clipper/*` older than a few hours
  in case a process was killed before cleanup.
- Net effect: **no user media at rest on the Mac** — it satisfies the
  data-minimisation goal automatically and keeps the "delete promptly" promise
  honest even mid-pipeline.

---

## 6. Recommended retention matrix

| Prefix | Tier | Primary delete trigger | Lifecycle backstop |
|---|---|---|---|
| `tmp/`, `processing/` | 0 | after consuming step | 1 day |
| worker `/tmp` (Mac) | 0 | `finally` per job | hourly cron |
| `request_mat/` | 1 | Delivered/Published + 7d | 30 days |
| `ai_videos/`, `animated_videos/`, `animated_overlays/`, `processed_audio/` | 2 | final-video approval | 14 days |
| `final_exports/`, `clips/` | 3 | manual / legal expiry only | business window (see §7) |
| `thumbnails/` | 4 | never (auto) | 5 years |

---

## 7. Cost levers, highest impact first

1. **Delete Tier 2 intermediates on final approval.** Ends multi-year storage of
   large base videos and per-ratio overlays. Likely the largest single saving.
2. **Kill dead prefixes.** Stop writing and remove any residual objects in
   `voice_recordings/`, `processed_audio/`, `animated_videos/`, `animated_overlays/`
   (no live callers) and audit/retire the post-Veo `ai_videos/` references.
3. **Right-size Tier 3 retention.** An 8-year default is rarely justified for
   short marketing clips. Pick a hot window (e.g. 12–24 months) driven by
   business need + local data-protection (PDPA) guidance, then archive or delete.
4. **Serve deliverables through the CDN endpoint.** The code already supports
   `DO_SPACES_CDN_ENDPOINT`; using it cuts repeated egress cost for playback and
   re-downloads versus serving objects directly.
5. **Consider on-demand secondary ratios.** Storing all four aspect ratios
   forever multiplies deliverable size. Option: keep the primary-platform ratio
   hot and re-render the others on request. Trade-off: compute vs storage —
   evaluate against actual re-download rates.
6. **Compress deliverables sensibly.** Ensure final exports use an efficient
   H.264/H.265 profile (VideoToolbox on the M-series Mac) at a bitrate matched to
   short-form social playback, not archival bitrates.
7. **Separate raw uploads into their own bucket/prefix with tight access + short
   lifecycle.** Cleaner privacy story and easier to reason about "delete the
   user's data" as a single scoped operation.

---

## 8. Rollout order

- **Phase A — quick wins (no pipeline change):** fix lifecycle rules per §6, kill
  dead prefixes, audit `ai_videos/`, switch delivery to the CDN endpoint.
- **Phase B — explicit deletes:** add `StorageLifecycleService.purgeForRequest`
  and wire it into the final-approval and Delivered/Published transitions.
- **Phase C — reconciliation:** nightly orphan sweep + worker `/tmp` guard.
- **Phase D — optional optimisation:** on-demand secondary ratios; Tier 3
  retention window finalised with business/legal input.

---

## 9. Open decisions (need business/legal input)

- Exact **Tier 3 retention window** for delivered clips (currently 8y → recommend
  shortening; requires PDPA/business sign-off — not a technical call).
- Whether **secondary ratios** are stored or regenerated on demand.
- Confirm the **privacy wording**: "we delete your uploaded source files after
  delivery" is accurate; the finished clip (which contains that imagery) and the
  upload thumbnails are intentionally retained.

---

## Addendum A — Finalised retention rules (2026-07-05)

These business rules supersede the earlier tier numbers where they differ.

### A.1 The four rules, and how each is enforced

| Rule | Mechanism | Why not lifecycle-only |
|---|---|---|
| **Final clips kept 7 days** after delivery, then deleted | App-level: delete 7 days after the request reaches Delivered/Published | S3 lifecycle is by object **age**, not workflow state; a clip is created at render time, which can be days before delivery — an age-based rule could delete it before the user ever gets it |
| **Show the user** the clip is available for 7 days | Inline text note in the page (next to the video/download button) — no email, no popup | — |
| **Inactive 1 month → auto-cancel + delete uploads & processed files** | Daily scheduled sweep on `ClipRequest` last-activity | Depends on DB last-activity + must flip status and notify — impossible in a bucket rule |
| **Show the user** the auto-cancellation | Inline text note / status label on the request page | — |
| **Thumbnails auto-delete ~2 years** | S3 lifecycle: `thumbnails/` 1825d → **730d** | Fine as a pure age rule |
| **Deleting uploads cascades to all processed material** | Single `purgeRequestMedia(requestId)` that spans every media prefix; nightly reconciliation for lifecycle-driven upload deletions | Lifecycle can't cascade across prefixes |

### A.2 Unified lifecycle: one purge point

A request's media is fully purged (uploads + **all** intermediates + final clips,
**thumbnails excepted**) at whichever comes first:

- **Delivered/Published + 7 days** (the 7-day availability window), or
- **Auto-cancellation** after 30 days of inactivity.

Thumbnails live independently for 2 years. This makes the cascade requirement
automatic: raw uploads are only ever removed by `purgeRequestMedia`, which by
construction deletes every processed artefact for that request in the same call.

### A.3 Corrected S3 lifecycle configuration (age-based backstops)

Lifecycle rules are the **safety net**; the app logic in A.1 drives the exact
timing. Backstops for `final_exports/`/`clips/` are deliberately longer than the
7-day app window so they never delete a clip inside its availability window.

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url https://sgp1.digitaloceanspaces.com --profile clipper \
  --bucket clipper-space --lifecycle-configuration '{"Rules":[
    {"ID":"expire-tmp-1d","Status":"Enabled","Filter":{"Prefix":"tmp/"},"Expiration":{"Days":1}},
    {"ID":"expire-processing-1d","Status":"Enabled","Filter":{"Prefix":"processing/"},"Expiration":{"Days":1}},
    {"ID":"expire-request-mat-30d","Status":"Enabled","Filter":{"Prefix":"request_mat/"},"Expiration":{"Days":30}},
    {"ID":"expire-ai-videos-30d","Status":"Enabled","Filter":{"Prefix":"ai_videos/"},"Expiration":{"Days":30}},
    {"ID":"expire-animated-videos-30d","Status":"Enabled","Filter":{"Prefix":"animated_videos/"},"Expiration":{"Days":30}},
    {"ID":"expire-animated-overlays-30d","Status":"Enabled","Filter":{"Prefix":"animated_overlays/"},"Expiration":{"Days":30}},
    {"ID":"expire-processed-audio-30d","Status":"Enabled","Filter":{"Prefix":"processed_audio/"},"Expiration":{"Days":30}},
    {"ID":"expire-voice-recordings-30d","Status":"Enabled","Filter":{"Prefix":"voice_recordings/"},"Expiration":{"Days":30}},
    {"ID":"expire-final-exports-60d","Status":"Enabled","Filter":{"Prefix":"final_exports/"},"Expiration":{"Days":60}},
    {"ID":"expire-preview-exports-60d","Status":"Enabled","Filter":{"Prefix":"preview_exports/"},"Expiration":{"Days":60}},
    {"ID":"expire-clips-60d","Status":"Enabled","Filter":{"Prefix":"clips/"},"Expiration":{"Days":60}},
    {"ID":"expire-thumbnails-2y","Status":"Enabled","Filter":{"Prefix":"thumbnails/"},"Expiration":{"Days":730}}
  ]}'
```

Changes vs your current config: adds a rule for `final_exports/` (**previously
none — the real deliverable never expired**); adds backstops for the four
uncovered intermediate prefixes; tightens `request_mat` 90→30d, `ai_videos`
90→30d, `tmp`/`processing` 7→1d; thumbnails 1825→730d; `clips` 8y→60d.

### A.4 Privacy fix — raw uploads are currently world-readable

Your bucket policy grants **public `s3:GetObject`** on `request_mat/*` and
`ai_videos/*`. That means anyone with the URL can read customers' raw uploaded
photos/videos and base renders — directly at odds with the "delete uploads
promptly" goal. Recommend serving those via **presigned URLs** (short-lived) or
the CDN and removing them from the public policy, leaving only `thumbnails/*`
public:

```bash
aws s3api put-bucket-policy \
  --endpoint-url https://sgp1.digitaloceanspaces.com --profile clipper \
  --bucket clipper-space --policy '{"Version":"2012-10-17","Statement":[
    {"Sid":"PublicReadThumbnailsOnly","Effect":"Allow","Principal":"*",
     "Action":["s3:GetObject"],"Resource":["arn:aws:s3:::clipper-space/thumbnails/*"]}
  ]}'
```

⚠️ This requires a code change first: anything that currently loads
`request_mat/` (or `ai_videos/`) via `spacesPublicUrl` must switch to presigned
URLs, or those views will break. Sequence the code change before applying the
policy.

### A.5 Expiry information — inline text notes only (no email, no popups)

All expiry information is shown as **static text rendered in the page** at the
relevant interface (beside the video player, the download button, uploaded
image/video thumbnails, and the request status). There are **no emails, push,
or popup notifications**. Each note is derived from data the page already has —
no notification service or scheduled send is involved.

| Where | Text note (example) | Derived from |
|---|---|---|
| Beside final video / download button | "Available to download until 12 Jul 2026 (7 days)" | `deliveredAt + 7d` |
| Final video, inside the last day | "Expires today — download now" | `deliveredAt + 7d` vs now |
| Uploaded images/videos on request page | "Source files kept until this request is delivered or 30 days of inactivity" | request state |
| Request header when nearing inactivity cutoff | "Inactive — will be auto-cancelled on 4 Aug 2026" | `lastActivityAt + 30d` |
| Request header after auto-cancel | "Auto-cancelled (inactive 30 days). Uploaded and processed files were deleted." | `status = AutoCancelled` |

`src/lib/email.ts` is **not** used for any of this.

### A.6 Application work this implies (spec only — not built here)

- A `StorageLifecycleService.purgeRequestMedia(requestId, { keepThumbnails:true })`
  that deletes across `request_mat/ ai_videos/ animated_videos/ animated_overlays/
  processed_audio/ voice_recordings/ final_exports/ clips/ tmp/ processing/`.
- A **last-activity timestamp** on `ClipRequest` (extend `updatedAt`, or add
  `lastActivityAt`) bumped on every user/staff action, for the inactivity sweep.
- Two **scheduled jobs**: (a) delete final clips + `purgeRequestMedia` at
  Delivered+7d; (b) daily inactivity sweep → mark `AutoCancelled` +
  `purgeRequestMedia` (the UI text notes in A.5 then reflect the new state — no
  send step).
- A **nightly reconciliation** sweep: if `request_mat/` for a request is gone
  (e.g. via the lifecycle backstop) but other prefixes remain, purge them — this
  enforces the cascade even when deletion was lifecycle-driven, not app-driven.
- Add an `AutoCancelled` request status (distinct from user-initiated `Cancelled`).

---

## Addendum B — Mac Mini (M4, 16 GB) as processing unit: time & cost (2026-07-05)

### B.1 Is it suitable? Yes.

The M4 is a strong FFmpeg/Remotion box (fast single-thread + VideoToolbox
hardware H.264/H.265 encode). 16 GB comfortably runs **1–2 concurrent** Remotion
renders (each spins up Chromium, ~1–3 GB); beyond that, queue. For early/moderate
volume this is ample and far cheaper than hourly cloud render instances. Scale by
adding a second worker when concurrency demand outgrows one box.

### B.2 The transfer concern — it is not the bottleneck (with fibre)

Three transfers matter. **Crucially, only the middle one involves the Mac Mini:**

1. **User → Spaces** (upload raw media) and **3. Spaces → User** (playback the
   final clip) go **directly to/from Spaces (via CDN)** and are *unchanged* by
   moving processing to the Mac. Putting the Mac in the loop does **not** slow
   the user-facing experience.
2. **Spaces ⇆ Mac Mini** (pull inputs, push outputs) is the only Mac transfer.

Latency is tiny: DO `sgp1` is Singapore; a Mac in Thailand is ~15–30 ms away.
The only variable is the Mac's link speed — and **upload** matters most (outputs
go *up* to Spaces). Rough per-job figures (≈80 MB in, ≈200 MB out incl.
gate-visible intermediates + 4 final ratios):

| Mac internet link | Pull inputs (~80 MB) | Push outputs (~200 MB) | Render+encode (M4) |
|---|---|---|---|
| Symmetric 1 Gbps fibre | ~1 s | ~3 s | ~2–4 min |
| 500 / 100 Mbps | ~1.5 s | ~17 s | ~2–4 min |
| 300 / 30 Mbps | ~2 s | ~55 s | ~2–4 min |

**Compute dominates by an order of magnitude.** Transfer is seconds-to-~1-minute
versus minutes of rendering — negligible **as long as the Mac is on decent
(ideally symmetric) fibre**, which is cheap and common in Thailand. A slow
*upstream* link is the only thing that would make transfer noticeable.

### B.3 Keep transfer minimal

- Put the Mac on **symmetric fibre**; upstream is the sensitive number.
- Keep **purely-internal temp files local** to the Mac during a job; only upload
  assets the approval gates/user actually view + the final deliverables.
- Let the AWS SDK do **multipart** transfers and **parallelise** the 4 ratio
  uploads.
- Region stays aligned (`sgp1` ↔ Thailand) — already low latency.

### B.4 Cost notes

- Pulling inputs counts as Spaces **outbound** transfer (~80 MB/job → the
  included 1 TB covers ~12k jobs). Pushing outputs to Spaces is inbound (free).
- The dominant egress is serving clips to users (unavoidable, CDN-cached), not
  the Mac's traffic.
- One-time Mac hardware + minimal power (M4 ~30–50 W under load) versus recurring
  cloud render billing — the Mac pays back quickly at steady volume.

### B.5 Implemented in this pass (code)

- `RequestStatus.AutoCancelled` + added to `TERMINAL_STATUSES` + Thai status
  presentation entry.
- `src/config/retention.ts` — retention windows (7-day clip, 30-day inactivity,
  730-day thumbnails).
- `src/services/StorageLifecycleService.ts` — `purgeRequestMedia()` cascade
  delete across every media prefix (thumbnails kept), batched `DeleteObjects`.
- `src/lib/retentionNotes.ts` — pure helpers producing the **inline Thai text
  notes** (availability window, inactivity countdown, auto-cancel notice).
- `src/lib/spaces.ts` — `spacesSignedUrl()` presign helper.
- `scripts/retention-sweep.js` — cron sweep (delivered+7d purge; inactive+30d
  auto-cancel+purge). Supports `--dry-run`, `--clip-days`, `--inactive-days`.

### B.6 Deferred (needs a decision or careful wiring — not done here)

- **Privatising raw uploads.** Objects are written with `ACL:"public-read"`, so
  they stay public regardless of bucket policy. True privacy needs flipping those
  writes to `ACL:"private"`, re-ACLing existing objects, and switching the
  `spacesPublicUrl` read sites for `request_mat/`/`ai_videos/` to
  `spacesSignedUrl`. Coordinated change; sequence before relying on the policy.
- Optional dedicated `deliveredAt` / `lastActivityAt` columns (the sweep uses
  `updated_at` as a proxy today).

### B.7 Also wired in this pass

- `src/features/requests/components/RetentionNoteText.tsx` — inline note
  renderer (info/warning/expired tones).
- Requester request page (`dashboard/requests/[id]/page.tsx`) now shows the
  final-clip availability note + inactivity/auto-cancel note in the status card,
  and the uploaded-materials note replaces the old "90 days" text.
