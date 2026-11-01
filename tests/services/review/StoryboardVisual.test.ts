import { checkVisualRules, runVisualPrecheck, visualTokenEstimate } from '@/services/review/StoryboardVisualPrecheck';
import { analyseVisualMedia, cropMetrics, parseSceneCuts, visualContactSheet } from '@/lib/ai/storyboardVisualMedia';
import { MockProductDetector, NoopProductDetector } from '@/lib/ai/ProductDetector';
import { processAssetVisualAnalysis } from '@/services/review/AssetVisualAnalysisWorker';
import { MockAssetVisualAnalysisRepository } from '@/repositories/mock/MockAssetVisualAnalysisRepository';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
import type { StoryboardScene } from '@/domain/models/VideoGenerationJob';
import type { IUploadedAssetRepository } from '@/repositories/interfaces/IUploadedAssetRepository';
import { notifyGrokBot } from '@/services/review/GrokBotNotifier';
import type { ReviewItem } from '@/domain/models/ReviewItem';

jest.mock('@/lib/ai/ffmpegService', () => ({ probeMediaSummary: jest.fn() }));
jest.mock('@/lib/spaces', () => ({ spacesSignedUrl: jest.fn() }));
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => { throw new Error('Real Gemini prohibited'); }) }));
const assetId = '11111111-1111-4111-8111-111111111111';
const scene = (changes: Partial<StoryboardScene> = {}): StoryboardScene => ({ sceneNumber: 1, summary: 'product', assetIndexes: [0], roughDurationHint: 4, ...changes });
const analysis = (changes: Partial<AssetVisualAnalysis> = {}): AssetVisualAnalysis => ({ assetId, version: '1', usableDuration: 20, width: 900, height: 1600, cuts: [], photo: false,
  frames: [{ data: Buffer.from('jpeg').toString('base64'), time: 5, detection: { box: { x: .3,y: .3,w: .4,h: .4 }, confidence: .95 }, centerOffset: 0, areaRatio: .16 }], ...changes });
const map = (a = analysis()) => new Map([[a.assetId,a]]);
const enabled = { STORYBOARD_AI_PRECHECK_ENABLED: 'true', STORYBOARD_VISUAL_PRECHECK_ENABLED: 'true' };
const original = process.env;
beforeEach(() => { process.env = { ...original, ...enabled }; });
afterEach(() => { process.env = original; });

