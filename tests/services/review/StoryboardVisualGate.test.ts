import type { ClipRequest } from '@/domain/models/ClipRequest';
import type { VideoGenerationJob } from '@/domain/models/VideoGenerationJob';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
import { AssetType, AssetUploadStatus } from '@/domain/enums/AssetType';
import { applyApprovedStoryboardSelections, buildSceneMontageAssets, toRenderAssetSpecs } from '@/lib/ai/montagePlan';
import { buildSceneInputProps } from '@/lib/ai/montageService';
import { withLineStorage } from '@/lib/line/storageContext';

const createItem = jest.fn(async () => ({}));
const update = jest.fn(async () => ({}));
const assetId = '11111111-1111-4111-8111-111111111111';
const analysisGet = jest.fn<Promise<AssetVisualAnalysis | null>, unknown[]>();
const pending = jest.fn(async () => false);
jest.mock('@/repositories', () => ({
  createReviewService: () => ({ createItem }),
  reviewItemRepository: { findOpenByJobGate: async () => null },
  uploadedAssetRepository: { findByRequestId: async () => [{ id: assetId, assetType: AssetType.Video, uploadStatus: AssetUploadStatus.Uploaded }] },
  assetVisualAnalysisRepository: { get: (...args: unknown[]) => analysisGet(...args), pending: () => pending() },
  videoGenerationJobRepository: { update: (...args: unknown[]) => update(...args as []) },
}));
jest.mock('@/lib/line/voiceReviewPreview', () => ({ createVoiceReviewMp4: jest.fn() }));
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => { throw new Error('real Gemini prohibited'); }) }));
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
import { onLineReviewGate } from '@/services/review/lineReviewGate';

const request = { id: 'request',userId: 'shop',intakeChannel: 'line',shopReviewPreferences: { storyboard: true } } as ClipRequest;
const job = { id: 'job',requestId: 'request', currentStep: 'awaiting_content_approval',storyboard: JSON.stringify([{ sceneNumber: 1,summary: 'product',assetIndexes: [0],roughDurationHint: 1 }]) } as VideoGenerationJob;
const original = process.env;
beforeEach(() => {
  process.env = { ...original, REVIEW_SYSTEM_ENABLED: 'true',STORYBOARD_AI_PRECHECK_ENABLED: 'true',STORYBOARD_VISUAL_PRECHECK_ENABLED: 'true' };
  jest.clearAllMocks(); pending.mockResolvedValue(false); analysisGet.mockResolvedValue(null);
});
afterEach(() => { process.env = original; });
test('pending upload analysis defers gate, worker re-entry routes unfixable shots to Tho', async () => {
  pending.mockResolvedValueOnce(true); await onLineReviewGate(request,job); expect(createItem).not.toHaveBeenCalled();
  await onLineReviewGate(request,job);
  const input = (createItem.mock.calls as unknown as [Record<string, any>][])[0][0];
  expect(input.payload.audience).toBe('admin'); expect(input.signals.visualShotFlags).toContainEqual({ sceneIndex: 0,assetId,rule: 'analysis_missing',measuredValue: 0 });
  expect(update).toHaveBeenCalled();
});
test('fixed plan is persisted and shop review retained for high-confidence shots', async () => {
  analysisGet.mockResolvedValue({ assetId,version: '1',usableDuration: 20,width: 900,height: 1600,photo: false,cuts: [], frames: [{ time: 5,data: 'jpeg',detection: { box: { x: .3,y: .3,w: .4,h: .4 },confidence: .95 },centerOffset: 0,areaRatio: .16 }] });
  await onLineReviewGate(request,job);
  const input = (createItem.mock.calls as unknown as [Record<string, any>][])[0][0];
  expect(input.payload.audience).toBe('shop'); expect(input.signals.visualShotFlags).toBeUndefined();
  const fixed = JSON.parse(input.payload.storyboard);
  expect(fixed[0].roughDurationHint).toBe(4); expect(fixed[0].visualCrop).toBeDefined();
});
test('studio never reads the visual repository or creates a review', async () => {
  await onLineReviewGate({ ...request,intakeChannel: 'web' } as ClipRequest,job);
  expect(analysisGet).not.toHaveBeenCalled(); expect(createItem).not.toHaveBeenCalled();
});
test('visual flag off preserves existing text precheck path', async () => {
  process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED = 'false';
  const gemini = jest.fn(async () => ({ pass: true,score: 90,issues: [] }));
  await onLineReviewGate(request,job,{ callGeminiFn: gemini });
  expect(gemini).toHaveBeenCalledTimes(1); expect(analysisGet).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
test('approved crop/trim reaches LINE 9:16 render props; studio and other ratios retain behavior', async () => {
  const visualCrop = { x: -.1,y: .1,w: 1.2,h: .8,zoom: .8,pad: true };
  const selected = applyApprovedStoryboardSelections([], [{ sceneNumber: 1,summary: 'product',assetIndexes: [0],roughDurationHint: 4,visualStartSeconds: 2,visualCrop }]);
  const ordered = [{ index: 0,kind: 'clip',url: 'local.mp4',durationSeconds: 20 }] as never;
  const assets = buildSceneMontageAssets(selected[0],ordered,4);
  expect(assets[0].trimStartSeconds).toBe(2); expect(assets[0].trimEndSeconds).toBe(6);
  const specs = toRenderAssetSpecs(assets,ordered);
  const props = await withLineStorage(true,async () => buildSceneInputProps({ ratio: '9:16',durationSeconds: 4,assets: specs }));
  expect(props.assets[0].visualCrop).toEqual(visualCrop); expect(props.assets[0].motion).toBe('static');
  const studio = buildSceneInputProps({ ratio: '9:16',durationSeconds: 4,assets: specs });
  expect(studio.assets[0].visualCrop).toBeUndefined();
  const wide = await withLineStorage(true,async () => buildSceneInputProps({ ratio: '16:9',durationSeconds: 4,assets: specs }));
  expect(wide.assets[0].visualCrop).toBeUndefined();
});
