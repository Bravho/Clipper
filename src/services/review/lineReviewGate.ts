import { ClipRequest } from '@/domain/models/ClipRequest';
import { VideoGenerationJob } from '@/domain/models/VideoGenerationJob';
import { createReviewService, uploadedAssetRepository, reviewItemRepository, videoGenerationJobRepository } from '@/repositories';
import { withReservedLineRevision } from '@/lib/line/revisionContext';
import { getDefaultTypeCfg } from './ReviewService';
import { createVoiceReviewMp4 } from '@/lib/line/voiceReviewPreview';
import { isReviewSystemEnabled } from '@/config/reviewSystem';
import { runStoryboardPrecheck, type GeminiPrecheckResponse, type StoryboardPrecheckOptions } from '@/services/review/StoryboardPrecheckService';
import { AssetType, AssetUploadStatus } from '@/domain/enums/AssetType';

export const LINE_REVIEW_GATES = ['awaiting_content_approval', 'awaiting_voice_approval', 'awaiting_overlay_approval'] as const;
export function gateAudience(request: ClipRequest, step: string): 'shop' | 'admin' {
  return (step === LINE_REVIEW_GATES[0] && request.shopReviewPreferences?.storyboard) ||
    (step === LINE_REVIEW_GATES[1] && request.shopReviewPreferences?.voice) ? 'shop' : 'admin';
}
export interface LineReviewGateOpts {
  /** Override Gemini scoring for tests (precheck only). */
  callGeminiFn?: (prompt: string, cfg: { model: string; maxOutputTokens: number }) => Promise<GeminiPrecheckResponse>;
  /** Override storyboard regeneration for tests (precheck only). */
  regenerateFn?: () => Promise<{ storyboard: string | null; scriptThai: string | null } | null>;
}

export async function onLineReviewGate(request: ClipRequest, job: VideoGenerationJob, opts: LineReviewGateOpts = {}) {
  if (request.intakeChannel !== 'line' || !isReviewSystemEnabled() || !LINE_REVIEW_GATES.includes(job.currentStep as never)) return;
  const index = LINE_REVIEW_GATES.indexOf(job.currentStep as never);
  const typeKey = index === 0 ? 'script' : index === 1 ? 'tts' : 'video';
  // For the video gate the composition step CLEARS animatedVideoAssetId and
  // writes the finished overlay into a captioned_export_* field. Use the first
  // non-null captioned export so the review has the correct finished video.
  const videoAssetId = job.captionedExport_9_16_assetId
    ?? job.captionedExport_16_9_assetId
    ?? job.captionedExport_1_1_assetId
    ?? job.captionedExport_4_5_assetId
    ?? null;
  const assetId = index === 1 ? job.processedVoiceAssetId : index === 2 ? videoAssetId : null;
  let asset = assetId ? await uploadedAssetRepository.findById(assetId) : null;
  const existing = await reviewItemRepository.findOpenByJobGate(job.id, job.currentStep);
  if (existing && existing.assetRefs[0]?.asset_id === asset?.id) return;
  if (existing) await reviewItemRepository.update(existing.id, { status: 'expired', resolution: 'superseded' });
  if (index === 1 && asset && asset.mimeType !== 'video/mp4') {
    const destination = 'line_reviews/' + request.id + '/' + asset.id + '-voice.mp4';
    await createVoiceReviewMp4(asset.storageKey, destination);
    asset = { ...asset, storageKey: destination, mimeType: 'video/mp4' };
  }

  // --- Storyboard AI pre-review (script gate only, LINE jobs, behind flag) ---
  let precheckSignals: Record<string, unknown> = {};
  if (typeKey === 'script') {
    try {
      const assets = await uploadedAssetRepository.findByRequestId(request.id);
      const imageAssets = assets.filter(
        (a) => (a.assetType === AssetType.Image || a.assetType === AssetType.Video) &&
          a.uploadStatus === AssetUploadStatus.Uploaded,
      );

      const precheckOpts: StoryboardPrecheckOptions = {
        callGeminiFn: opts.callGeminiFn,
        regenerateFn: opts.regenerateFn ?? (async () => {
          // Default regeneration: re-run content analysis via chatGptVisionService
          const { generateSpeakingScript } = await import('@/lib/ai/chatGptVisionService');
          const imageUrls = imageAssets.map((a) => a.storageUrl).filter(Boolean);
          const output = await generateSpeakingScript({
            imageUrls,
            description: request.description ?? '',
            targetAudience: request.targetAudience ?? '',
            targetPlatforms: request.targetPlatforms ?? [],
            preferredStyle: request.preferredStyle ?? '',
            videoDurationSeconds: 90,
          });
          const newStoryboard = output.storyboard ? JSON.stringify(output.storyboard) : null;
          // Persist regenerated storyboard directly (bypass _updateJob to avoid loop)
          if (newStoryboard) {
            await videoGenerationJobRepository.update(job.id, { storyboard: newStoryboard, scriptThai: output.scriptThai });
          }
          return { storyboard: newStoryboard, scriptThai: output.scriptThai };
        }),
      };

      const precheck = await runStoryboardPrecheck(job, request.shopRules ?? {}, imageAssets, precheckOpts);
      if (!precheck.pass && precheck.issues.length > 0) {
        precheckSignals = { precheckIssues: precheck.issues };
      }
    } catch (err) {
      console.error('[onLineReviewGate] precheck error (non-fatal):', err);
      precheckSignals = { precheckIssues: ['precheck_error'] };
    }
  }
  // ---------------------------------------------------------------------------

  await createReviewService().createItem({ typeKey, shopUserId: request.userId, requestId: request.id,
    jobId: job.id, gateStep: job.currentStep, packageOrderId: request.packageOrderId ?? undefined,
    title: typeKey + ' review', payload: { script: job.approvedScriptThai ?? job.scriptThai ?? '',
      storyboard: job.approvedStoryboard ?? job.storyboard, audience: gateAudience(request, job.currentStep) },
    assetRefs: asset ? [{ asset_id: asset.id, storage_key: asset.storageKey, mime: asset.mimeType, role: index === 1 ? 'voice' : 'preview' }] : [],
    signals: precheckSignals, typeCfg: { ...getDefaultTypeCfg(typeKey), alwaysReview: true },
    idempotencyKey: 'gate:' + job.id + ':' + job.currentStep + ':' + (asset?.id ?? request.revisionCount ?? 0) });
}

