import type { StoryboardScene } from '@/domain/models/VideoGenerationJob';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
import { visualConfig, visualEnabled } from '@/config/storyboardVisual';
import { visualContactSheet } from '@/lib/ai/storyboardVisualMedia';
import { callGeminiScoring, type GeminiPrecheckResponse } from './StoryboardPrecheckService';
import { AI_CONFIG } from '@/config/aiTools';

export interface VisualShotFlag { sceneIndex: number; assetId: string; rule: string; measuredValue: number }
export interface VisualCrop { x: number; y: number; w: number; h: number; zoom: number; pad: boolean }
export const VISUAL_PROMPT = 'Review the numbered storyboard thumbnail contact sheet for product visibility and ambiguous framing. Return JSON {"score":0-100,"issues":[],"pass":boolean}. No identities or personal information. Fail if uncertain.';
export function visualTokenEstimate(prompt = VISUAL_PROMPT) {
  const imageTokens = 258; const promptTokens = Math.ceil(prompt.length / 2.5);
  const outputTokens = visualConfig().outputTokens;
  return { imageTokens, promptTokens, outputTokens, total: imageTokens + promptTokens + outputTokens };
}
function segment(a: AssetVisualAnalysis, needed: number): number | null {
  const points = [0, ...a.cuts, a.usableDuration];
  for (let i = 1; i < points.length; i++) if (points[i] - points[i-1] >= needed) return points[i-1];
  return null;
}
function proposeCrop(a: AssetVisualAnalysis): VisualCrop | null {
  const boxes = a.frames.flatMap(f => f.detection ? [f.detection.box] : []);
  if (!boxes.length) return null;
  const cfg = visualConfig();
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
  const area = (right-x) * (bottom-y);
  const target = Math.sqrt(cfg.minArea * cfg.maxArea);
  const aspect = (9/16) * a.height / a.width;
  let w = Math.sqrt(area / target * aspect), h = w / aspect;
  const fit = Math.max(1, (right-x)/w, (bottom-y)/h);
  w *= fit; h *= fit;
  const cx = (x+right)/2, cy = (y+bottom)/2;
  return { x: cx-w/2, y: cy-h/2, w, h, zoom: Math.min(1,aspect)/w,
    pad: cx-w/2 < 0 || cy-h/2 < 0 || cx+w/2 > 1 || cy+h/2 > 1 };
}
export function checkVisualRules(scenes: StoryboardScene[], ids: string[], analyses: Map<string, AssetVisualAnalysis>): VisualShotFlag[] {
  const cfg = visualConfig(); const flags: VisualShotFlag[] = [];
  if (!scenes.length) flags.push({ sceneIndex: -1, assetId: '', rule: 'empty_plan', measuredValue: 0 });
  scenes.forEach((scene, sceneIndex) => {
    const assetId = ids[scene.assetIndexes[0]] ?? '';
    const a = analyses.get(assetId);
    const flag = (rule: string, measuredValue: number) => flags.push({ sceneIndex, assetId, rule, measuredValue });
    const duration = scene.roughDurationHint ?? 0;
    if (duration < cfg.minShot) flag('min_shot', duration);
    if (scene.heroShot && duration < cfg.hero) flag('hero_hold', duration);
    if (!sceneIndex && duration < cfg.first) flag('first_hold', duration);
    if (sceneIndex === scenes.length-1 && duration < cfg.last) flag('last_hold', duration);
    if (sceneIndex < scenes.length-1 && duration < cfg.cutGap) flag('cut_gap', duration);
    if (scene.assetIndexes.length !== 1) flag('ambiguous_assets', scene.assetIndexes.length);
    if (!a) { flag('analysis_missing', 0); return; }
    const start = scene.visualStartSeconds ?? 0;
    if (start + duration > a.usableDuration) flag('usable_duration', a.usableDuration-start);
    for (const cut of a.cuts) if (cut > start && cut < start+duration) flag('source_cut', cut-start);
    if (!a.frames.length) flag('analysis_missing', 0);
    for (const f of a.frames) {
      if (!f.detection || f.detection.confidence < cfg.confidence) { flag('low_confidence', f.detection?.confidence ?? 0); continue; }
      const b = f.detection.box, crop = scene.visualCrop;
      const offset = crop ? Math.hypot((b.x+b.w/2-crop.x)/crop.w-0.5, (b.y+b.h/2-crop.y)/crop.h-0.5) : f.centerOffset!;
      const area = crop ? b.w*b.h/(crop.w*crop.h) : f.areaRatio!;
      if (offset > cfg.center) flag('product_center', offset);
      if (area < cfg.minArea || area > cfg.maxArea) flag('product_area', area);
      if (crop && (b.x < crop.x || b.y < crop.y || b.x+b.w > crop.x+crop.w || b.y+b.h > crop.y+crop.h)) flag('product_clipped', area);
      if (!crop) {
        const cw = Math.min(1,a.height*9/16/a.width), ch = Math.min(1,a.width*16/9/a.height);
        if (b.x < (1-cw)/2 || b.x+b.w > (1+cw)/2 || b.y < (1-ch)/2 || b.y+b.h > (1+ch)/2) flag('product_clipped', area);
      }
    }
  });
  const total = scenes.reduce((n,s) => n+(s.roughDurationHint ?? 0),0);
  if (total > cfg.maxDuration) flags.push({ sceneIndex: scenes.length-1, assetId: ids[scenes.at(-1)?.assetIndexes[0] ?? -1] ?? '', rule: 'total_duration', measuredValue: total });
  return flags;
}
export async function runVisualPrecheck(scenes: StoryboardScene[], ids: string[], analyses: Map<string, AssetVisualAnalysis>, opts: {
  sheet?: typeof visualContactSheet;
  gemini?: (prompt: string, cfg: { model: string; maxOutputTokens: number }, image: string) => Promise<GeminiPrecheckResponse>;
} = {}) {
  if (!visualEnabled()) return { scenes, flags: [] as VisualShotFlag[] };
  const cfg = visualConfig();
  const heroIndex = scenes.some(s => s.heroShot) ? -1 : scenes.reduce((best,s,i) => (s.roughDurationHint ?? 0) > (scenes[best]?.roughDurationHint ?? 0) ? i : best, 0);
  const fixed = scenes.map((s,i) => {
    const scene = { ...s, assetIndexes: [...s.assetIndexes] };
    if (i === heroIndex) scene.heroShot = true;
    const needed = Math.max(scene.roughDurationHint ?? 0, cfg.minShot, cfg.cutGap,
      scene.heroShot ? cfg.hero : 0, i === 0 ? cfg.first : 0, i === scenes.length-1 ? cfg.last : 0);
    let id = ids[scene.assetIndexes[0]], a = analyses.get(id);
    let start = a ? segment(a, needed) : null;
    if (start === null) {
      const replacement = ids.find(other => { const v = analyses.get(other); return v && segment(v,needed) !== null && v.frames.length && v.frames.every(f => f.detection && f.detection.confidence >= cfg.confidence); });
      if (replacement) { id = replacement; a = analyses.get(id); start = segment(a!,needed); scene.assetIndexes = [ids.indexOf(id)]; }
    }
    if (start !== null) { scene.visualStartSeconds = start; scene.roughDurationHint = needed; }
    if (a && a.frames.every(f => f.detection && f.detection.confidence >= cfg.confidence)) scene.visualCrop = proposeCrop(a) ?? undefined;
    return scene;
  });
  let flags = checkVisualRules(fixed, ids, analyses);
  const ambiguous = flags.some(f => ['low_confidence','ambiguous_assets'].includes(f.rule));
  if (ambiguous) {
    // One call for the entire plan. Missing analysis remains a hard failure.
    const frames = fixed.flatMap(s => s.assetIndexes.flatMap(index => analyses.get(ids[index])?.frames.map(f => f.data) ?? []));
    try {
      const image = await (opts.sheet ?? visualContactSheet)(frames);
      const estimate = visualTokenEstimate();
      console.log('[StoryboardVisualPrecheck] token estimate', estimate);
      const response = await (opts.gemini ?? callGeminiScoring)(VISUAL_PROMPT, { model: AI_CONFIG.storyboardPrecheck.model, maxOutputTokens: cfg.outputTokens }, image);
      if (response.pass) flags = flags.filter(f => f.rule !== 'low_confidence');
    } catch { /* Keep uncertain shots flagged; never regenerate or call again. */ }
  }
  return { scenes: fixed, flags };
}
