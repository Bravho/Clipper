/**
 * Storyboard AI pre-review for LINE jobs.
 *
 * Runs before the storyboard reaches the shop/Tho review gate:
 * 1. Deterministic checks (menu names/prices, total duration, asset existence, licensed music).
 * 2. One Gemini Flash text-only call for quality scoring.
 * 3. On fail: regenerate the storyboard ONCE via the injected regenerateFn, then re-check.
 *
 * Enabled only when STORYBOARD_AI_PRECHECK_ENABLED=true; otherwise a no-op.
 * All errors are caught — a precheck failure must never block the pipeline.
 */

import { GoogleGenAI } from '@google/genai';
import { AI_CONFIG, requireGeminiApiKey } from '@/config/aiTools';
import { isLicensedMusic } from '@/config/musicWhitelist';
import { applyShopRules, type ShopRules } from '@/services/review/ShopRulesEngine';
import type { VideoGenerationJob, StoryboardScene } from '@/domain/models/VideoGenerationJob';
import type { UploadedAsset } from '@/domain/models/UploadedAsset';

export interface PrecheckDeterministicResult {
  pass: boolean;
  issues: string[];
}

export interface GeminiPrecheckResponse {
  score: number;
  issues: string[];
  pass: boolean;
}

export interface PrecheckResult {
  pass: boolean;
  issues: string[];
  /** True when the service regenerated the storyboard and re-checked. */
  retriedWithNewStoryboard: boolean;
}

/**
 * Per-job retry guard: prevents infinite loops when regeneration triggers
 * another precheck pass. Cleared on process restart (acceptable — a fresh
 * server will just run the check once more, which is safe).
 */
const precheckRetriedJobs = new Set<string>();

// ---------------------------------------------------------------------------
// Deterministic check
// ---------------------------------------------------------------------------

/**
 * Pure deterministic validation against shop rules and system constraints.
 * No network calls; safe to call in tests without mocking anything.
 */
export function deterministicCheck(
  job: VideoGenerationJob,
  assets: UploadedAsset[],
  shopRules: ShopRules,
): PrecheckDeterministicResult {
  const issues: string[] = [];

  // 1. Menu names, prices and promos match shop's fixed data
  const textsToCheck: string[] = [];
  if (job.scriptThai) textsToCheck.push(job.scriptThai);
  const storyboard: StoryboardScene[] = parseStoryboard(job.storyboard);
  for (const scene of storyboard) {
    if (scene.summary) textsToCheck.push(scene.summary);
  }
  for (const text of textsToCheck) {
    const result = applyShopRules(text, shopRules);
    if (result.corrections.length > 0) {
      const fields = [...new Set(result.corrections.map((c) => c.field))].join(', ');
      issues.push(`menu_mismatch: ${fields}`);
      break; // one issue entry per text block is enough
    }
  }

  // 2. Total length <= 90 s (uses roughDurationHint when present)
  const totalDuration = storyboard.reduce((sum, s) => sum + (s.roughDurationHint ?? 0), 0);
  if (totalDuration > 0 && totalDuration > 90) {
    issues.push(`duration_exceeded: ${Math.round(totalDuration)}s > 90s`);
  }

  // 3. Every scene's asset index resolves
  const maxIdx = assets.length - 1;
  for (const scene of storyboard) {
    for (const idx of scene.assetIndexes) {
      if (idx > maxIdx) {
        issues.push(`asset_not_found: scene ${scene.sceneNumber} idx ${idx}`);
      }
    }
  }

  // 4. Music is from the licensed whitelist
  if (job.selectedMusicTrack && job.selectedMusicTrack !== 'none') {
    if (!isLicensedMusic(job.selectedMusicTrack)) {
      issues.push(`unlicensed_music: ${job.selectedMusicTrack}`);
    }
  }

  return { pass: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Gemini scoring prompt builder
// ---------------------------------------------------------------------------

export function buildPrecheckPrompt(job: VideoGenerationJob): string {
  const script = job.scriptThai ?? '(ไม่มีสคริปต์)';
  const storyboardJson = job.storyboard ?? '[]';
  return (
    'You are a LINE marketing video quality reviewer. Review this Thai storyboard and script for a short social media video.\n\n' +
    `Script (Thai):\n${script}\n\n` +
    `Storyboard (JSON):\n${storyboardJson}\n\n` +
    'Evaluate and return ONLY valid JSON with no markdown fences:\n' +
    '{"score": <0-100>, "issues": ["<short Thai issue 1>", ...], "pass": <true|false>}\n\n' +
    'Check:\n' +
    '- Brief coverage: does the script clearly cover the product/service?\n' +
    '- Hook: does scene 1 have a strong opening hook?\n' +
    '- Scene order: logical flow from hook to CTA?\n' +
    '- Thai typos: obvious spelling/tonal errors?\n\n' +
    'Pass when score >= 70 and no critical issues. Issues must be short Thai phrases. No PII.'
  );
}

// ---------------------------------------------------------------------------
// Gemini call (injectable for tests)
// ---------------------------------------------------------------------------

export async function callGeminiScoring(
  prompt: string,
  config: { model: string; maxOutputTokens: number },
): Promise<GeminiPrecheckResponse> {
  const inputTokenEstimate = Math.ceil(prompt.length / 2.5);
  console.log(
    `[StoryboardPrecheck] Gemini call — estimated input tokens: ~${inputTokenEstimate}` +
    ` (${prompt.length} chars / 2.5); configured maxOutputTokens: ${config.maxOutputTokens}`,
  );

  const apiKey = requireGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: config.model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: config.maxOutputTokens,
    },
  });

  const text = (result.text ?? '').trim();
  return parseGeminiResponse(text);
}

