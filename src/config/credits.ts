export const CREDITS_CONFIG = {
  SIGNUP_BONUS_CREDITS: 30,
  REQUEST_COST_CREDITS: 10,
  CREDIT_TO_BAHT_VALUE: 10,
} as const;

export const PIPELINE_STEP_COSTS = {
  CONTENT_ANALYSIS: 10,
  VIDEO_GEN_PER_SECOND: 10,
  MUSIC_SOUND_PER_SECOND: 7,
  SUBTITLE_PER_SECOND: 3,
  RESIZE_FREE_CHANNELS: 2,
  RESIZE_PER_EXTRA_CHANNEL: 30,
  REWORK_BUFFER_PERCENT: 10,
  MIN_DURATION_SECONDS: 5,
  MAX_DURATION_SECONDS: 30,
  DEFAULT_DURATION_SECONDS: 15,
} as const;

export interface PipelineCostBreakdown {
  step1: number;
  step2: number;
  step3: number;
  step4: number;
  step5: number;
  extraChannels: number;
  base: number;
  rework: number;
  total: number;
}

export function calcPipelineCost(
  durationSeconds: number,
  totalChannels: number
): PipelineCostBreakdown {
  const step1 = PIPELINE_STEP_COSTS.CONTENT_ANALYSIS;
  const step2 = durationSeconds * PIPELINE_STEP_COSTS.VIDEO_GEN_PER_SECOND;
  const step3 = durationSeconds * PIPELINE_STEP_COSTS.MUSIC_SOUND_PER_SECOND;
  const step4 = durationSeconds * PIPELINE_STEP_COSTS.SUBTITLE_PER_SECOND;
  const extraChannels = Math.max(0, totalChannels - PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS);
  const step5 = extraChannels * PIPELINE_STEP_COSTS.RESIZE_PER_EXTRA_CHANNEL;
  const base = step1 + step2 + step3 + step4 + step5;
  const rework = Math.ceil((base * PIPELINE_STEP_COSTS.REWORK_BUFFER_PERCENT) / 100);
  return { step1, step2, step3, step4, step5, extraChannels, base, rework, total: base + rework };
}

export const PIPELINE_PHASES = [
  {
    id: 1,
    label: "วิเคราะห์เนื้อหา",
    desc: "AI วิเคราะห์รูปภาพและวางแผนฉาก + ทีมตรวจสอบ",
  },
  {
    id: 2,
    label: "สร้างวิดีโอ",
    desc: "AI สร้างวิดีโอจากรูปที่อัปโหลด",
  },
  {
    id: 3,
    label: "เสียงและดนตรี",
    desc: "บันทึกเสียงพากย์ + แปลงเสียงด้วย RVC",
  },
  {
    id: 4,
    label: "ซับไตเติ้ล",
    desc: "ใส่ subtitle 3 ภาษา: ไทย · อังกฤษ · จีน",
  },
  {
    id: 5,
    label: "ปรับขนาดและเผยแพร่",
    desc: "Export 4 ratio + โพสต์อัตโนมัติไปยัง platform ที่เลือก",
  },
] as const;

export const AI_TRACK_BASE_COST = calcPipelineCost(
  PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS,
  PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS
).total;
