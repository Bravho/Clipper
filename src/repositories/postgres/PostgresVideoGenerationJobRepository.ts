import { IVideoGenerationJobRepository } from "@/repositories/interfaces/IVideoGenerationJobRepository";
import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
  VideoGenerationStepHistoryEntry,
  ChannelPublishingDraft,
} from "@/domain/models/VideoGenerationJob";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { pool } from "@/lib/db";

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeJobValue(key: string, value: unknown): unknown {
  if (
    key === "videoGenTaskIds" ||
    key === "sceneVideoAssetIds" ||
    key === "animatedOverlayAssetIds" ||
    key === "publishingDrafts" ||
    key === "renderPayload"
  ) {
    return value == null ? null : JSON.stringify(value);
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToJob(row: Record<string, unknown>): VideoGenerationJob {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    status: row.status as VideoGenerationJobStatus,
    currentStep: row.current_step as VideoGenerationStep,
    currentSceneIndex: nullableNumber(row.current_scene_index) ?? 0,
    failedAtStep: (row.failed_at_step as VideoGenerationStep) ?? null,
    storyboard: (row.storyboard as string) ?? null,
    approvedStoryboard: (row.approved_storyboard as string) ?? null,
    videoEngine: (row.video_engine as "montage" | "veo") ?? "montage",
    aiBrollEnabled: (row.ai_broll_enabled as boolean) ?? false,
    scenePlan: (row.scene_plan as string) ?? null,
    scriptThai: (row.script_thai as string) ?? null,
    scriptEnglish: (row.script_english as string) ?? null,
    scriptChinese: (row.script_chinese as string) ?? null,
    hookThai: (row.hook_thai as string) ?? null,
    hookEnglish: (row.hook_english as string) ?? null,
    captionThai: (row.caption_thai as string) ?? null,
    captionEnglish: (row.caption_english as string) ?? null,
    captionChinese: (row.caption_chinese as string) ?? null,
    approvedScenePlan: (row.approved_scene_plan as string) ?? null,
    approvedScriptThai: (row.approved_script_thai as string) ?? null,
    approvedScriptEnglish: (row.approved_script_english as string) ?? null,
    approvedScriptChinese: (row.approved_script_chinese as string) ?? null,
    approvedHookThai: (row.approved_hook_thai as string) ?? null,
    approvedHookEnglish: (row.approved_hook_english as string) ?? null,
    approvedCaptionThai: (row.approved_caption_thai as string) ?? null,
    approvedCaptionEnglish: (row.approved_caption_english as string) ?? null,
    approvedCaptionChinese: (row.approved_caption_chinese as string) ?? null,
    videoGenTaskId: (row.video_gen_task_id as string) ?? null,
    videoGenTaskIds: parseJsonField<string[] | null>(row.video_gen_task_ids, null),
    sceneVideoAssetIds: parseJsonField<(string | null)[] | null>(row.scene_video_asset_ids, null),
    videoGenStatus: (row.video_gen_status as "submitted" | "processing") ?? null,
    videoGenLastPolledAt: row.video_gen_last_polled_at
      ? new Date(row.video_gen_last_polled_at as string)
      : null,
    baseVideoAssetId: (row.base_video_asset_id as string) ?? null,
    ttsTaskId: (row.tts_task_id as string) ?? null,
    rvcVoiceModel: (row.eleven_labs_voice_id as string) ?? "",
    voiceRecordingAssetId: (row.voice_recording_asset_id as string) ?? null,
    processedVoiceAssetId: (row.processed_voice_asset_id as string) ?? null,
    selectedMusicTrack: (row.selected_music_track as string) ?? null,
    voiceDurationSeconds: nullableNumber(row.voice_duration_seconds),
    voiceTimestamps: (row.voice_timestamps as string) ?? null,
    finalExport_9_16_assetId: (row.final_export_9_16_asset_id as string) ?? null,
    finalExport_16_9_assetId: (row.final_export_16_9_asset_id as string) ?? null,
    finalExport_1_1_assetId: (row.final_export_1_1_asset_id as string) ?? null,
    finalExport_4_5_assetId: (row.final_export_4_5_asset_id as string) ?? null,
    finalExport_tvent_assetId: (row.final_export_tvent_asset_id as string) ?? null,
    captionedExport_9_16_assetId: (row.captioned_export_9_16_asset_id as string) ?? null,
    captionedExport_16_9_assetId: (row.captioned_export_16_9_asset_id as string) ?? null,
    captionedExport_1_1_assetId: (row.captioned_export_1_1_asset_id as string) ?? null,
    captionedExport_4_5_assetId: (row.captioned_export_4_5_asset_id as string) ?? null,
    tventVideoStatus:
      (row.tvent_video_status as "idle" | "generating" | "ready" | "failed") ?? "idle",
    selectedMotionTemplate: (row.selected_motion_template as string) ?? "none",
    publishingDrafts: parseJsonField<ChannelPublishingDraft[] | null>(row.publishing_drafts, null),
    subtitleLanguages: ((row.subtitle_languages as string[]) ?? ["en", "zh"]) as ("th" | "en" | "zh")[],
    subtitleTimeline: (row.subtitle_timeline as string) ?? null,
    animationSpec: (row.animation_spec as string) ?? null,
    animatedVideoAssetId: (row.animated_video_asset_id as string) ?? null,
    animatedOverlayAssetIds: parseJsonField<Record<string, string> | null>(
      row.animated_overlay_asset_ids,
      null
    ),
    contentApprovedBy: (row.content_approved_by as string) ?? null,
    videoApprovedBy: (row.video_approved_by as string) ?? null,
    voiceApprovedBy: (row.voice_approved_by as string) ?? null,
    animationApprovedBy: (row.animation_approved_by as string) ?? null,
    finalApprovedBy: (row.final_approved_by as string) ?? null,
    renderState:
      (row.render_state as "queued" | "claimed" | "done" | "failed") ?? null,
    renderStep: (row.render_step as string) ?? null,
    renderPayload: parseJsonField<Record<string, unknown> | null>(row.render_payload, null),
    claimedBy: (row.claimed_by as string) ?? null,
    claimedAt: row.claimed_at ? new Date(row.claimed_at as string) : null,
    renderHeartbeatAt: row.render_heartbeat_at
      ? new Date(row.render_heartbeat_at as string)
      : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

const JOB_UPDATE_COLS: Record<string, string> = {
  status: "status",
  currentStep: "current_step",
  currentSceneIndex: "current_scene_index",
  failedAtStep: "failed_at_step",
  storyboard: "storyboard",
  approvedStoryboard: "approved_storyboard",
  videoEngine: "video_engine",
  aiBrollEnabled: "ai_broll_enabled",
  scenePlan: "scene_plan",
  scriptThai: "script_thai",
  scriptEnglish: "script_english",
  scriptChinese: "script_chinese",
  hookThai: "hook_thai",
  hookEnglish: "hook_english",
  captionThai: "caption_thai",
  captionEnglish: "caption_english",
  captionChinese: "caption_chinese",
  approvedScenePlan: "approved_scene_plan",
  approvedScriptThai: "approved_script_thai",
  approvedScriptEnglish: "approved_script_english",
  approvedScriptChinese: "approved_script_chinese",
  approvedHookThai: "approved_hook_thai",
  approvedHookEnglish: "approved_hook_english",
  approvedCaptionThai: "approved_caption_thai",
  approvedCaptionEnglish: "approved_caption_english",
  approvedCaptionChinese: "approved_caption_chinese",
  videoGenTaskId: "video_gen_task_id",
  videoGenTaskIds: "video_gen_task_ids",
  sceneVideoAssetIds: "scene_video_asset_ids",
  videoGenStatus: "video_gen_status",
  videoGenLastPolledAt: "video_gen_last_polled_at",
  ttsTaskId: "tts_task_id",
  baseVideoAssetId: "base_video_asset_id",
  rvcVoiceModel: "eleven_labs_voice_id",
  voiceRecordingAssetId: "voice_recording_asset_id",
  processedVoiceAssetId: "processed_voice_asset_id",
  selectedMusicTrack: "selected_music_track",
  voiceDurationSeconds: "voice_duration_seconds",
  voiceTimestamps: "voice_timestamps",
  "finalExport_9_16_assetId": "final_export_9_16_asset_id",
  "finalExport_16_9_assetId": "final_export_16_9_asset_id",
  "finalExport_1_1_assetId": "final_export_1_1_asset_id",
  "finalExport_4_5_assetId": "final_export_4_5_asset_id",
  "finalExport_tvent_assetId": "final_export_tvent_asset_id",
  "captionedExport_9_16_assetId": "captioned_export_9_16_asset_id",
  "captionedExport_16_9_assetId": "captioned_export_16_9_asset_id",
  "captionedExport_1_1_assetId": "captioned_export_1_1_asset_id",
  "captionedExport_4_5_assetId": "captioned_export_4_5_asset_id",
  tventVideoStatus: "tvent_video_status",
  selectedMotionTemplate: "selected_motion_template",
  publishingDrafts: "publishing_drafts",
  subtitleLanguages: "subtitle_languages",
  subtitleTimeline: "subtitle_timeline",
  animationSpec: "animation_spec",
  animatedVideoAssetId: "animated_video_asset_id",
  animatedOverlayAssetIds: "animated_overlay_asset_ids",
  contentApprovedBy: "content_approved_by",
  videoApprovedBy: "video_approved_by",
  voiceApprovedBy: "voice_approved_by",
  animationApprovedBy: "animation_approved_by",
  finalApprovedBy: "final_approved_by",
  renderState: "render_state",
  renderStep: "render_step",
  renderPayload: "render_payload",
  claimedBy: "claimed_by",
  claimedAt: "claimed_at",
  renderHeartbeatAt: "render_heartbeat_at",
};

export class PostgresVideoGenerationJobRepository
  implements IVideoGenerationJobRepository
{
  constructor(private db = pool) {}

  async findById(id: string): Promise<VideoGenerationJob | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM video_generation_jobs WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async findByRequestId(requestId: string): Promise<VideoGenerationJob | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM video_generation_jobs WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1",
      [requestId]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async create(
    input: CreateVideoGenerationJobInput
  ): Promise<VideoGenerationJob> {
    const { rows } = await this.db.query(
      `INSERT INTO video_generation_jobs (
         request_id, status, current_step, failed_at_step,
         scene_plan, script_thai, script_english, script_chinese,
         hook_thai, hook_english, caption_thai, caption_english, caption_chinese,
         approved_scene_plan, approved_script_thai, approved_script_english, approved_script_chinese,
         approved_hook_thai, approved_hook_english,
         approved_caption_thai, approved_caption_english, approved_caption_chinese,
         video_gen_task_id, tts_task_id, base_video_asset_id, eleven_labs_voice_id,
         voice_recording_asset_id, processed_voice_asset_id,
         final_export_9_16_asset_id, final_export_16_9_asset_id,
         final_export_1_1_asset_id, final_export_4_5_asset_id, final_export_tvent_asset_id,
         subtitle_languages,
         content_approved_by, video_approved_by, voice_approved_by, final_approved_by,
         subtitle_timeline, animation_spec, animated_video_asset_id,
         current_scene_index,
         storyboard, approved_storyboard, video_engine, ai_broll_enabled
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
         $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,
         $43,$44,$45,$46
       ) RETURNING *`,
      [
        input.requestId,
        input.status,
        input.currentStep,
        input.failedAtStep ?? null,
        input.scenePlan ?? null,
        input.scriptThai ?? null,
        input.scriptEnglish ?? null,
        input.scriptChinese ?? null,
        input.hookThai ?? null,
        input.hookEnglish ?? null,
        input.captionThai ?? null,
        input.captionEnglish ?? null,
        input.captionChinese ?? null,
        input.approvedScenePlan ?? null,
        input.approvedScriptThai ?? null,
        input.approvedScriptEnglish ?? null,
        input.approvedScriptChinese ?? null,
        input.approvedHookThai ?? null,
        input.approvedHookEnglish ?? null,
        input.approvedCaptionThai ?? null,
        input.approvedCaptionEnglish ?? null,
        input.approvedCaptionChinese ?? null,
        input.videoGenTaskId ?? null,
        input.ttsTaskId ?? null,
        input.baseVideoAssetId ?? null,
        input.rvcVoiceModel,
        input.voiceRecordingAssetId ?? null,
        input.processedVoiceAssetId ?? null,
        input.finalExport_9_16_assetId ?? null,
        input.finalExport_16_9_assetId ?? null,
        input.finalExport_1_1_assetId ?? null,
        input.finalExport_4_5_assetId ?? null,
        input.finalExport_tvent_assetId ?? null,
        input.subtitleLanguages ?? ["en", "zh"],
        input.contentApprovedBy ?? null,
        input.videoApprovedBy ?? null,
        input.voiceApprovedBy ?? null,
        input.finalApprovedBy ?? null,
        input.subtitleTimeline ?? null,
        input.animationSpec ?? null,
        input.animatedVideoAssetId ?? null,
        input.currentSceneIndex ?? 0,
        input.storyboard ?? null,
        input.approvedStoryboard ?? null,
        input.videoEngine ?? "montage",
        input.aiBrollEnabled ?? false,
      ]
    );
    const created = rowToJob(rows[0]);
    await this._recordStepHistory(created.id, created.requestId, created.currentStep, created.currentSceneIndex);
    return created;
  }

  async update(
    id: string,
    input: UpdateVideoGenerationJobInput
  ): Promise<VideoGenerationJob> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      const col = JOB_UPDATE_COLS[key];
      if (!col) continue;
      sets.push(`${col} = $${idx++}`);
      values.push(serializeJobValue(key, value));
    }

    if (sets.length === 0) {
      const { rows } = await this.db.query(
        "SELECT * FROM video_generation_jobs WHERE id = $1",
        [id]
      );
      if (!rows[0]) throw new Error(`VideoGenerationJob not found: ${id}`);
      return rowToJob(rows[0]);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE video_generation_jobs SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`VideoGenerationJob not found: ${id}`);
    const updated = rowToJob(rows[0]);

    // Record every step transition the service requests (any update that sets
    // currentStep), so the full pipeline history — including each per-scene
    // gate — is preserved, not just the latest current_step.
    if (input.currentStep !== undefined) {
      await this._recordStepHistory(
        updated.id,
        updated.requestId,
        updated.currentStep,
        updated.currentSceneIndex
      );
    }

    return updated;
  }

  private async _recordStepHistory(
    jobId: string,
    requestId: string,
    step: VideoGenerationStep,
    sceneIndex: number | null
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO video_generation_step_history (job_id, request_id, step, scene_index)
         VALUES ($1, $2, $3, $4)`,
        [jobId, requestId, step, sceneIndex]
      );
    } catch (err) {
      // History is an audit aid — never let a logging failure break the pipeline.
      console.error("[stepHistory] failed to record step:", err);
    }
  }

  async listStepHistory(jobId: string): Promise<VideoGenerationStepHistoryEntry[]> {
    const { rows } = await this.db.query(
      `SELECT id, job_id, request_id, step, scene_index, created_at
         FROM video_generation_step_history
        WHERE job_id = $1
        ORDER BY created_at ASC`,
      [jobId]
    );
    return rows.map((row) => ({
      id: row.id as string,
      jobId: row.job_id as string,
      requestId: row.request_id as string,
      step: row.step as VideoGenerationStep,
      sceneIndex: nullableNumber(row.scene_index),
      createdAt: new Date(row.created_at as string),
    }));
  }

  // ── Render-queue seam (Mac Mini worker offload) ─────────────────────────────

  async recordWorkerHeartbeat(workerId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO render_worker_heartbeat (worker_id, last_seen_at)
       VALUES ($1, NOW())
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = NOW()`,
      [workerId]
    );
  }

  async isRenderWorkerAlive(freshSeconds: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM render_worker_heartbeat
        WHERE last_seen_at > NOW() - ($1 || ' seconds')::interval
        LIMIT 1`,
      [String(freshSeconds)]
    );
    return rows.length > 0;
  }

  async claimNextQueuedRenderStep(
    workerId: string,
    staleClaimSeconds: number
  ): Promise<VideoGenerationJob | null> {
    // Atomic claim: pick one queued job (or a claimed one whose keep-alive has
    // gone stale — a crashed worker), skipping rows another worker has locked,
    // and mark it claimed in the same statement.
    const { rows } = await this.db.query(
      `WITH next AS (
         SELECT id FROM video_generation_jobs
          WHERE render_state = 'queued'
             OR (render_state = 'claimed'
                 AND COALESCE(render_heartbeat_at, claimed_at)
                     < NOW() - ($2 || ' seconds')::interval)
          ORDER BY claimed_at NULLS FIRST, updated_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE video_generation_jobs j
          SET render_state = 'claimed',
              claimed_by = $1,
              claimed_at = NOW(),
              render_heartbeat_at = NOW()
         FROM next
        WHERE j.id = next.id
       RETURNING j.*`,
      [workerId, String(staleClaimSeconds)]
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async touchRenderClaim(jobId: string): Promise<void> {
    await this.db.query(
      `UPDATE video_generation_jobs
          SET render_heartbeat_at = NOW()
        WHERE id = $1 AND render_state = 'claimed'`,
      [jobId]
    );
  }

  async completeRenderClaim(jobId: string, state: "done" | "failed"): Promise<void> {
    await this.db.query(
      `UPDATE video_generation_jobs
          SET render_state = $2, render_heartbeat_at = NOW()
        WHERE id = $1`,
      [jobId, state]
    );
  }
}
