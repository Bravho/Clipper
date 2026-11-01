export interface ProductDetection { box: { x: number; y: number; w: number; h: number }; confidence: number }
export interface VisualFrame {
  data: string;
  time: number;
  detection: ProductDetection | null;
  centerOffset: number | null;
  areaRatio: number | null;
}
export interface AssetVisualAnalysis {
  assetId: string;
  version: string;
  usableDuration: number;
  width: number;
  height: number;
  cuts: number[];
  frames: VisualFrame[];
  photo: boolean;
}
