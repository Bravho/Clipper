# Preview images missing below the player — analysis + plan

**Status:** Phases 1–5 IMPLEMENTED (2026-08-01). Not yet typechecked or test-run — see
"Verification owed" at the end.
**Scope agreed:** full plan, Phases 0–5. Poster stays **server-side (ffmpeg)**, made reliable.

Two UIs show a playable video with no still preview beneath it:

- `วิดิโอของคุณ` — the RClipper Management library (`VideoLibrary.tsx`)
- `วิดิโอของคุณพร้อมแล้ว` — the distribution-review step (`DistributionReviewPanel.tsx`)

They fail for **different reasons**.

---

## 1. Root cause

### A. Management library — UI is correct, the data is NULL

`VideoLibrary.tsx:481-490` already renders an `<img>` + "Preview" caption below the player. It is
gated on `video.thumbnailUrl` = `spacesPublicUrl(item.thumbnailStorageKey)`
(`app/(auth)/dashboard/management/content/page.tsx:111`). The column is NULL. Four causes:

1. **Only one creation site ever writes a poster.** `_renderCaptionedRatio`
   (`VideoGenerationService.ts:2076-2110`) is the sole caller of `generateVideoThumbnail` for a
   final clip. Every other `FinalClip` insert writes `thumbnailKey: ""` — notably
   `_composeRatioExport` (`:3313-3323`), which produces the `finalExport_*` masters.
   `eligibleExportAssetIds` falls back to the master when the captioned export is absent
   (`ManagementEntitlementService.ts:97`), so a transfer can select a thumbnail-less asset
   **by construction**.
2. **The poster step is fail-open and environment-dependent.** try/catch around a full MP4
   download from Spaces plus `ffmpeg` **and** `ffprobe` shell-outs. On failure `posterKey = ""`
   and only a `console.error` survives. Nothing is recorded, nothing retries.
3. **Transfer never repairs.** `ManagementTransferService.ts:342` copies `asset.thumbnailKey`
   once; `createOrGetTransferredVideo` is `ON CONFLICT DO NOTHING`, so an item transferred while
   the poster was missing stays NULL forever.
4. **Management uploads get no poster at all.** `ManagementUploadService` and the
   `/api/management/uploads/[contentId]/complete` route have zero thumbnail logic — unlike the
   requester-side `UploadService`, which already uses a browser-captured frame
   (`storePosterThumbnail`, `lib/thumbnails.ts:131`).

Compounding: the "No preview" placeholder is **suppressed** whenever a playable video exists
(`VideoLibrary.tsx:491-497`), so the failure renders as blank space rather than a visible gap.

### B. Distribution review — the image is generated but was not visible

`_attachChannelPreviews` (`VideoGenerationService.ts:2713-2775`) does extract a per-channel poster
frame into `draft.previewImageUrl`.

> **Correction to the first draft of this analysis.** An `<img>` for it DID already exist — it was
> rendered *above* the player and gated on `previewUrl`, and in the reported screenshot that value
> was null. So section B was not purely a rendering bug: the preview genuinely failed to generate,
> and the only other place the value was used (`<video poster>`) is invisible the moment
> `preload="metadata"` pulls a frame. Both halves needed fixing.

Secondary: on the no-additional-ratios path `_finalizeAndStartTravy` runs inline in a web request
(`:2279`), so preview generation executes on the **web droplet**; on the additional-ratios path it
runs inside the Mac worker claim (`:2368`). Same feature, two machines, only one guaranteed to
have ffmpeg.

---

## 2. Plan

### Phase 0 — Diagnose (no code)

Run against prod:

```sql
-- final clips with no poster, by type
SELECT asset_type, video_ratio, count(*)
FROM uploaded_assets
WHERE asset_type = 'final_clip' AND coalesce(thumbnail_key,'') = ''
GROUP BY 1,2;

-- management items with no poster, by source
SELECT source_type, count(*) FILTER (WHERE thumbnail_storage_key IS NULL) AS missing, count(*)
FROM management_content_items
WHERE removed_at IS NULL
GROUP BY 1;
```

Then grep worker + droplet logs for `poster generation failed` and `[publishing preview]`.
Distinguishes "call site never ran" from "ffmpeg failed". Aims Phase 1 rather than guessing.

### Phase 1 — One reliable poster helper

- New `ensureAssetPoster(assetId): Promise<{ key: string; url: string } | null>`
  (`src/services/AssetPosterService.ts`, or co-located in `lib/thumbnails.ts`):
  - returns early if `thumbnail_key` is already non-empty (idempotent, safe to call anywhere);
  - `buildThumbnailKey(userId, requestId, 'poster-<ratio>')` → `generateVideoThumbnail` →
    `uploadedAssetRepository.update(id, { thumbnailKey, thumbnailUrl })`;
  - never throws; logs with a stable prefix so failures are greppable.
- Harden `generateVideoThumbnail`: ffprobe already degrades to seek-0 — also degrade cleanly when
  `ffmpeg` itself is absent (classify ENOENT distinctly; today it looks like a generic error).
- Call it from **every** FinalClip site: `_renderCaptionedRatio` (replacing the inline block),
  `_composeRatioExport` (`:3313`), and the Travy on-demand 16:9 compose.
- **No migration needed** — `thumbnail_key = ''` is already the "missing" marker.

### Phase 2 — Self-healing transfer

- `ManagementTransferService.transferVideo`: when `asset.thumbnailKey` is empty, call
  `ensureAssetPoster(asset.id)` and use the result. Same in the bulk `transfer()` path.
