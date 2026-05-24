import { IVideoGenerationJobRepository } from "@/repositories/interfaces/IVideoGenerationJobRepository";
import {
  VideoGenerationJob,
  CreateVideoGenerationJobInput,
  UpdateVideoGenerationJobInput,
} from "@/domain/models/VideoGenerationJob";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { pool } from "@/lib/db";

function rowToJob(row: Record<string, unknown>): VideoGenerationJob {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    status: row.status as VideoGenerationJobStatus,
    currentStep: row.current_step as VideoGenerationStep,
    failedAtStep: (row.failed_at_step as VideoGenerationStep) ?? null,
    scenePlan: (row.scene_plan as string) ?? null,
    scriptThai: (row.script_thai as string) ?? null,
    scriptEnglish: (row.script_english as string) ?? null,
    hookThai: (row.hook_thai as string) ?? null,
    hookEnglish: (row.hook_english as string) ?? null,
    captionThai: (row.caption_thai as string) ?? null,
    captionEnglish: (row.caption_english as string) ?? null,
    captionChinese: (row.caption_chinese as string) ?? null,
    approvedScenePlan: (row.approved_scene_plan as string) ?? null,
    approvedScriptThai: (row.approved_script_thai as string) ?? null,
    approvedScriptEnglish: (row.approved_script_english as string) ?? null,
    approvedHookThai: (row.approved_hook_thai as string) ?? null,
    approvedHookEnglish: (row.approved_hook_english as string) ?? null,
    approvedCaptionThai: (row.approved_caption_thai as string) ?? null,
    approvedCaptionEnglish: (row.approved_caption_english as string) ?? null,
    approvedCaptionChinese: (row.approved_caption_chinese as string) ?? null,
    klingTaskId: (row.kling_task_id as string) ?? null,
    baseVideoAssetId: (row.base_video_asset_id as string) ?? null,
    rvcVoiceModel: row.eleven_labs_voice_id as string,
    voiceRecordingAssetId: (row.voice_recording_asset_id as string) ?? null,
    processedVoiceAssetId: (row.processed_voice_asset_id as string) ?? null,
    finalExport_9_16_assetId: (row.final_export_9_16_asset_id as string) ?? null,
    finalExport_16_9_assetId: (row.final_export_16_9_asset_id as string) ?? null,
    finalExport_1_1_assetId: (row.final_export_1_1_asset_id as string) ?? null,
    finalExport_4_5_assetId: (row.final_export_4_5_asset_id as string) ?? null,
    contentApprovedBy: (row.content_approved_by as string) ?? null,
    videoApprovedBy: (row.video_approved_by as string) ?? null,
    voiceApprovedBy: (row.voice_approved_by as string) ?? null,
    finalApprovedBy: (row.final_approved_by as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

const JOB_UPDATE_COLS: Record<string, string> = {
  status: "status",
  currentStep: "current_step",
  failedAtStep: "failed_at_step",
  scenePlan: "scene_plan",
  scriptThai: "script_thai",
  scriptEnglish: "script_english",
  hookThai: "hook_thai",
  hookEnglish: "hook_english",
  captionThai: "caption_thai",
  captionEnglish: "caption_english",
  captionChinese: "caption_chinese",
  approvedScenePlan: "approved_scene_plan",
  approvedScriptThai: "approved_script_thai",
  approvedScriptEnglish: "approved_script_english",
  approvedHookThai: "approved_hook_thai",
  approvedHookEnglish: "approved_hook_english",
  approvedCaptionThai: "approved_caption_thai",
  approvedCaptionEnglish: "approved_caption_english",
  approvedCaptionChinese: "approved_caption_chinese",
  klingTaskId: "kling_task_id",
  baseVideoAssetId: "base_video_asset_id",
  rvcVoiceModel: "eleven_labs_voice_id",
  voiceRecordingAssetId: "voice_recording_asset_id",
  processedVoiceAssetId: "processed_voice_asset_id",
  "finalExport_9_16_assetId": "final_export_9_16_asset_id",
  "finalExport_16_9_assetId": "final_export_16_9_asset_id",
  "finalExport_1_1_assetId": "final_export_1_1_asset_id",
  "finalExport_4_5_assetId": "final_export_4_5_asset_id",
  contentApprovedBy: "content_approved_by",
  videoApprovedBy: "video_approved_by",
  voiceApprovedBy: "voice_approved_by",
  finalApprovedBy: "final_approved_by",
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
         scene_plan, script_thai, script_english,
         hook_thai, hook_english, caption_thai, caption_english, caption_chinese,
         approved_scene_plan, approved_script_thai, approved_script_english,
         approved_hook_thai, approved_hook_english,
         approved_caption_thai, approved_caption_english, approved_caption_chinese,
         kling_task_id, base_video_asset_id, eleven_labs_voice_id,
         voice_recording_asset_id, processed_voice_asset_id,
         final_export_9_16_asset_id, final_export_16_9_asset_id,
         final_export_1_1_asset_id, final_export_4_5_asset_id,
         content_approved_by, video_approved_by, voice_approved_by, final_approved_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
         $31,$32,$33
       ) RETURNING *`,
      [
        input.requestId,
        input.status,
        input.currentStep,
        input.failedAtStep ?? null,
        input.scenePlan ?? null,
        input.scriptThai ?? null,
        input.scriptEnglish ?? null,
        input.hookThai ?? null,
        input.hookEnglish ?? null,
        input.captionThai ?? null,
        input.captionEnglish ?? null,
        input.captionChinese ?? null,
        input.approvedScenePlan ?? null,
        input.approvedScriptThai ?? null,
        input.approvedScriptEnglish ?? null,
        input.approvedHookThai ?? null,
        input.approvedHookEnglish ?? null,
        input.approvedCaptionThai ?? null,
        input.approvedCaptionEnglish ?? null,
        input.approvedCaptionChinese ?? null,
        input.klingTaskId ?? null,
        input.baseVideoAssetId ?? null,
        input.rvcVoiceModel,
        input.voiceRecordingAssetId ?? null,
        input.processedVoiceAssetId ?? null,
        input.finalExport_9_16_assetId ?? null,
        input.finalExport_16_9_assetId ?? null,
        input.finalExport_1_1_assetId ?? null,
        input.finalExport_4_5_assetId ?? null,
        input.contentApprovedBy ?? null,
        input.videoApprovedBy ?? null,
        input.voiceApprovedBy ?? null,
        input.finalApprovedBy ?? null,
      ]
    );
    return rowToJob(rows[0]);
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
      values.push(value);
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
    return rowToJob(rows[0]);
  }
}
