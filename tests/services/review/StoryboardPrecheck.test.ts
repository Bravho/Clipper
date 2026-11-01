/**
 * StoryboardPrecheck.test.ts
 *
 * Tests for StoryboardPrecheckService:
 * 1. pass path — deterministic pass + AI pass → no issues
 * 2. deterministic fail → regenerate → pass (retry path)
 * 3. fail twice → review item proceeds with issues + included in notifier payload
 * 4. flag off → unchanged (no precheck calls, always returns pass)
 * 5. Gemini error → continue with precheck_error issue
 *
 * No real Gemini calls — callGeminiFn is always injected.
 */

import {
  deterministicCheck,
  runStoryboardPrecheck,
  buildPrecheckPrompt,
  parseGeminiResponse,
  type GeminiPrecheckResponse,
} from '@/services/review/StoryboardPrecheckService';
import type { VideoGenerationJob } from '@/domain/models/VideoGenerationJob';
import type { UploadedAsset } from '@/domain/models/UploadedAsset';
import { AssetType, AssetUploadStatus } from '@/domain/enums/AssetType';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<VideoGenerationJob> = {}): VideoGenerationJob {
  return {
    id: 'job-1',
    requestId: 'req-1',
    status: 'in_progress' as never,
    currentStep: 'awaiting_content_approval' as never,
    currentSceneIndex: 0,
    storyboard: JSON.stringify([
      { sceneNumber: 1, summary: 'ปูม้านึ่ง', assetIndexes: [0], roughDurationHint: 8 },
      { sceneNumber: 2, summary: 'กุ้งเผา', assetIndexes: [1], roughDurationHint: 7 },
    ]),
    approvedStoryboard: null,
    videoEngine: 'montage',
    aiBrollEnabled: false,
    scenePlan: null,
    scriptThai: 'บุฟเฟ่ต์ทะเลสด ราคา 399 บาท',
    scriptEnglish: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: null,
    approvedScriptThai: null,
    approvedScriptEnglish: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: '',
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    selectedMusicTrack: 'Bossa Nova Suave',
    voiceDurationSeconds: null,
    ...overrides,
  } as unknown as VideoGenerationJob;
}

function makeAsset(index: number): UploadedAsset {
  return {
    id: `asset-${index}`,
    requestId: 'req-1',
    assetType: AssetType.Image,
    uploadStatus: AssetUploadStatus.Uploaded,
    storageKey: `uploads/asset-${index}.jpg`,
    storageUrl: `https://cdn.example.com/uploads/asset-${index}.jpg`,
    mimeType: 'image/jpeg',
  } as unknown as UploadedAsset;
}

const TWO_ASSETS = [makeAsset(0), makeAsset(1)];

const PASS_RESPONSE: GeminiPrecheckResponse = { score: 85, issues: [], pass: true };
const FAIL_RESPONSE: GeminiPrecheckResponse = { score: 40, issues: ['hook ไม่ชัดเจน', 'สคริปต์สั้นเกินไป'], pass: false };

// ---------------------------------------------------------------------------
// 1. deterministicCheck
// ---------------------------------------------------------------------------

