import { PRESENTATION_DIRECTIONS } from "./storytellingKnowledge";

export const AD_LAB_CONTENT_PURPOSES = ["advertisement", "personal_branding"] as const;
export type AdLabContentPurpose = (typeof AD_LAB_CONTENT_PURPOSES)[number];
export const DEFAULT_CONTENT_PURPOSE: AdLabContentPurpose = "advertisement";

export function resolveContentPurpose(value: unknown): AdLabContentPurpose {
  if (value === "advertisement" || value === "personal_branding") return value;
  return DEFAULT_CONTENT_PURPOSE;
}

export const CONTENT_PURPOSE_OPTIONS = [
  { value: "advertisement" as const, label: "โฆษณา (Advertisement)" },
  { value: "personal_branding" as const, label: "สร้างแบรนด์บุคคล (Personal Branding)" },
];

const AD_DURATIONS = [
  { value: "15", label: "15 วินาที" },
  { value: "30", label: "30 วินาที" },
  { value: "45", label: "45 วินาที" },
  { value: "60", label: "1 นาที" },
  { value: "90", label: "1 นาที 30 วินาที" },
  { value: "120", label: "2 นาที" },
  { value: "180", label: "3 นาที" },
  { value: "300", label: "5 นาที" },
  { value: "600", label: "10 นาที" },
] as const;

const PB_DURATIONS = [
  { value: "30", label: "30 วินาที" },
  { value: "45", label: "45 วินาที" },
  { value: "60", label: "1 นาที" },
  { value: "90", label: "1 นาที 30 วินาที" },
  { value: "120", label: "2 นาที" },
  { value: "180", label: "3 นาที" },
] as const;

const AD_OBJECTIVES = [
  { value: "awareness", label: "ให้คนรู้จักและจดจำแบรนด์" },
  { value: "consideration", label: "ให้คนสนใจและพิจารณาสินค้า" },
  { value: "conversion", label: "ให้คนตัดสินใจซื้อ สมัคร หรือติดต่อ" },
] as const;

const PB_OBJECTIVES = [
  { value: "authority", label: "สร้างความน่าเชื่อถือ/ภาพผู้เชี่ยวชาญ" },
  { value: "followers", label: "เพิ่มผู้ติดตาม" },
  { value: "engagement", label: "ให้คนคอมเมนต์และแชร์" },
  { value: "leads", label: "ให้คนทักมาสอบถาม/ปรึกษา" },
  { value: "community", label: "สร้างคอมมูนิตี้" },
] as const;

export const PB_DIRECTIONS = [
  { value: "story-experience", label: "เล่าเรื่องจริง/ประสบการณ์ของฉัน" },
  { value: "tips-knowledge", label: "แชร์เคล็ดลับและความรู้" },
  { value: "opinion", label: "มุมมอง/ความเห็นต่อเรื่องในวงการ" },
  { value: "behind-the-scenes", label: "เบื้องหลังการทำงาน" },
  { value: "qa", label: "ตอบคำถามที่คนถามบ่อย" },
  { value: "myth-busting", label: "แก้ความเชื่อผิด ๆ" },
  { value: "lesson-learned", label: "บทเรียนจากความผิดพลาด" },
  { value: "custom", label: "กำหนดเอง" },
] as const;

export const ALL_OBJECTIVES = [
  "awareness", "consideration", "conversion",
  "authority", "followers", "engagement", "leads", "community",
] as const;

export type AllObjective = (typeof ALL_OBJECTIVES)[number];

interface PurposeOptions {
  directions: readonly { readonly value: string; readonly label: string }[];
  durations: readonly { readonly value: string; readonly label: string }[];
  objectives: readonly { readonly value: string; readonly label: string }[];
  defaults: {
    presentationDirection: string;
    duration: string;
    objective: string;
  };
}

export function getPurposeOptions(purpose: AdLabContentPurpose): PurposeOptions {
  if (purpose === "personal_branding") {
    return {
      directions: PB_DIRECTIONS,
      durations: PB_DURATIONS,
      objectives: PB_OBJECTIVES,
      defaults: {
        presentationDirection: "story-experience",
        duration: "60",
        objective: "authority",
      },
    };
  }
  return {
    directions: PRESENTATION_DIRECTIONS,
    durations: AD_DURATIONS,
    objectives: AD_OBJECTIVES,
    defaults: {
      presentationDirection: "problem-solution",
      duration: "30",
      objective: "conversion",
    },
  };
}

export function isObjectiveAllowedFor(purpose: AdLabContentPurpose, objective: string): boolean {
  return getPurposeOptions(purpose).objectives.some((o) => o.value === objective);
}

export function getObjectiveLabel(value: string): string {
  return [...AD_OBJECTIVES, ...PB_OBJECTIVES].find((o) => o.value === value)?.label ?? value;
}

export function getDirectionLabel(value: string): string {
  return [...PRESENTATION_DIRECTIONS, ...PB_DIRECTIONS].find((d) => d.value === value)?.label ?? value;
}