export function parseGeminiResponse(text: string): GeminiPrecheckResponse {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof parsed.score !== 'number' ||
      !Array.isArray(parsed.issues) ||
      typeof parsed.pass !== 'boolean'
    ) {
      throw new Error('Invalid shape');
    }
    return {
      score: parsed.score,
      issues: (parsed.issues as unknown[]).map(String).filter(Boolean),
      pass: parsed.pass,
    };
  } catch {
    return {
      score: 0,
      issues: [`parse_error: ${text.slice(0, 80)}`],
      pass: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface StoryboardPrecheckOptions {
  /**
   * Override the Gemini scoring call. Injected in tests to avoid real API calls.
   * Receives the prompt and config; must return a GeminiPrecheckResponse.
   */
  callGeminiFn?: (prompt: string, config: { model: string; maxOutputTokens: number }) => Promise<GeminiPrecheckResponse>;
  /**
   * Regenerate storyboard content. Called on first fail to produce a new
   * storyboard before re-checking. Returning null skips regeneration.
   */
  regenerateFn?: () => Promise<{ storyboard: string | null; scriptThai: string | null } | null>;
}

/**
 * Run the full storyboard pre-review for a LINE job.
 *
 * Returns immediately (pass=true, no issues) when the feature flag is off,
 * keeping the existing pipeline behaviour unchanged.
 * Catches all internal errors and returns them as issues so the pipeline
 * always continues.
 */
export async function runStoryboardPrecheck(
  job: VideoGenerationJob,
  shopRules: ShopRules,
  assets: UploadedAsset[],
  opts: StoryboardPrecheckOptions = {},
): Promise<PrecheckResult> {
  // Read env at call time so tests can toggle the flag via process.env.
  if (process.env.STORYBOARD_AI_PRECHECK_ENABLED !== 'true') {
    return { pass: true, issues: [], retriedWithNewStoryboard: false };
  }
  const cfg = AI_CONFIG.storyboardPrecheck;

  try {
    const firstResult = await _runSingleCheck(job, shopRules, assets, cfg, opts.callGeminiFn);

    if (firstResult.pass) return { pass: true, issues: [], retriedWithNewStoryboard: false };

    // First check failed — try regeneration once
    if (!precheckRetriedJobs.has(job.id) && opts.regenerateFn) {
      precheckRetriedJobs.add(job.id);
      try {
        const newContent = await opts.regenerateFn();
        if (newContent) {
          const updatedJob: VideoGenerationJob = {
            ...job,
            storyboard: newContent.storyboard ?? job.storyboard,
            scriptThai: newContent.scriptThai ?? job.scriptThai,
          };
          const retryResult = await _runSingleCheck(updatedJob, shopRules, assets, cfg, opts.callGeminiFn);
          return {
            pass: retryResult.pass,
            issues: retryResult.issues,
            retriedWithNewStoryboard: true,
          };
        }
      } catch (regenErr) {
        console.error('[StoryboardPrecheck] regeneration failed:', regenErr);
        return {
          pass: false,
          issues: [...firstResult.issues, 'precheck_error'],
          retriedWithNewStoryboard: false,
        };
      }
    }

    return { pass: false, issues: firstResult.issues, retriedWithNewStoryboard: false };
  } catch (err) {
    console.error('[StoryboardPrecheck] unexpected error:', err);
    return { pass: false, issues: ['precheck_error'], retriedWithNewStoryboard: false };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _runSingleCheck(
  job: VideoGenerationJob,
  shopRules: ShopRules,
  assets: UploadedAsset[],
  cfg: { model: string; maxOutputTokens: number },
  callGeminiFn?: StoryboardPrecheckOptions['callGeminiFn'],
): Promise<{ pass: boolean; issues: string[] }> {
  const det = deterministicCheck(job, assets, shopRules);

  let aiResult: GeminiPrecheckResponse;
  const prompt = buildPrecheckPrompt(job);
  try {
    aiResult = callGeminiFn
      ? await callGeminiFn(prompt, cfg)
      : await callGeminiScoring(prompt, cfg);
  } catch (err) {
    console.error('[StoryboardPrecheck] Gemini call error:', err);
    aiResult = { score: 0, issues: ['precheck_error'], pass: false };
  }

  const allIssues = [...det.issues, ...aiResult.issues.filter(Boolean)];
  const pass = det.pass && aiResult.pass;
  return { pass, issues: allIssues };
}

function parseStoryboard(raw: string | null | undefined): StoryboardScene[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as StoryboardScene[]; } catch { return []; }
}