describe('deterministicCheck', () => {
  it('passes when all constraints are met', () => {
    const job = makeJob();
    const result = deterministicCheck(job, TWO_ASSETS, {});
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('reports asset_not_found when storyboard references an out-of-range index', () => {
    const job = makeJob({
      storyboard: JSON.stringify([
        { sceneNumber: 1, summary: 'ทดสอบ', assetIndexes: [5], roughDurationHint: 10 },
      ]),
    });
    const result = deterministicCheck(job, TWO_ASSETS, {});
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.startsWith('asset_not_found'))).toBe(true);
  });

  it('reports duration_exceeded when roughDurationHint total exceeds 90s', () => {
    const job = makeJob({
      storyboard: JSON.stringify([
        { sceneNumber: 1, summary: 'ก', assetIndexes: [0], roughDurationHint: 50 },
        { sceneNumber: 2, summary: 'ข', assetIndexes: [1], roughDurationHint: 50 },
      ]),
    });
    const result = deterministicCheck(job, TWO_ASSETS, {});
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.startsWith('duration_exceeded'))).toBe(true);
  });

  it('reports unlicensed_music for a non-whitelisted track', () => {
    const job = makeJob({ selectedMusicTrack: 'Totally Unlicensed Track XYZ' });
    const result = deterministicCheck(job, TWO_ASSETS, {});
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.startsWith('unlicensed_music'))).toBe(true);
  });

  it('reports menu_mismatch when script contradicts shop rules', () => {
    const shopRules = { menuPrices: { 'บุฟเฟ่ต์ทะเล': 599 } };
    const job = makeJob({ scriptThai: 'บุฟเฟ่ต์ทะเลสด ราคา 399 บาท' }); // wrong price
    const result = deterministicCheck(job, TWO_ASSETS, shopRules);
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.startsWith('menu_mismatch'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. parseGeminiResponse
// ---------------------------------------------------------------------------

describe('parseGeminiResponse', () => {
  it('parses a well-formed JSON response', () => {
    const res = parseGeminiResponse('{"score":80,"issues":[],"pass":true}');
    expect(res.pass).toBe(true);
    expect(res.score).toBe(80);
  });

  it('returns parse_error on invalid JSON', () => {
    const res = parseGeminiResponse('not json at all');
    expect(res.pass).toBe(false);
    expect(res.issues[0]).toMatch(/^parse_error/);
  });

  it('returns parse_error on missing required fields', () => {
    const res = parseGeminiResponse('{"score":90}');
    expect(res.pass).toBe(false);
    expect(res.issues[0]).toMatch(/^parse_error/);
  });
});

// ---------------------------------------------------------------------------
// 3. runStoryboardPrecheck — flag OFF
// ---------------------------------------------------------------------------

describe('runStoryboardPrecheck — flag off', () => {
  let origEnabled: string | undefined;
  beforeEach(() => {
    origEnabled = process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'false';
  });
  afterEach(() => {
    if (origEnabled === undefined) delete process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    else process.env.STORYBOARD_AI_PRECHECK_ENABLED = origEnabled;
  });

  it('returns pass=true without calling Gemini when flag is off', async () => {
    const callGeminiFn = jest.fn(async (_p: string, _c: { model: string; maxOutputTokens: number }) => FAIL_RESPONSE);
    const result = await runStoryboardPrecheck(makeJob(), {}, TWO_ASSETS, { callGeminiFn });
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(callGeminiFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. runStoryboardPrecheck — flag ON
// ---------------------------------------------------------------------------

function withPrecheckEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const orig = process.env.STORYBOARD_AI_PRECHECK_ENABLED;
  process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'true';
  return fn().finally(() => {
    if (orig === undefined) delete process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    else process.env.STORYBOARD_AI_PRECHECK_ENABLED = orig;
  });
}

describe('runStoryboardPrecheck — pass path', () => {
  it('returns pass=true and no issues when both checks pass', async () => {
    const callGeminiFn = jest.fn(async (_p: string, _c: { model: string; maxOutputTokens: number }) => PASS_RESPONSE);
    const result = await withPrecheckEnabled(() =>
      runStoryboardPrecheck(makeJob(), {}, TWO_ASSETS, { callGeminiFn }),
    );
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(callGeminiFn).toHaveBeenCalledTimes(1);
  });
});

describe('runStoryboardPrecheck — deterministic fail → regenerate → pass', () => {
  it('regenerates once on first fail and returns pass when retry succeeds', async () => {
    // First call: job with bad duration → deterministic fail
    const badJob = makeJob({
      id: 'job-retry-pass',
      storyboard: JSON.stringify([
        { sceneNumber: 1, summary: 'ก', assetIndexes: [0], roughDurationHint: 60 },
        { sceneNumber: 2, summary: 'ข', assetIndexes: [1], roughDurationHint: 40 },
      ]),
    });

    const goodStoryboard = JSON.stringify([
      { sceneNumber: 1, summary: 'ก', assetIndexes: [0], roughDurationHint: 8 },
      { sceneNumber: 2, summary: 'ข', assetIndexes: [1], roughDurationHint: 7 },
    ]);

    const callGeminiFn = jest.fn(async (_p: string, _c: { model: string; maxOutputTokens: number }) => PASS_RESPONSE);
    const regenerateFn = jest.fn(async () => ({
      storyboard: goodStoryboard,
      scriptThai: 'สคริปต์ใหม่',
    }));

    const result = await withPrecheckEnabled(() =>
      runStoryboardPrecheck(badJob, {}, TWO_ASSETS, { callGeminiFn, regenerateFn }),
    );

    expect(regenerateFn).toHaveBeenCalledTimes(1);
    expect(result.retriedWithNewStoryboard).toBe(true);
    expect(result.pass).toBe(true);
  });
});

describe('runStoryboardPrecheck — fail twice → issues in result', () => {
  it('returns issues from both checks when retry also fails', async () => {
    const badJob = makeJob({
      id: 'job-fail-twice',
      storyboard: JSON.stringify([
        { sceneNumber: 1, summary: 'ก', assetIndexes: [0], roughDurationHint: 60 },
        { sceneNumber: 2, summary: 'ข', assetIndexes: [1], roughDurationHint: 40 },
      ]),
    });

    const badStoryboard = JSON.stringify([
      { sceneNumber: 1, summary: 'ก', assetIndexes: [0], roughDurationHint: 55 },
      { sceneNumber: 2, summary: 'ข', assetIndexes: [1], roughDurationHint: 40 },
    ]);

    const callGeminiFn = jest.fn(async (_p: string, _c: { model: string; maxOutputTokens: number }) => FAIL_RESPONSE);
    const regenerateFn = jest.fn(async () => ({
      storyboard: badStoryboard,
      scriptThai: 'สคริปต์ใหม่',
    }));

    const result = await withPrecheckEnabled(() =>
      runStoryboardPrecheck(badJob, {}, TWO_ASSETS, { callGeminiFn, regenerateFn }),
    );

    expect(result.pass).toBe(false);
    expect(result.retriedWithNewStoryboard).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    // AI issues from FAIL_RESPONSE should be present
    expect(result.issues).toEqual(expect.arrayContaining(['hook ไม่ชัดเจน', 'สคริปต์สั้นเกินไป']));
  });
});

describe('runStoryboardPrecheck — Gemini error → continue', () => {
  it('returns pass=false with precheck_error when Gemini throws', async () => {
    const callGeminiFn = jest.fn(async (_p: string, _c: { model: string; maxOutputTokens: number }) => { throw new Error('network error'); });

    const result = await withPrecheckEnabled(() =>
      runStoryboardPrecheck(makeJob(), {}, TWO_ASSETS, { callGeminiFn }),
    );

    expect(result.pass).toBe(false);
    expect(result.issues).toContain('precheck_error');
  });
});

// ---------------------------------------------------------------------------
// 5. buildPrecheckPrompt sanity check
// ---------------------------------------------------------------------------

describe('buildPrecheckPrompt', () => {
  it('includes the script and storyboard JSON in the prompt', () => {
    const job = makeJob();
    const prompt = buildPrecheckPrompt(job);
    expect(prompt).toContain(job.scriptThai!);
    expect(prompt).toContain(job.storyboard!);
    expect(prompt).toContain('pass');
  });
});

// ---------------------------------------------------------------------------
// 6. GrokBotNotifier includes precheckIssues from signals
// ---------------------------------------------------------------------------

describe('GrokBotNotifier — precheckIssues forwarded from signals', () => {
  it('includes precheckIssues in the payload when present in item.signals', async () => {
    const { notifyGrokBot } = await import('@/services/review/GrokBotNotifier');
    process.env.GROKBOT_REVIEW_WEBHOOK_URL = 'https://grok.example.com/hook';
    process.env.GROKBOT_REVIEW_WEBHOOK_KEY = 'test-key-32chars-padded-xxxxxxxx';

    let capturedPayload: Record<string, unknown> | undefined;
    const postFn = jest.fn(async (_url: string, body: string) => {
      capturedPayload = JSON.parse(body) as Record<string, unknown>;
      return { ok: true, status: 200 };
    });
    const signedUrl = jest.fn(async (key: string) => `https://cdn.example.com/${key}`);

    await notifyGrokBot(
      {
        id: 'item-2',
        shortCode: 'XYZ',
        typeKey: 'script',
        status: 'pending',
        resolution: null,
        renderState: 'none',
        shopUserId: 'shop-u',
        requestId: 'req-2',
        jobId: null,
        gateStep: null,
        packageOrderId: null,
        externalRef: null,
        title: 'Script review',
        payload: { audience: 'admin' },
        originalPayload: null,
        assetRefs: [],
        decisionMode: 'review',
        matchedRules: [],
        ruleSnapshot: null,
        signals: { precheckIssues: ['hook ไม่ชัดเจน', 'ราคาผิด'] },
        confidence: null,
        priority: 0,
        producer: {},
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        dueAt: new Date(),
        expiresAt: new Date(),
      } as never,
      { signedUrl, postFn },
    );

    expect(capturedPayload?.precheckIssues).toEqual(['hook ไม่ชัดเจน', 'ราคาผิด']);

    delete process.env.GROKBOT_REVIEW_WEBHOOK_URL;
    delete process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  });
});