- Add `updateThumbnail(contentId, key)` to `IManagementContentRepository` + Postgres + Mock, and
  call it when the item already existed with `thumbnail_storage_key IS NULL`. Fixes the
  ON CONFLICT DO NOTHING blind spot.

### Phase 3 — UI

- `DistributionReviewPanel`: add a `<figure>` with `<img src={previewUrl}>` + caption directly
  below the `<video>` block (`~:602-612`), mirroring `VideoLibrary`'s markup. Keep the `poster`
  attribute as well. Caption string goes through `useI18n`.
- `VideoLibrary`: stop suppressing the placeholder when a video exists — always render the preview
  slot, showing a skeleton/"ไม่มีภาพตัวอย่าง" when null, so a future failure is visible rather
  than silent.

### Phase 4 — Management uploads get a poster

- `UploadVideoButton`: after file selection, draw a frame to a `<canvas>` from a local
  `<video>` object URL, export a JPEG data URL.
- Send it as an optional `posterDataUrl` on the `complete` call; extend the Zod schema (validate
  the `data:image/...;base64,` prefix, cap size).
- `ManagementUploadService.complete`: `storePosterThumbnail(dataUrl, buildThumbnailKey(...))` and
  set `thumbnail_storage_key`. Reuses the exact path the requester-side uploader already proves.

### Phase 5 — Backfill + verification

- `scripts/backfill-management-thumbnails.js`: for `management_content_items` with
  `thumbnail_storage_key IS NULL`, resolve the primary asset's `storage_key`, generate, update.
  Reuses the ffmpeg/Spaces boilerplate in `scripts/backfill-video-thumbnails.js`.
- Extend `scripts/backfill-video-thumbnails.js` to include `final_clip` rows with an empty
  `thumbnail_key`.
- Tests: new `ManagementTransfer.test.ts` case (asset without thumbnail → poster generated and
  copied); `VideoGenerationService` assertions that each export path calls `ensureAssetPoster`.
- Manual check on both pages after deploy.

---

## 3. Risks / notes

- **ffmpeg on the droplet.** Phase 2's repair runs inside a web request. If the droplet still
  lacks ffmpeg, transfer-time repair silently no-ops — Phase 0's log grep must confirm this
  before we rely on it. Prefer generating during the worker-run pipeline (Phase 1) as the primary
  path; treat Phase 2 as a net, not the plan.
- **Bandwidth.** `generateVideoThumbnail` downloads the whole MP4. Finals are ~25s so it's
  acceptable, but repairing many items at once should be batched/rate-limited.
- **Spaces ACL.** Thumbnails are written `public-read` under `thumbnails/` (730-day backstop). If
  the bucket ever blocks public ACLs the `<img>` will 403 rather than be absent — a different
  symptom worth distinguishing during verification.
---

## 4. What shipped

| File | Change |
|---|---|
| `src/services/AssetPosterService.ts` | **New.** `ensureAssetPoster(assetId, baseName?)` — idempotent, never throws, classified `[poster]` logging, skips when `DO_SPACES_BUCKET` is unset. |
| `src/lib/thumbnails.ts` | ENOENT left unwrapped so it can be classified as "ffmpeg not installed"; explicit error on an empty ffmpeg frame. |
| `src/services/VideoGenerationService.ts` | `_renderCaptionedRatio` and `_composeRatioExport` both create the asset then call `ensureAssetPoster`; `_attachChannelPreviews` now REUSES that poster instead of extracting a second, duplicate frame. |
| `src/services/management/ManagementTransferService.ts` | `_posterKeyFor()` generates a poster when the export has none (injectable for tests); repairs an already-transferred item whose `thumbnail_storage_key` is NULL. |
| `src/features/requests/components/DistributionReviewPanel.tsx` | Cover still moved BELOW the player as a `<figure>` with a download link; dashed placeholder when absent. |
| `src/features/management/components/VideoLibrary.tsx` | Preview slot always renders; "No preview image" placeholder instead of collapsing to blank. |
| `src/features/management/components/UploadVideoButton.tsx` | Captures a midpoint frame via canvas (`preload="auto"`, 8s timeout, 640px, q0.7) and sends `posterDataUrl`. |
| `.../uploads/[contentId]/complete/route.ts` | Validates `posterDataUrl` (data-URL shape, 4 MB cap). |
| `src/services/management/ManagementUploadService.ts` | Stores it via `storePosterThumbnail` and sets `thumbnail_storage_key`; best-effort. |
| `scripts/backfill-video-thumbnails.js` | Now covers `final_clip`, not just raw `video` uploads. |
| `scripts/backfill-management-thumbnails.js` | **New.** Repairs library items with no preview; `--dry-run`, `--limit`. |
| `tests/services/ManagementTransfer.test.ts` | Five cases covering reuse / generate / give-up / repair / leave-alone. |

## 5. Verification owed

Nothing below could be run from the Linux sandbox — the mount is ~6 MB/s and an `npm install`
cannot finish inside its per-call limit, so this was reviewed by hand only. Please run:

```bash
npx tsc --noEmit
npm test -- tests/services/ManagementTransfer.test.ts
npm test
npm run lint
node scripts/backfill-management-thumbnails.js --dry-run   # against prod, read-only
```

Then check both pages visually, and confirm `[poster]` does not appear with
`reason=ffmpeg_missing` in the droplet logs — if it does, the web host still needs ffmpeg and only
the worker-run paths will produce posters.

- **Toolchain.** The sandbox mount is too slow for tsc/jest; copy `src` to `/tmp` with a minimal
  `npm install` to typecheck and test.
