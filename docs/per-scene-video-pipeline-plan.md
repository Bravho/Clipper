# Plan: Per-scene script approval → progressive Veo generation

## Goal

Restructure the post-voice pipeline into a per-scene loop that matches the Veo 3.1
video-extension model:

```
voice approved
  → generate ALL scene scripts
  → review overview of all scene scripts            (AwaitingSceneDesignApproval)
  → FOR EACH scene N (1..k):
       review/EDIT scene N script + select images   (AwaitingSceneScriptApproval)  ← NEW
       → approve  → generate scene N video          (GeneratingBaseVideo → extend)
       → review scene N video                        (AwaitingVideoApproval)
            • Approve  → go to scene N+1 script gate (or animations if last)
            • Edit script + images → resubmit        → regenerate scene N only
  → animations → composition → publishing
```

Requester-only controls every gate. There is **no reject button** at the video gate —
only "Approve this video" or "Edit the scene script and resubmit."

## Current state (what exists today)

- Audio-first ordering is already in place (voice runs before video).
- `AwaitingSceneDesignApproval` already generates and shows an overview of all scene scripts.
- Progressive extension already exists: `_runVideoGeneration` (scene 1) and
  `_runNextVideoExtension` (scene N extends from scene N-1's Veo task). The job model
  already carries `videoGenTaskIds[]`, `sceneVideoAssetIds[]`, `approvedScenePlan`, and
  per-scene `imageIndexes`.
- `VideoApprovalPanel.tsx` already has review/revise modes, per-scene script editing,
  and per-scene image selection (`toggleSceneImage`, `getSceneImages`).

## Gaps to close

1. **Missing service methods (bug).** `approve-video/route.ts` calls
   `videoGenerationService.approveBaseVideoByRequester(...)` and
   `revise-video/route.ts` calls `requestVideoRevisionByRequester(...)`. Neither method
   exists in `VideoGenerationService.ts`. These must be implemented.
2. **No per-scene script gate.** After the overview is approved, the pipeline jumps
   straight to `GeneratingBaseVideo` for scene 1. We need a gate
   (`AwaitingSceneScriptApproval`) before each scene generates, where the requester
   confirms/edits that scene's script + images.
3. **Approval doesn't advance scene-by-scene through the script gate.** Approving a
   scene video must route to the *next scene's script gate*, not directly to the next
   generation.
4. **No "current scene" tracker.** The flow needs to know which scene's gate is active.

## Changes by file

### 1. `src/domain/enums/VideoGenerationStep.ts`
- Add `AwaitingSceneScriptApproval = "awaiting_scene_script_approval"` between
  `AwaitingSceneDesignApproval` and `GeneratingBaseVideo`.
- Add label + description entries (it is an *awaiting* step, so **not** added to
  `POLLING_STEPS`).
  - label: "Scene script ready for review"
  - description: "Review and edit this scene's script and images before it is generated."

### 2. `src/domain/models/VideoGenerationJob.ts`
- Add `currentSceneIndex: number` (0-based index of the scene whose gate/generation is
  active). Defaults to 0.
- Update `CreateVideoGenerationJobInput` defaults and the create call in the service
  (initialise to 0).

### 3. Repositories (persist the new field)
- `src/repositories/mock/MockVideoGenerationJobRepository.ts`: include `currentSceneIndex`
  in create/update mapping.
- `src/repositories/postgres/PostgresVideoGenerationJobRepository.ts`: add column
  read/write.
- New migration `src/db/migrations/00X_scene_index.sql`:
  `ALTER TABLE video_generation_jobs ADD COLUMN current_scene_index INT NOT NULL DEFAULT 0;`

### 4. `src/services/VideoGenerationService.ts`

**a. `approveSceneDesignByRequester` (overview gate) — change target.**
Instead of `currentStep: GeneratingBaseVideo` + immediate `_runVideoGeneration`, set:
```
currentStep: AwaitingSceneScriptApproval,
currentSceneIndex: 0,
approvedScenePlan: <sanitized/normalized plan>,
```
Do **not** start Veo here.

**b. NEW `approveSceneScriptByRequester(jobId, userId, { scenePlan, hookThai, scriptThai, captionThai })`.**
- Guard: step must be `AwaitingSceneScriptApproval`.
- Persist requester edits to the active scene (and shared script fields) into
  `approvedScenePlan` — reuse the existing sanitize/normalize helpers and the same
  image-selection (`imageIndexes`) the UI submits.
- If `currentSceneIndex === 0` → `_runVideoGeneration` (scene 1).
  Else → `_runNextVideoExtension` (extends from the last approved scene).
- Set `currentStep: GeneratingBaseVideo`. On error → Failed/`failedAtStep`.

**c. NEW `approveBaseVideoByRequester(jobId, userId)`.**
- Guard: step must be `AwaitingVideoApproval`.
- Let `plan = approvedScenePlan`, `i = currentSceneIndex`.
- If `i + 1 < plan.length`:
  set `currentSceneIndex: i + 1`, `currentStep: AwaitingSceneScriptApproval`,
  `videoApprovedBy: userId` → next scene's script gate (no generation yet).
- Else (last scene approved): `currentStep: GeneratingAnimations` and kick off
  `_runAnimationGeneration` (same as the existing staff `approveBaseVideo` tail).

**d. NEW `requestVideoRevisionByRequester(jobId, userId, { scenePlan, hookThai, scriptThai, captionThai })`.**
- Guard: step must be `AwaitingVideoApproval`.
- Persist edits to the **current** scene + images into `approvedScenePlan`.
- Drop the current (rejected) scene's in-flight artifacts so regeneration targets the
  same scene index:
  - pop the last entry of `videoGenTaskIds` and `sceneVideoAssetIds`,
  - clear `baseVideoAssetId` back to the previous approved cumulative asset (or null for
    scene 0).
- If `currentSceneIndex === 0` → `_runVideoGeneration` (regenerate scene 1).
  Else → `_runNextVideoExtension` (re-extend the current scene from scene N-1).
- Set `currentStep: GeneratingBaseVideo`.

**e. Helper `_persistSceneEdits(job, payload)`** shared by (b) and (d): merges the
edited active scene (`visualDescriptionThai`, `imageIndexes`, `durationSeconds`) and
shared fields (`hookThai`, `scriptThai`, `captionThai`) into `approvedScenePlan`,
running the existing sanitizers. Keeps the two methods small and consistent.

**f. Leave the staff `approveBaseVideo` / `rejectBaseVideo` as-is** (not on the
requester per-scene path), but confirm nothing else routes the requester through them.

### 5. API routes
- `approve-video/route.ts`: already calls `approveBaseVideoByRequester` — now backed by
  a real method. No change needed beyond verifying the response shape.
- `revise-video/route.ts`: already calls `requestVideoRevisionByRequester` — now real.
- **NEW** `src/app/api/requests/[id]/scene-script/approve/route.ts`: requester-only;
  validates ownership + jobId, calls `approveSceneScriptByRequester`. Mirror the
  existing `scene-design/approve/route.ts` route for auth/validation boilerplate.

### 6. UI `src/features/requests/components/VideoApprovalPanel.tsx`
- Handle the new `AwaitingSceneScriptApproval` step: render the active scene's script +
  image selection in an editable form with a single "Approve & generate this scene"
  action that POSTs to `scene-script/approve`. (Reuse the existing `editScenes` /
  `toggleSceneImage` / `activeEditScene` machinery already in this file.)
- At `AwaitingVideoApproval`: keep the two actions only — "Approve video" (→ approve-video)
  and "Edit scene script & resubmit" (→ revise-video). Remove/omit any reject affordance.
- Show progress as "Scene N of k" using `currentSceneIndex` + plan length.
- Confirm `PipelineStatusPoller` / labels treat `AwaitingSceneScriptApproval` as a
  non-polling review step.

### 7. Tests `tests/services/` (mirror existing patterns, fresh Mock repos)
- overview approval → lands on `AwaitingSceneScriptApproval`, `currentSceneIndex === 0`,
  no Veo task started.
- `approveSceneScriptByRequester` scene 0 → `GeneratingBaseVideo`, `_runVideoGeneration`
  called; edits persisted to `approvedScenePlan` incl. `imageIndexes`.
- `approveBaseVideoByRequester` mid-plan → `currentSceneIndex` increments, step →
  `AwaitingSceneScriptApproval`; last scene → `GeneratingAnimations`.
- `requestVideoRevisionByRequester` → pops in-flight task/asset, regenerates the same
  scene index, edits persisted.
- Guard tests: each method rejects when called at the wrong step.

## Decision: Option A (explicit pre-generation gate) — CONFIRMED
Each scene has two requester touchpoints: (1) approve/edit the scene script + images
*before* generation, and (2) approve the resulting video *or* edit & resubmit. This keeps
the explicit "approve the script before it generates" checkpoint and avoids wasted Veo
renders.

## Database persistence (cloud PostgreSQL) — verified

**Are pipeline steps recorded in cloud Postgres today? Yes (latest state).**
- `videoGenerationJobRepository` is wired to `PostgresVideoGenerationJobRepository`
  (`src/repositories/index.ts:80`), not the Mock. (The note in `CLAUDE.md` saying
  pipeline jobs are in-memory Mock is **stale** — they are persisted to Postgres.)
- Every step transition in the service goes through
  `videoGenerationJobRepository.update({ currentStep, ... })`. `currentStep` maps to the
  `current_step` column in `JOB_UPDATE_COLS`, and `update()` writes
  `current_step = $n, updated_at = NOW()` to the `video_generation_jobs` row. So each
  transition is persisted to cloud Postgres immediately.
- `current_step` is a plain `TEXT NOT NULL` column (migration `004_persist_video_generation_jobs.sql:13`),
  **not** a Postgres ENUM type — so the new `AwaitingSceneScriptApproval` value needs
  **no schema migration**; it's just a new string.

**Caveat 1 — silent-drop risk for the new field.** `update()` skips any input key not
present in `JOB_UPDATE_COLS` (`PostgresVideoGenerationJobRepository.ts:254-255:
if (!col) continue;`) — no error is thrown. Therefore `currentSceneIndex` must be added
in **all** of these or it will silently fail to persist:
  1. `VideoGenerationJob` model + `CreateVideoGenerationJobInput`
  2. migration: `ALTER TABLE video_generation_jobs ADD COLUMN current_scene_index INT NOT NULL DEFAULT 0;`
  3. `rowToJob` (read `row.current_scene_index`)
  4. the `INSERT` column list + value in `create()`
  5. `JOB_UPDATE_COLS` (`currentSceneIndex: "current_scene_index"`) ← the easy one to forget
  6. the Mock repo (for tests)
A test should assert the value survives a `findById` round-trip.

**Caveat 2 — there is NO per-step audit trail for pipeline steps.** The job stores only
the *latest* `current_step` (overwritten on each transition). A `request_status_history`
table exists, but it tracks the **request-level** status lifecycle
(`Draft → Submitted → …`), not the `VideoGenerationStep` pipeline. So today you can see
"what step is this job on now," but not "every step it passed through and when."
  - If "each step should be recorded" means **current state persisted** → already done,
    no extra work.
  - If it means a **full history/audit log** of every pipeline step (incl. per-scene
    gate entries and timestamps) → that needs a new table, e.g.
    `video_generation_step_history(id, job_id, step, scene_index, actor_id, created_at)`,
    written on every transition. This is optional and not in the core plan above —
    flag if you want it and I'll add it as a step.

## Rough effort
Enum + model + repos + migration: small. Service methods: medium (the revision
roll-back logic is the fiddly part). API route: small. UI: small-medium (mostly wiring
an existing form to a new step). Tests: medium. No changes to Veo/FFmpeg/animation
internals.
