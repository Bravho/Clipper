import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/**
 * The requester-facing production journey.
 *
 * These are deliberately broader than the persisted job steps: a phase remains
 * visible while its processing work and requester approval/action gate alternate.
 * Both the production card and Status History consume this same definition.
 */
export const PIPELINE_PHASES = [
  {
    id: 1,
    label: "วิเคราะห์เนื้อหาและบทพูด",
    desc: "AI วิเคราะห์สื่อและจัดทำบทพูดให้คุณตรวจสอบ",
  },
  {
    id: 2,
    label: "สร้างเสียงพากย์",
    desc: "สร้างเสียงพากย์จากบทพูดที่อนุมัติแล้วให้คุณฟังและตรวจสอบ",
  },
  {
    id: 3,
    label: "วางแผนฉากและสคริปต์วิดีโอ",
    desc: "วางแผนฉาก เวลา สื่อ และสคริปต์ให้สอดคล้องกับเสียงพากย์",
  },
  {
    id: 4,
    label: "สร้างวิดีโอแต่ละฉาก",
    desc: "สร้างและตรวจสอบวิดีโอของทุกฉากจากรูปภาพและคลิปที่เลือก",
  },
  {
    id: 5,
    label: "รวมฉากและเลือกเพลง",
    desc: "รวมฉากที่อนุมัติแล้วเป็นวิดีโอเดียว พร้อมตรวจสอบและเลือกเพลง",
  },
  {
    id: 6,
    label: "ผสมเสียงและสร้างวิดีโอต้นฉบับ",
    desc: "ผสมเสียงพากย์กับเพลงและเตรียมวิดีโอต้นฉบับสำหรับช่องทางต่าง ๆ",
  },
  {
    id: 7,
    label: "เพิ่มซับไตเติ้ลและกราฟิก",
    desc: "เพิ่มซับไตเติ้ลและกราฟิกตามภาษาและรูปแบบที่คุณเลือก",
  },
  {
    id: 8,
    label: "สร้างรูปแบบช่องทางและส่งมอบ",
    desc: "สร้างอัตราส่วนสำหรับทุกช่องทางและเตรียมวิดีโอให้ดาวน์โหลด",
  },
] as const;

export type PipelinePhaseId = (typeof PIPELINE_PHASES)[number]["id"];

export type PipelineStepDisplayState =
  | "processing"
  | "action_required"
  | "ready"
  | "complete"
  | "failed";

export interface PipelineStepPresentation {
  phaseId: PipelinePhaseId | null;
  state: PipelineStepDisplayState;
  statusLabel: string;
}

/**
 * Exhaustive presentation metadata for every persisted pipeline step.
 *
 * `satisfies Record<VideoGenerationStep, ...>` is intentional: adding a new
 * enum value without deciding how it should appear now fails type-checking
 * instead of silently producing the all-blue/missing-history state.
 */
