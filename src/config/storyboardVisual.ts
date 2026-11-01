const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
};
export const visualEnabled = () => process.env.STORYBOARD_AI_PRECHECK_ENABLED === 'true' && process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED === 'true';
export const visualConfig = () => ({
  version: process.env.STORYBOARD_VISUAL_ANALYSIS_VERSION?.trim() || '1',
  minShot: number('STORYBOARD_MIN_SHOT_SECONDS', 2.5),
  hero: number('STORYBOARD_HERO_SHOT_SECONDS', 4),
  cutGap: number('STORYBOARD_MIN_CUT_GAP_SECONDS', 2.5),
  first: number('STORYBOARD_FIRST_HOLD_SECONDS', 2.5),
  last: number('STORYBOARD_LAST_HOLD_SECONDS', 2.5),
  center: number('STORYBOARD_MAX_CENTER_OFFSET', 0.2),
  minArea: number('STORYBOARD_MIN_PRODUCT_AREA', 0.08),
  maxArea: number('STORYBOARD_MAX_PRODUCT_AREA', 0.75),
  confidence: number('STORYBOARD_DETECTOR_MIN_CONFIDENCE', 0.7),
  sceneThreshold: number('STORYBOARD_SCENE_CUT_THRESHOLD', 0.3),
  maxDuration: number('STORYBOARD_VISUAL_MAX_SECONDS', 90),
  outputTokens: number('STORYBOARD_VISUAL_MAX_OUTPUT_TOKENS', 512),
  claimTimeout: number('STORYBOARD_VISUAL_CLAIM_TIMEOUT_SECONDS', 900),
});
