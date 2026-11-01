import type { StoryboardScene, ScenePlan } from './VideoGenerationJob';
export interface VersionScene extends StoryboardScene {
  assetIds: string[];
  onScreenText: string;
  voiceScript: string;
  renderPlan?: ScenePlan;
}
export interface StoryboardVersion {
  id: string;
  requestId: string;
  parentVersionId: string | null;
  scenes: VersionScene[];
  createdBy: 'shop' | 'admin' | 'system';
  reason: string;
  isTest: boolean;
  createdAt: string;
}
export type NewStoryboardVersion = Omit<StoryboardVersion, 'id' | 'createdAt'>;
