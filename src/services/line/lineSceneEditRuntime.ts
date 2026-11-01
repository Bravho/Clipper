import { storyboardVersionRepository, clipRequestRepository, videoGenerationJobRepository, uploadedAssetRepository,
 createReviewService, lineAccountRepository } from '@/repositories';
import { hasActiveTakeover } from './lineTakeover';
import { getDefaultTypeCfg } from '@/services/review/ReviewService';
import { LineSceneEditService, parseSceneEdit, sceneEditEnabled, applySceneEdit, type PendingSceneEdit } from './LineSceneEditService';
import type { VersionScene } from '@/domain/models/StoryboardVersion';
import type { ClipRequest } from '@/domain/models/ClipRequest';
import type { VideoGenerationJob, StoryboardScene, ScenePlan } from '@/domain/models/VideoGenerationJob';
import { orderSourceAssets } from '@/lib/sourceAssets';
import { runStoryboardPrecheck, deterministicCheck } from '@/services/review/StoryboardPrecheckService';
import { visualEnabled, visualConfig } from '@/config/storyboardVisual';
import { runVisualPrecheck } from '@/services/review/StoryboardVisualPrecheck';

export async function snapshotApprovedStoryboard(request: ClipRequest, job: VideoGenerationJob) {
 if (!sceneEditEnabled() || request.intakeChannel !== 'line') return null;
 const sources = orderSourceAssets(await uploadedAssetRepository.findByRequestId(request.id));
 const storyboard = JSON.parse(job.approvedStoryboard ?? job.storyboard ?? '[]') as StoryboardScene[];
 const plans = JSON.parse(job.approvedScenePlan ?? '[]') as ScenePlan[];
 const cues = JSON.parse(job.subtitleTimeline ?? job.voiceTimestamps ?? '[]') as Array<{ startSecond: number; textThai: string }>;
 let cursor = 0;
 const count = plans.length || storyboard.length;
 const scenes: VersionScene[] = Array.from({ length: count }, (_, i) => {
  const plan = plans[i];
  const s = storyboard[i] ?? { sceneNumber: plan.sceneNumber, summary: plan.visualDescriptionThai, assetIndexes: plan.imageIndexes };
  const duration = plan?.durationSeconds ?? s.roughDurationHint ?? 5;
  const words = cues.filter(c => c.startSecond >= cursor && c.startSecond < cursor + duration).map(c => c.textThai).filter(Boolean).join(' ');
  cursor += duration;
  const indexes = plan?.assets?.map(a => a.assetIndex) ?? s.assetIndexes;
  return { ...s, sceneNumber: plan?.sceneNumber ?? s.sceneNumber, assetIndexes: indexes,
   assetIds: indexes.map(n => sources[n]?.id).filter(Boolean), roughDurationHint: duration,
   onScreenText: words || s.scriptLine || s.summary,
   voiceScript: s.scriptLine ?? (words || (i === 0 && !cues.length ? job.approvedScriptThai ?? job.scriptThai ?? '' : '')),
   visualCrop: s.visualCrop ?? (plan?.assets?.length === 1 ? plan.assets[0].visualCrop : undefined), renderPlan: plan };
 });
 if (!scenes.length || scenes.some(s => !s.assetIds.length)) throw new Error('storyboard_assets_missing');
 const latest = await storyboardVersionRepository.latest(request.id);
 if (latest && JSON.stringify(latest.scenes) === JSON.stringify(scenes)) return latest;
 return storyboardVersionRepository.append({ requestId: request.id, parentVersionId: latest?.id ?? null, scenes,
  createdBy: job.contentApprovedBy === request.userId ? 'shop' : job.contentApprovedBy ? 'admin' : 'system', reason: 'approved_storyboard', isTest: Boolean(request.isTest) });
}

export async function handleSceneEditMessage(channel: string, lineUserId: string, text: string) {
 if (!sceneEditEnabled()) return null;
 const account = await lineAccountRepository.findByLineUser(channel, lineUserId);
 if (!account || await hasActiveTakeover(lineAccountRepository, [account])) return null;
 const conv = await lineAccountRepository.getConversationState(channel, lineUserId);
 const context = conv?.context ?? {};
 if (typeof context.requestId !== 'string') return null;
 const request = await clipRequestRepository.findById(context.requestId);
 if (!request || request.userId !== account.userId || request.intakeChannel !== 'line' || Boolean(request.isTest) !== Boolean(account.isTest)) return null;
 const job = await videoGenerationJobRepository.findByRequestId(request.id);
 if (!job || !['complete', 'awaiting_distribution_review'].includes(job.currentStep)) return null;
 const base = await storyboardVersionRepository.latest(request.id);
 if (!base) return null;
 const assets = orderSourceAssets(await uploadedAssetRepository.findByRequestId(request.id));
 const service = new LineSceneEditService({ versions: storyboardVersionRepository, parse: parseSceneEdit,
  savePending: async pending => { await lineAccountRepository.upsertConversationState(channel, lineUserId, conv?.state ?? 'in_progress', { ...context, pendingSceneEdit: pending }); },
  dispatch: async () => {}, // append atomically writes storyboard.render to the durable outbox.
  escalate: async (reason, pending) => {
   await createReviewService().createItem({ typeKey: 'customer_reply', shopUserId: request.userId, requestId: request.id,
    title: 'LINE scene edit review', payload: { audience: 'admin', sceneEditProposal: pending, reason, text: pending?.message ?? text }, signals: { wants_human: true },
    idempotencyKey: 'scene-edit:' + base.id + ':' + reason + ':' + JSON.stringify(pending?.edit ?? {}),
    typeCfg: { ...getDefaultTypeCfg('customer_reply'), alwaysReview: true } });
  } });
 if (!/แก้|เปลี่ยน|ปรับ|ฉาก|ข้อความ|บทพูด|เรียง|สลับ|เมนู|โปรโม|edit|scene/i.test(text) &&
     !(context.pendingSceneEdit && /^(ยืนยันแก้ไข|ยืนยัน|confirm|ยกเลิก|cancel)$/i.test(text.trim()))) return null;
 return service.handle({ base, message: text, assets: assets.map(a => a.id), rules: request.shopRules ?? {}, pending: context.pendingSceneEdit as PendingSceneEdit | undefined });
}