export const PIPELINE_STEP_PRESENTATION = {
  [VideoGenerationStep.AnalyzingContent]: {
    phaseId: 1,
    state: "processing",
    statusLabel: "กำลังวิเคราะห์เนื้อหาและจัดทำบทพูด",
  },
  [VideoGenerationStep.AwaitingContentApproval]: {
    phaseId: 1,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบและอนุมัติบทพูด",
  },
  [VideoGenerationStep.GeneratingVoice]: {
    phaseId: 2,
    state: "processing",
    statusLabel: "กำลังสร้างเสียงพากย์",
  },
  [VideoGenerationStep.AwaitingVoiceApproval]: {
    phaseId: 2,
    state: "action_required",
    statusLabel: "รอคุณฟังและอนุมัติเสียงพากย์",
  },
  [VideoGenerationStep.GeneratingSceneDesign]: {
    phaseId: 3,
    state: "processing",
    statusLabel: "กำลังวางแผนฉากและสคริปต์วิดีโอ",
  },
  [VideoGenerationStep.AwaitingSceneDesignApproval]: {
    phaseId: 3,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบและอนุมัติแผนฉาก",
  },
  [VideoGenerationStep.AwaitingSceneScriptApproval]: {
    phaseId: 3,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบสคริปต์และสื่อของฉาก",
  },
  [VideoGenerationStep.GeneratingBaseVideo]: {
    phaseId: 4,
    state: "processing",
    statusLabel: "กำลังสร้างวิดีโอแต่ละฉาก",
  },
  [VideoGenerationStep.AwaitingVideoApproval]: {
    phaseId: 4,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบและอนุมัติวิดีโอแต่ละฉาก",
  },
  [VideoGenerationStep.MergingScenes]: {
    phaseId: 5,
    state: "processing",
    statusLabel: "กำลังรวมคลิปทุกฉาก",
  },
  [VideoGenerationStep.GeneratingAnimations]: {
    phaseId: 5,
    state: "processing",
    statusLabel: "กำลังเตรียมวิดีโอรวมสำหรับตรวจสอบ",
  },
  [VideoGenerationStep.AwaitingAnimationApproval]: {
    phaseId: 5,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบวิดีโอรวมและเลือกเพลง",
  },
  [VideoGenerationStep.ComposingFinalVideo]: {
    phaseId: 6,
    state: "processing",
    statusLabel: "กำลังผสมเสียงและสร้างวิดีโอต้นฉบับ",
  },
  [VideoGenerationStep.AwaitingFinalApproval]: {
    phaseId: 6,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบวิดีโอต้นฉบับและตั้งค่าซับไตเติ้ล",
  },
  [VideoGenerationStep.GeneratingOverlay]: {
    phaseId: 7,
    state: "processing",
    statusLabel: "กำลังเพิ่มซับไตเติ้ลและกราฟิก",
  },
  [VideoGenerationStep.AwaitingOverlayApproval]: {
    phaseId: 7,
    state: "action_required",
    statusLabel: "รอคุณตรวจสอบวิดีโอที่มีซับไตเติ้ล",
  },
  [VideoGenerationStep.AwaitingAdditionalRatios]: {
    phaseId: 8,
    state: "action_required",
    statusLabel: "พร้อมสร้างรูปแบบสำหรับช่องทางที่เหลือ",
  },
  [VideoGenerationStep.GeneratingAdditionalRatios]: {
    phaseId: 8,
    state: "processing",
    statusLabel: "กำลังสร้างวิดีโอสำหรับช่องทางที่เหลือ",
  },
  [VideoGenerationStep.AwaitingDistributionReview]: {
    phaseId: 8,
    state: "ready",
    statusLabel: "วิดีโอพร้อมดาวน์โหลดและนำไปเผยแพร่",
  },
  [VideoGenerationStep.Publishing]: {
    phaseId: 8,
    state: "processing",
    statusLabel: "กำลังเผยแพร่วิดีโอ",
  },
  [VideoGenerationStep.Complete]: {
    phaseId: 8,
    state: "complete",
    statusLabel: "การผลิตเสร็จสิ้น",
  },
  [VideoGenerationStep.Failed]: {
    phaseId: null,
    state: "failed",
    statusLabel: "เกิดข้อผิดพลาดในการผลิต",
  },
  // Legacy states retained for existing database rows.
  [VideoGenerationStep.AwaitingVoiceRecording]: {
    phaseId: 2,
    state: "action_required",
    statusLabel: "รอบันทึกเสียงพากย์",
  },
  [VideoGenerationStep.ProcessingVoice]: {
    phaseId: 2,
    state: "processing",
    statusLabel: "กำลังประมวลผลเสียงพากย์",
  },
} satisfies Record<VideoGenerationStep, PipelineStepPresentation>;

/**
 * The gates the scene-plan express lane ("อนุมัติและทำทุกขั้นตอนที่เหลืออัตโนมัติ") approves on
 * the requester's behalf, with the copy shown INSTEAD of the normal "waiting for
 * you" label. On an express-lane job these are pass-throughs, not requests for
 * attention: showing them as `action_required` (amber, paused) would tell the
 * requester to act on a screen that is about to disappear, so they render as
 * `processing` — the pipeline genuinely IS working through them.
 */
