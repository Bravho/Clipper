jest.mock('@/repositories', () => ({
 storyboardVersionRepository: { get: jest.fn(), latest: jest.fn(), append: jest.fn() },
 clipRequestRepository: { findById: jest.fn() }, videoGenerationJobRepository: { findByRequestId: jest.fn() },
 uploadedAssetRepository: { findByRequestId: jest.fn() }, lineAccountRepository: { findByLineUser: jest.fn(), findByUserId: jest.fn(), getConversationState: jest.fn(), upsertConversationState: jest.fn() },
 createReviewService: jest.fn(),
 assetVisualAnalysisRepository: { get: jest.fn() },
}));
jest.mock('@/services/VideoGenerationService', () => ({ videoGenerationService: { restartFromStoryboardVersion: jest.fn() } }));
jest.mock('@/services/review/StoryboardPrecheckService', () => ({ runStoryboardPrecheck: jest.fn(), deterministicCheck: jest.fn(() => ({ pass: true, issues: [] })) }));
jest.mock('@/services/review/StoryboardVisualPrecheck', () => ({ runVisualPrecheck: jest.fn() }));
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => { throw new Error('Real Gemini prohibited'); }) }));
import { dispatchStoryboardVersion, handleSceneEditMessage, snapshotApprovedStoryboard, approveSceneEditProposal } from '@/services/line/lineSceneEditRuntime';
import * as repos from '@/repositories';
import { videoGenerationService } from '@/services/VideoGenerationService';
import { runStoryboardPrecheck } from '@/services/review/StoryboardPrecheckService';
import { runVisualPrecheck } from '@/services/review/StoryboardVisualPrecheck';
import type { StoryboardVersion } from '@/domain/models/StoryboardVersion';
import type { ClipRequest } from '@/domain/models/ClipRequest';
import type { VideoGenerationJob } from '@/domain/models/VideoGenerationJob';
const id = '00000000-0000-4000-8000-000000000001';
const version: StoryboardVersion = { id: 'v2', requestId: 'r1', parentVersionId: 'v1', createdBy: 'shop', reason: 'line_scene_edit', createdAt: new Date().toISOString(), isTest: true,
 scenes: [{ sceneNumber: 1, summary: 'อาหาร', assetIndexes: [0], assetIds: [id], roughDurationHint: 6, onScreenText: 'ลองเลย', voiceScript: 'ลองชิมอาหารสดใหม่' }] };
