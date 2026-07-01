/**
 * Motion-graphic template catalog (Phase 7).
 *
 * A template is an aesthetic preset applied when the final styled/captioned
 * video is rendered (see `remotion/TemplatedVideo.tsx`). The requester picks one
 * at the merged-review step; "none" (default) is a clean full-bleed video with
 * just subtitles.
 *
 * The actual per-template rendering lives in the Remotion bundle, keyed by `id`
 * (the bundle can't import this file's path alias). This catalog drives the
 * picker UI, the display names, and validation.
 */

export type TemplateFrame = "full_bleed" | "corner_bracket" | "polaroid" | "rounded_inset";

export interface MotionTemplate {
  id: string;
  /** Thai display name for the picker. */
  name: string;
  /** One-line Thai description. */
  description: string;
  frame: TemplateFrame;
  /** Canvas behind an inset frame; "none" = video fills the screen. */
  canvas: "none" | "black" | "palette_light" | "palette_dark";
  /** Decoration ids the Remotion template renders. */
  decor: string[];
}

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: "none",
    name: "ไม่มีเทมเพลต (คลีน)",
    description: "วิดีโอเต็มจอพร้อมซับไตเติ้ล ไม่มีกราฟิกเพิ่ม",
    frame: "full_bleed",
    canvas: "none",
    decor: [],
  },
  {
    id: "clean_frame",
    name: "กรอบมินิมอล",
    description: "กรอบมุมสีขาว + ระลอกคลื่นบางๆ ดูสะอาดตาและมืออาชีพ",
    frame: "corner_bracket",
    canvas: "none",
    decor: ["corner_brackets", "ripple", "accent_bar"],
  },
  {
    id: "framed_cream",
    name: "กรอบอบอุ่น",
    description: "วางวิดีโอในกรอบมนบนพื้นหลังโทนอุ่น + ลายเส้นมินิมอล",
    frame: "rounded_inset",
    canvas: "palette_light",
    decor: ["wave_line", "sprig"],
  },
  {
    id: "editorial",
    name: "เรียบหรู (Editorial)",
    description: "กรอบเส้นบางรอบภาพ + ไล่เฉดมุมบน-ล่าง และแถบเน้นเล็กๆ ดูเรียบหรูแบบนิตยสาร",
    frame: "full_bleed",
    canvas: "none",
    decor: ["hairline_border", "kicker", "scrims"],
  },
];

export const DEFAULT_TEMPLATE_ID = "none";

export function getTemplate(id?: string | null): MotionTemplate {
  return (
    MOTION_TEMPLATES.find((t) => t.id === (id ?? DEFAULT_TEMPLATE_ID)) ?? MOTION_TEMPLATES[0]
  );
}

export function isValidTemplateId(id: unknown): id is string {
  return typeof id === "string" && MOTION_TEMPLATES.some((t) => t.id === id);
}