// Called after the transactional decision commits. Retries are safe because the
// underlying pipeline methods check the current gate before doing work.
export async function executeReviewDecision(itemId: string) {
  const { reviewItemRepository, videoGenerationJobRepository } = await import('@/repositories');
  const item = await reviewItemRepository.findById(itemId);
  if (!item || !item.jobId) return;
  const job = await videoGenerationJobRepository.findById(item.jobId);
  if (!job || job.currentStep !== item.gateStep) return;
  const { videoGenerationService: pipeline } = await import('@/services/VideoGenerationService');
  if (item.status === 'rejected' || (item.status === 'edited' && item.renderState === 'queued')) {
    await withReservedLineRevision(async () => {
      if (item.typeKey === 'tts') await pipeline.regenerateVoice(job.id, item.shopUserId, undefined, String(item.payload.script ?? ''));
      else if (item.typeKey === 'video') await pipeline.regenerateOverlayByRequester(job.id, item.shopUserId);
      else {
        const { clipRequestRepository } = await import('@/repositories');
        const request = await clipRequestRepository.findById(job.requestId);
        if (request) await onLineReviewGate(request, job);
      }
    });
    return;
  }
  if (item.status !== 'approved') return;
  if (item.gateStep === LINE_REVIEW_GATES[0]) {
    await pipeline.approveContent(job.id, item.shopUserId, {
      scenePlan: job.scenePlan, scriptThai: String(item.payload.script ?? job.scriptThai ?? ''),
      scriptEnglish: job.scriptEnglish ?? '', hookThai: job.hookThai, hookEnglish: job.hookEnglish ?? '',
      captionThai: job.captionThai ?? '', captionEnglish: job.captionEnglish ?? '', captionChinese: job.captionChinese ?? '',
      storyboard: typeof item.payload.storyboard === 'string' ? item.payload.storyboard : job.storyboard });
  } else if (item.gateStep === LINE_REVIEW_GATES[1]) {
    await pipeline.approveVoiceConversionByRequester(job.id, item.shopUserId);
  } else if (item.gateStep === LINE_REVIEW_GATES[2]) {
    await pipeline.approveOverlayByRequester(job.id, item.shopUserId);
  }
}