export async function dispatchStoryboardVersion(id: string, adminApproved = false) {
 if (!sceneEditEnabled()) throw new Error('scene_edit_disabled');
 const v = await storyboardVersionRepository.get(id);
 if (!v) throw new Error('version_missing');
 const request = await clipRequestRepository.findById(v.requestId);
 const job = await videoGenerationJobRepository.findByRequestId(v.requestId);
 if (!request || !job || request.intakeChannel !== 'line') throw new Error('request_missing');
 const accounts = await lineAccountRepository.findByUserId(request.userId);
 if (await hasActiveTakeover(lineAccountRepository, accounts)) throw new Error('takeover');
 if (v.dispatchedAt) return;
 const latest = await storyboardVersionRepository.latest(v.requestId);
 if (latest?.id !== v.id) return; // Superseded outbox entries cannot undo a newer restore/edit.
 if (!['complete','awaiting_distribution_review'].includes(job.currentStep) &&
     !(job.storyboardVersionId === v.id)) throw new Error('render_in_progress');
 const assets = await uploadedAssetRepository.findByRequestId(v.requestId);
 const sources = orderSourceAssets(assets);
 const scenes = v.scenes.map(s => ({ ...s, assetIndexes: s.assetIds.map(id => {
  const i = sources.findIndex(a => a.id === id); if (i < 0) throw new Error('unknown_asset'); return i;
 }), scriptLine: s.voiceScript, summary: s.onScreenText }));
 const candidate = { ...job, approvedStoryboard: null, storyboard: JSON.stringify(scenes), approvedScriptThai: null, scriptThai: scenes.map(s => s.voiceScript).join('\n') };
 const check = visualEnabled() ? deterministicCheck(candidate, assets, request.shopRules ?? {}) : await runStoryboardPrecheck(candidate, request.shopRules ?? {}, assets);
 const issues = [...check.issues];
 if (!check.pass && !issues.length) issues.push('precheck_failed');
 if (visualEnabled()) {
  const { assetVisualAnalysisRepository } = await import('@/repositories');
  const cached = await Promise.all(sources.map(a => assetVisualAnalysisRepository.get(a.id, visualConfig().version)));
  const result = await runVisualPrecheck(scenes, sources.map(a => a.id), new Map(cached.flatMap(a => a ? [[a.assetId, a] as const] : [])));
  issues.push(...result.flags.map(f => f.rule));
  if (JSON.stringify(result.scenes) !== JSON.stringify(scenes)) issues.push('visual_correction_requires_review');
 }
 if (issues.length && !adminApproved) {
  await createReviewService().createItem({ typeKey: 'script', shopUserId: request.userId, requestId: request.id,
   title: 'Scene edit precheck', payload: { audience: 'admin', sceneEditVersionId: v.id, storyboard: candidate.storyboard, script: candidate.scriptThai },
   signals: { precheckIssues: issues }, typeCfg: { ...getDefaultTypeCfg('script'), alwaysReview: true }, idempotencyKey: 'scene-precheck:' + v.id });
  return;
 }
 const { videoGenerationService } = await import('@/services/VideoGenerationService');
 await videoGenerationService.restartFromStoryboardVersion(v, scenes, sources);
}

export async function approveSceneEditProposal(item: { id?: string; requestId: string | null; payload: Record<string, unknown> }) {
 const p = item.payload.sceneEditProposal as PendingSceneEdit | undefined;
 if (!p || !item.requestId) return;
 const base = await storyboardVersionRepository.latest(item.requestId);
 const reason = 'line_scene_edit_review:' + (item.id ?? p.baseId);
 if (base?.reason === reason) return base;
 if (!base || base.id !== p.baseId) throw new Error('version_conflict');
 const request = await clipRequestRepository.findById(base.requestId);
 const accounts = request ? await lineAccountRepository.findByUserId(request.userId) : [];
 if (await hasActiveTakeover(lineAccountRepository, accounts)) throw new Error('takeover');
 const sources = orderSourceAssets(await uploadedAssetRepository.findByRequestId(base.requestId));
 return storyboardVersionRepository.append({ requestId: base.requestId, parentVersionId: base.id,
  scenes: applySceneEdit(base, p.edit, sources.map(s => s.id)), createdBy: 'admin', reason, isTest: base.isTest }, true);
}