const AUTO_APPROVED_GATE_LABELS: Partial<Record<VideoGenerationStep, string>> = {
  [VideoGenerationStep.AwaitingVideoApproval]:
    "อนุมัติอัตโนมัติแล้ว — กำลังรวมวิดีโอทุกฉาก",
  [VideoGenerationStep.AwaitingAnimationApproval]:
    "อนุมัติอัตโนมัติแล้ว — กำลังรวมเสียงพากย์และเพลงเข้าในวิดีโอ",
  [VideoGenerationStep.AwaitingFinalApproval]:
    "อนุมัติอัตโนมัติแล้ว — กำลังเตรียมใส่ซับไตเติ้ลและกราฟิก",
  [VideoGenerationStep.AwaitingOverlayApproval]:
    "อนุมัติอัตโนมัติแล้ว — กำลังเตรียมวิดีโอสำหรับช่องทางของคุณ",
  [VideoGenerationStep.AwaitingAdditionalRatios]:
    "อนุมัติอัตโนมัติแล้ว — กำลังเริ่มสร้างรูปแบบช่องทางที่เหลือ",
};

/** True when this step is a gate the express lane handles automatically. */
export function isAutoApprovedGate(step: VideoGenerationStep | null | undefined): boolean {
  return step != null && step in AUTO_APPROVED_GATE_LABELS;
}

export const STEP_TO_PHASE = Object.fromEntries(
  Object.entries(PIPELINE_STEP_PRESENTATION).map(([step, presentation]) => [
    step,
    presentation.phaseId,
  ])
) as Record<VideoGenerationStep, PipelinePhaseId | null>;

export interface PipelineDisplayOptions {
  /**
   * The job took the scene-plan express lane, so the remaining approval gates are
   * granted automatically. Re-labels those gates as work in progress rather than
   * as something the requester must act on.
   */
  autoApproveRemaining?: boolean;
}

export function getPipelineStepPresentation(
  step: VideoGenerationStep | null | undefined,
  options: PipelineDisplayOptions = {}
): PipelineStepPresentation | null {
  if (!step) return null;
  const base =
    PIPELINE_STEP_PRESENTATION[
      step as keyof typeof PIPELINE_STEP_PRESENTATION
    ] ?? null;
  if (!base) return null;

  const autoLabel = AUTO_APPROVED_GATE_LABELS[step];
  if (options.autoApproveRemaining && autoLabel) {
    return { ...base, state: "processing", statusLabel: autoLabel };
  }
  return base;
}

export type PipelinePhaseDisplayStatus =
  | "preview"
  | "pending"
  | "completed"
  | "processing"
  | "action_required"
  | "ready"
  | "failed"
  | "unknown";

export interface PipelinePhaseDisplay {
  phase: (typeof PIPELINE_PHASES)[number];
  status: PipelinePhaseDisplayStatus;
}

/**
 * Pure state projection used by the production card and covered by a complete
 * enum matrix in tests.
 */
export function buildPipelinePhaseDisplay(
  currentStep?: VideoGenerationStep | null,
  failedAtStep?: VideoGenerationStep | null,
  options: PipelineDisplayOptions = {}
): PipelinePhaseDisplay[] {
  if (!currentStep) {
    return PIPELINE_PHASES.map((phase) => ({ phase, status: "preview" }));
  }

  if (currentStep === VideoGenerationStep.Failed) {
    const failedPhaseId = getPipelineStepPresentation(failedAtStep)?.phaseId ?? null;
    if (failedPhaseId == null) {
      return PIPELINE_PHASES.map((phase) => ({ phase, status: "unknown" }));
    }
    return PIPELINE_PHASES.map((phase) => ({
      phase,
      status:
        phase.id < failedPhaseId
          ? "completed"
          : phase.id === failedPhaseId
            ? "failed"
            : "pending",
    }));
  }

  const current = getPipelineStepPresentation(currentStep, options);
  if (!current || current.phaseId == null) {
    return PIPELINE_PHASES.map((phase) => ({ phase, status: "unknown" }));
  }

  if (current.state === "complete") {
    return PIPELINE_PHASES.map((phase) => ({ phase, status: "completed" }));
  }

  const activeStatus: PipelinePhaseDisplayStatus =
    current.state === "processing" ||
    current.state === "action_required" ||
    current.state === "ready"
      ? current.state
      : "unknown";

  return PIPELINE_PHASES.map((phase) => ({
    phase,
    status:
      phase.id < current.phaseId!
        ? "completed"
        : phase.id > current.phaseId!
          ? "pending"
          : activeStatus,
  }));
}