test.each(['STORYBOARD_AI_PRECHECK_ENABLED','STORYBOARD_VISUAL_PRECHECK_ENABLED'])('%s off is an unchanged no-op', async flag => {
  process.env[flag] = 'false'; const scenes = [scene({ roughDurationHint: 1 })]; const gemini = jest.fn();
  expect(await runVisualPrecheck(scenes,[assetId],map(),{ gemini })).toEqual({ scenes, flags: [] });
  expect(gemini).not.toHaveBeenCalled();
});
test.each([
  ['min_shot',scene({ roughDurationHint: 1 })], ['hero_hold',scene({ heroShot: true, roughDurationHint: 3 })],
  ['first_hold',scene({ roughDurationHint: 1 })], ['last_hold',scene({ roughDurationHint: 1 })],
  ['ambiguous_assets',scene({ assetIndexes: [0,0] })], ['usable_duration',scene({ roughDurationHint: 21 })],
] as const)('checks %s', (rule,s) => expect(checkVisualRules([s],[assetId],map()).map(f => f.rule)).toContain(rule));
test('checks cut spacing and source cuts', () => {
  expect(checkVisualRules([scene({ roughDurationHint: 1 }),scene()],[assetId],map()).map(f => f.rule)).toContain('cut_gap');
  expect(checkVisualRules([scene()],[assetId],map(analysis({ cuts: [1] }))).map(f => f.rule)).toContain('source_cut');
});
test('checks total, empty, missing analysis and low confidence', () => {
  expect(checkVisualRules([scene({ roughDurationHint: 91 })],[assetId],map()).map(f => f.rule)).toContain('total_duration');
  expect(checkVisualRules([],[],map())[0].rule).toBe('empty_plan');
  expect(checkVisualRules([scene()],[assetId],new Map())[0].rule).toBe('analysis_missing');
  const a = analysis(); a.frames[0].detection = null;
  expect(checkVisualRules([scene()],[assetId],map(a)).map(f => f.rule)).toContain('low_confidence');
});
test.each(['product_center','product_area','product_clipped'])('checks %s after 9:16 crop', rule => {
  const a = analysis({ width: 1600,height: 900 });
  a.frames[0].detection!.box = { x: .8,y: .2,w: .15,h: .6 };
  Object.assign(a.frames[0],cropMetrics(a.frames[0].detection!.box,a.width,a.height));
  expect(checkVisualRules([scene()],[assetId],map(a)).map(f => f.rule)).toContain(rule);
});
test('high confidence: extend shot/hero, re-check, no Gemini', async () => {
  const gemini = jest.fn(); const result = await runVisualPrecheck([scene({ roughDurationHint: 1 })],[assetId],map(),{ gemini });
  expect(result.scenes[0].roughDurationHint).toBe(4); expect(result.flags).toEqual([]); expect(gemini).not.toHaveBeenCalled();
});
test('selects a usable segment away from cuts', async () => {
  const result = await runVisualPrecheck([scene()],[assetId],map(analysis({ cuts: [1,2] })));
  expect(result.scenes[0].visualStartSeconds).toBe(2); expect(result.flags).toEqual([]);
});
test('swaps a too short shot to another usable asset', async () => {
  const other = analysis({ assetId: 'other' }); const analyses = map(analysis({ usableDuration: 1 })); analyses.set('other',other);
  const result = await runVisualPrecheck([scene()],[assetId,'other'],analyses);
  expect(result.scenes[0].assetIndexes).toEqual([1]); expect(result.flags).toEqual([]);
});
test.each([
  { x: .75,y: .3,w: .2,h: .3 }, { x: .01,y: .1,w: .95,h: .8 }, { x: .49,y: .49,w: .02,h: .02 },
])('reframes/zooms/pads box %j and re-checks', async box => {
  const a = analysis({ width: 1600,height: 900 }); a.frames[0].detection!.box = box;
  Object.assign(a.frames[0],cropMetrics(box,a.width,a.height));
  const result = await runVisualPrecheck([scene()],[assetId],map(a));
  expect(result.scenes[0].visualCrop).toBeDefined(); expect(result.flags).toEqual([]);
  if (box.w > .9) expect(result.scenes[0].visualCrop!.pad).toBe(true);
});
test('low-confidence whole plan makes exactly one sheet and Gemini call', async () => {
  const a = analysis(); a.frames[0].detection!.confidence = .1;
  const sheet = jest.fn(async () => 'sheet'); const gemini = jest.fn(async () => ({ pass: true, score: 90, issues: [] }));
  const result = await runVisualPrecheck([scene(),scene()],[assetId],map(a),{ sheet,gemini });
  expect(sheet).toHaveBeenCalledTimes(1); expect(gemini).toHaveBeenCalledTimes(1);
  expect(gemini.mock.calls[0]).toHaveLength(3); expect(result.flags).toEqual([]);
});
test('Gemini failure preserves flags without retry', async () => {
  const a = analysis(); a.frames[0].detection = null;
  const gemini = jest.fn(async () => { throw new Error('offline'); });
  const result = await runVisualPrecheck([scene()],[assetId],map(a),{ sheet: async () => 'sheet', gemini });
  expect(gemini).toHaveBeenCalledTimes(1); expect(result.flags[0].rule).toBe('low_confidence');
});
test('unfixable flags survive and notifier serializes only allowed fields', async () => {
  const result = await runVisualPrecheck([scene()],[assetId],map(analysis({ usableDuration: 1 })));
  expect(result.flags.some(f => f.rule === 'usable_duration')).toBe(true);
  process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://example.invalid'; process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'fixture';
  const postFn = jest.fn(async () => ({ ok: true,status: 200 }));
  await notifyGrokBot({ id: 'item', shortCode: 'TEST', typeKey: 'script', requestId: 'request', packageOrderId: null, payload: { audience: 'admin' }, assetRefs: [], signals: { visualShotFlags: result.flags.map(f => ({ ...f, email: 'private@example.invalid' })) } } as unknown as ReviewItem,{ signedUrl: jest.fn(),postFn });
  const body = (postFn.mock.calls as unknown as [string,string,unknown][])[0][1];
  expect(JSON.parse(body).visualShotFlags).toEqual(result.flags); expect(body).not.toContain('private@');
});
test('analysis samples 3 frames, parses cuts and stores post-crop metrics', async () => {
  const run = jest.fn(async () => ({ stdout: Buffer.from('jpeg'), stderr: 'pts_time:1.5 pts_time:7.25' }));
  const probe = jest.fn(async () => ({ displayWidth: 900,displayHeight: 1600,durationSeconds: 12 }));
  const detector = new MockProductDetector(Array(3).fill({ box: { x: .3,y: .3,w: .4,h: .4 },confidence: .9 }));
  const a = await analyseVisualMedia(assetId,'local.mp4',false,detector,run,probe as never);
  expect(a.frames.map(f => f.time)).toEqual([3,6,9]); expect(a.cuts).toEqual([1.5,7.25]);
  expect(a.frames[0].areaRatio).toBeCloseTo(.16); expect(a.frames[0].centerOffset).toBe(0); expect(run).toHaveBeenCalledTimes(4);
  expect(run.mock.calls.some(c => (c as unknown as [string[]])[0].some(v => v.includes("select='gt(scene,0.3)'")))).toBe(true);
});
test('photo samples once; noop does not hallucinate', async () => {
  const run = jest.fn(async () => ({ stdout: Buffer.from('jpeg'),stderr: '' }));
  const a = await analyseVisualMedia(assetId,'photo.jpg',true,new NoopProductDetector(),run, (async () => ({ displayWidth: 900,displayHeight: 1600,durationSeconds: 0 })) as never);
  expect(run).toHaveBeenCalledTimes(1); expect(a.frames[0].detection).toBeNull();
});
test('builds one <=384px tiled contact sheet containing every sample', async () => {
  const run = jest.fn(async () => ({ stdout: Buffer.from('sheet'),stderr: '' }));
  const frames = Array(12).fill(Buffer.from('jpeg').toString('base64'));
  expect(await visualContactSheet(frames,run)).toBe(Buffer.from('sheet').toString('base64'));
  const [args,input] = (run.mock.calls as unknown as [string[],Buffer][])[0];
  expect(args.join(' ')).toContain('tile=4x3:nb_frames=12'); expect(input.length).toBe(48);
});
test('cache is never redone, including concurrent worker claims and repeated enqueue', async () => {
  const repo = new MockAssetVisualAnalysisRepository(new Map()); await repo.enqueue(assetId,'1');
  const analyse = jest.fn(async () => analysis());
  const assets = { findById: jest.fn(async () => ({ storageKey: 'line_uploads/clip.mp4',mimeType: 'video/mp4' })) } as unknown as IUploadedAssetRepository;
  const signed = jest.fn(async () => 'local');
  await Promise.all([processAssetVisualAnalysis(repo,assets,analyse,signed),processAssetVisualAnalysis(repo,assets,analyse,signed)]);
  await repo.enqueue(assetId,'1'); await processAssetVisualAnalysis(repo,assets,analyse,signed);
  expect(analyse).toHaveBeenCalledTimes(1); expect(await repo.get(assetId,'1')).toEqual(analysis());
});
test('failed analysis does not replay and flags off never claim', async () => {
  const repo = new MockAssetVisualAnalysisRepository(new Map()); await repo.enqueue(assetId,'1');
  const analyse = jest.fn(); const assets = { findById: jest.fn(async () => null) } as unknown as IUploadedAssetRepository;
  await processAssetVisualAnalysis(repo,assets,analyse); expect(await repo.claim('1')).toBeNull(); expect(analyse).not.toHaveBeenCalled();
  process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED = 'false'; const claim = jest.spyOn(repo,'claim');
  await processAssetVisualAnalysis(repo,assets,analyse); expect(claim).not.toHaveBeenCalled();
});
test('abandoned claims expire to human review without rerunning detector', async () => {
  jest.useFakeTimers();
  try {
    const repo = new MockAssetVisualAnalysisRepository(new Map()); await repo.enqueue(assetId,'1'); await repo.claim('1');
    jest.advanceTimersByTime(901000);
    const after = jest.fn(async () => {}), analyse = jest.fn();
    const assets = { findById: jest.fn(async () => ({ requestId: 'request' })) } as unknown as IUploadedAssetRepository;
    await processAssetVisualAnalysis(repo,assets,analyse,undefined,after);
    expect(after).toHaveBeenCalledWith('request'); expect(analyse).not.toHaveBeenCalled(); expect(await repo.pending(assetId,'1')).toBe(false);
    await repo.save(analysis()); expect(await repo.get(assetId,'1')).toBeNull();
  } finally { jest.useRealTimers(); }
});
test('thresholds configurable and estimate prints without network', () => {
  process.env.STORYBOARD_MIN_SHOT_SECONDS = '5';
  expect(checkVisualRules([scene()],[assetId],map()).map(f => f.rule)).toContain('min_shot');
  expect(parseSceneCuts('pts_time:2 pts_time:1 pts_time:2')).toEqual([1,2]);
  console.log('VISUAL TOKEN ESTIMATE (384px single image, prompt chars / 2.5):',visualTokenEstimate());
});
