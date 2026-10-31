import { ClipRequest } from '@/domain/models/ClipRequest';
import { VideoGenerationJob } from '@/domain/models/VideoGenerationJob';
import { createReviewService, uploadedAssetRepository } from '@/repositories';
import { getDefaultTypeCfg } from './ReviewService';
import { createVoiceReviewMp4 } from '@/lib/line/voiceReviewPreview';
import { isReviewSystemEnabled } from '@/config/reviewSystem';

export const LINE_REVIEW_GATES = ['awaiting_content_approval', 'awaiting_voice_approval', 'awaiting_overlay_approval'] as const;
export function gateAudience(request: ClipRequest, step: string): 'shop' | 'admin' {
  return (step === LINE_REVIEW_GATES[0] && request.shopReviewPreferences?.storyboard) ||
    (step === LINE_REVIEW_GATES[1] && request.shopReviewPreferences?.voice) ? 'shop' : 'admin';
}
export async function onLineReviewGate(request: ClipRequest, job: VideoGenerationJob) {
  if (request.intakeChannel !== 'line' || !isReviewSystemEnabled() || !LINE_REVIEW_GATES.includes(job.currentStep as never)) return;
  const index = LINE_REVIEW_GATES.indexOf(job.currentStep as never);
  const typeKey = index === 0 ? 'script' : index === 1 ? 'tts' : 'video';
  const assetId = index === 1 ? job.processedVoiceAssetId : job.animatedVideoAssetId;
  let asset = assetId ? await uploadedAssetRepository.findById(assetId) : null;
  if (index === 1 && asset && asset.mimeType !== 'video/mp4') {
    const destination = 'line_reviews/' + request.id + '/' + job.id + '-voice.mp4';
    await createVoiceReviewMp4(asset.storageKey, destination);
    asset = { ...asset, storageKey: destination, mimeType: 'video/mp4' };
  }
  await createReviewService().createItem({ typeKey, shopUserId: request.userId, requestId: request.id,
    jobId: job.id, gateStep: job.currentStep, packageOrderId: request.packageOrderId ?? undefined,
    title: typeKey + ' review', payload: { script: job.approvedScriptThai ?? job.scriptThai ?? '',
      storyboard: job.approvedStoryboard ?? job.storyboard, audience: gateAudience(request, job.currentStep) },
    assetRefs: asset ? [{ asset_id: asset.id, storage_key: asset.storageKey, mime: asset.mimeType, role: index === 1 ? 'voice' : 'preview' }] : [],
    signals: {}, typeCfg: { ...getDefaultTypeCfg(typeKey), alwaysReview: true },
    idempotencyKey: 'gate:' + job.id + ':' + job.currentStep });
}

// Called after the transactional decision commits. Retries are safe because the
// underlying pipeline methods check the current gate before doing work.
export async function executeReviewDecision(itemId: string) {
  const { reviewItemRepository, videoGenerationJobRepository } = await import('@/repositories');
  const item = await reviewItemRepository.findById(itemId);
  if (!item || item.status !== 'approved' || !item.jobId) return;
  const job = await videoGenerationJobRepository.findById(item.jobId);
  if (!job || job.currentStep !== item.gateStep) return;
  const { videoGenerationService: pipeline } = await import('@/services/VideoGenerationService');
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
