-- Migration 026: "Approve everything from here" express lane (step 5 gate)
--
-- At the step-5 review gate (รวมฉากและเลือกเพลง / AwaitingAnimationApproval) the
-- requester may opt out of every REMAINING approval gate: the pipeline then runs
-- straight through the merged-video review, the subtitle/graphic review and the
-- extra-channel-ratio button without stopping, and lands on the final download
-- step. Choosing it also fixes the requester's own subtitle language to Thai
-- only. (The Travy export is unaffected — it always renders EN+ZH, which is a
-- Travy platform requirement, not a requester preference.)
--
-- One flag on the job, so the auto-advance survives a process restart, a worker
-- handoff and a retry — it must not live in the request that set it going.
-- Additive, defaulted, safe to run multiple times.

ALTER TABLE video_generation_jobs
  ADD COLUMN IF NOT EXISTS auto_approve_remaining BOOLEAN NOT NULL DEFAULT FALSE;