const request = { id: 'r1', userId: 'u1', intakeChannel: 'line', isTest: true, shopRules: {} } as ClipRequest;
const job = { id: 'j1', requestId: 'r1', currentStep: 'complete' } as VideoGenerationJob;
const item = jest.fn();
beforeEach(() => {
 jest.clearAllMocks(); process.env.LINE_SCENE_EDIT_ENABLED = 'true'; delete process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED;
 (repos.storyboardVersionRepository.get as jest.Mock).mockResolvedValue(version);
 (repos.storyboardVersionRepository.latest as jest.Mock).mockResolvedValue(version);
 (repos.clipRequestRepository.findById as jest.Mock).mockResolvedValue(request);
 (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockResolvedValue(job);
 (repos.lineAccountRepository.findByUserId as jest.Mock).mockResolvedValue([]);
 (repos.uploadedAssetRepository.findByRequestId as jest.Mock).mockResolvedValue([{ id, requestId: 'r1', assetType: 'image', uploadStatus: 'uploaded', storageUrl: 'private.jpg', createdAt: new Date() }]);
 (runStoryboardPrecheck as jest.Mock).mockResolvedValue({ pass: true, issues: [] });
 (repos.createReviewService as jest.Mock).mockReturnValue({ createItem: item });
});
afterEach(() => { delete process.env.LINE_SCENE_EDIT_ENABLED; delete process.env.STORYBOARD_AI_PRECHECK_ENABLED; delete process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED; });
test('durable dispatch prechecks then renders full version with stable asset indices', async () => {
 await dispatchStoryboardVersion('v2');
 expect(runStoryboardPrecheck).toHaveBeenCalledWith(expect.objectContaining({ storyboard: expect.stringContaining('ลองเลย') }), {}, expect.any(Array));
 expect(videoGenerationService.restartFromStoryboardVersion).toHaveBeenCalledWith(version, expect.arrayContaining([expect.objectContaining({ assetIndexes: [0], voiceScript: 'ลองชิมอาหารสดใหม่' })]), expect.any(Array));
});
test('failed precheck queues admin decision; approval resumes without another revision', async () => {
 (runStoryboardPrecheck as jest.Mock).mockResolvedValue({ pass: false, issues: ['menu_mismatch'] });
 await dispatchStoryboardVersion('v2');
 expect(item).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ audience: 'admin', sceneEditVersionId: 'v2' }) }));
 expect(videoGenerationService.restartFromStoryboardVersion).not.toHaveBeenCalled();
 await dispatchStoryboardVersion('v2', true);
 expect(videoGenerationService.restartFromStoryboardVersion).toHaveBeenCalledTimes(1);
 expect(repos.storyboardVersionRepository.append).not.toHaveBeenCalled();
});
test('takeover defers durable render without prechecking', async () => {
 (repos.lineAccountRepository.findByUserId as jest.Mock).mockResolvedValue([{ takeoverActive: true }]);
 await expect(dispatchStoryboardVersion('v2')).rejects.toThrow('takeover'); expect(runStoryboardPrecheck).not.toHaveBeenCalled();
});
test('enabled visual precheck replaces text scoring and routes flags to admin', async () => {
 process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'true'; process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED = 'true';
 (repos.assetVisualAnalysisRepository.get as jest.Mock).mockResolvedValue(null);
 (runVisualPrecheck as jest.Mock).mockResolvedValue({ scenes: version.scenes, flags: [{ rule: 'missing_analysis' }] });
 await dispatchStoryboardVersion('v2');
 expect(runVisualPrecheck).toHaveBeenCalled(); expect(runStoryboardPrecheck).not.toHaveBeenCalled();
 expect(item).toHaveBeenCalledWith(expect.objectContaining({ signals: expect.objectContaining({ precheckIssues: expect.arrayContaining(['missing_analysis']) }) }));
 expect(videoGenerationService.restartFromStoryboardVersion).not.toHaveBeenCalled();
});
test('superseded queued versions cannot overwrite a newer edit/restore', async () => {
 (repos.storyboardVersionRepository.latest as jest.Mock).mockResolvedValue({ ...version, id: 'v3' });
 await dispatchStoryboardVersion('v2'); expect(runStoryboardPrecheck).not.toHaveBeenCalled();
});
test('completed dispatch retry does not render again', async () => {
 (repos.storyboardVersionRepository.get as jest.Mock).mockResolvedValue({ ...version, dispatchedAt: new Date().toISOString() });
 (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockResolvedValue({ ...job, storyboardVersionId: 'v2' });
 await dispatchStoryboardVersion('v2'); expect(videoGenerationService.restartFromStoryboardVersion).not.toHaveBeenCalled();
});
test('flag off never reads storage or handles edits', async () => {
 delete process.env.LINE_SCENE_EDIT_ENABLED; expect(await handleSceneEditMessage('channel','line','แก้ฉาก 1')).toBeNull();
 expect(repos.lineAccountRepository.findByLineUser).not.toHaveBeenCalled();
});
test('approved snapshot resolves assets/timing and records creator/test scope', async () => {
 (repos.storyboardVersionRepository.latest as jest.Mock).mockResolvedValue(null);
 await snapshotApprovedStoryboard(request, { ...job, contentApprovedBy: 'u1', approvedStoryboard: JSON.stringify(version.scenes), approvedScenePlan: JSON.stringify([{ durationSeconds: 7, assets: [{ assetIndex: 0 }] }]) });
 expect(repos.storyboardVersionRepository.append).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'shop', isTest: true, scenes: expect.arrayContaining([expect.objectContaining({ assetIds: [id], roughDurationHint: 7 })]) }));
});
test('admin-approved factual proposal uses same atomic revision path', async () => {
 await approveSceneEditProposal({ requestId: 'r1', payload: { sceneEditProposal: { baseId: 'v2', message: 'แก้ราคา', edit: { ops: [{ type: 'text', scene: 1, field: 'onScreenText', newText: 'ราคา 99 บาท' }] } } } });
 expect(repos.storyboardVersionRepository.append).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'admin', parentVersionId: 'v2', scenes: expect.arrayContaining([expect.objectContaining({ onScreenText: 'ราคา 99 บาท' })]) }), true);
});

test('crash after generating_voice but before durable enqueue retries dispatch', async () => {
 (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockResolvedValue({ ...job, storyboardVersionId: 'v2', currentStep: 'generating_voice' });
 await dispatchStoryboardVersion('v2');
 expect(videoGenerationService.restartFromStoryboardVersion).toHaveBeenCalledTimes(1);
});

test('durable task marker prevents duplicate dispatch even at approval step', async () => {
 (repos.storyboardVersionRepository.get as jest.Mock).mockResolvedValue({ ...version, dispatchedAt: new Date().toISOString() });
 (repos.videoGenerationJobRepository.findByRequestId as jest.Mock).mockResolvedValue({ ...job, storyboardVersionId: 'v2', currentStep: 'awaiting_content_approval' });
 await dispatchStoryboardVersion('v2');
 expect(videoGenerationService.restartFromStoryboardVersion).not.toHaveBeenCalled();
});
