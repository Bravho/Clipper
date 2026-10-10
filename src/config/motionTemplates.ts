/**
 * Motion-graphic template catalog (Phase 7).
 *
 * A template is an aesthetic preset applied when the final styled/captioned
 * video is rendered. What each one LOOKS like — and how it moves with the
 * edit's cuts — is `src/lib/motionTemplates/templateRenderer.ts`, ported to
 * the phones (`TemplatePainter.java`, `OverlayPainter.swift`). The old Mac
 * render (`remotion/TemplatedVideo.tsx`) only knows the first three looks —
 * see `legacyTemplateId`. The requester picks one at the merged-review step; "none" (default) is a clean full-bleed video with
 * just subtitles.
 *
 * This catalog drives the picker UI, the display names, and validation.
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
  /** Names of the decoration the look draws (descriptive; renderers choose by id). */
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
    description: "กรอบมุมสีขาวที่ขยับตามจังหวะตัดต่อ ระลอกคลื่นบางๆ และแถบบอกความคืบหน้าของฉาก ดูสะอาดตาและมืออาชีพ",
    frame: "corner_bracket",
    canvas: "none",
    decor: ["corner_brackets", "ripple", "scene_progress"],
  },
  {
    id: "framed_cream",
    name: "กรอบอบอุ่น",
    description: "วางวิดีโอในกรอบมนบนพื้นหลังโทนอุ่น ลายเส้นพลิ้วไหว และเส้นสีวิ่งรอบกรอบทุกครั้งที่เปลี่ยนฉาก",
    frame: "rounded_inset",
    canvas: "palette_light",
    decor: ["wave_line", "sprig", "blobs", "card_comet"],
  },
  {
    id: "editorial",
    name: "เรียบหรู (Editorial)",
    description: "กรอบเส้นบางรอบภาพ ไล่เฉดบน-ล่าง และตัวนับฉากแบบนิตยสาร (02 / 05) ที่เลื่อนตามการตัดต่อ ดูเรียบหรู",
    frame: "full_bleed",
    canvas: "none",
    decor: ["hairline_border", "kicker", "scrims", "scene_counter"],
  },
  {
    id: "bold_pop",
    name: "ป๊อปสดใส",
    description: "แถบสีพุ่งจากมุมจอ ของตกแต่งลอยเด้ง และแถบสีปาดผ่านทุกการเปลี่ยนฉาก สนุกและเร้าใจแบบโปรโมชัน",
    // `frame` is what builds older than these looks fall back to (they choose
    // by frame when the id is unknown): corner brackets beat nothing at all.
    frame: "corner_bracket",
    canvas: "none",
    decor: ["corner_stripes", "confetti", "beat_wipe", "progress_line"],
  },
  {
    id: "cinematic",
    name: "ภาพยนตร์ (Cinematic)",
    description: "แถบดำแบบหนังโรง แสงฟุ้งเคลื่อนช้าๆ และแสงแฟลร์ผ่านทุกการเปลี่ยนฉาก ดูพรีเมียมและมีระดับ",
    frame: "corner_bracket",
    canvas: "none",
    decor: ["letterbox", "vignette", "light_leak", "beat_flare"],
  },
];

export const DEFAULT_TEMPLATE_ID = "none";

export function getTemplate(id?: string | null): MotionTemplate {
  return (
    MOTION_TEMPLATES.find((t) => t.id === (id ?? DEFAULT_TEMPLATE_ID)) ?? MOTION_TEMPLATES[0]
  );
}

/**
 * Pick one of the DECORATED templates at random (never "none").
 *
 * Used by the step-5 express lane ("approve everything from here"): the
 * requester never sees the template picker, so instead of silently shipping the
 * bare clean render they get one of the real motion-graphic looks.
 */
export function pickRandomMotionTemplateId(): string {
  const decorated = MOTION_TEMPLATES.filter((t) => t.id !== DEFAULT_TEMPLATE_ID);
  if (decorated.length === 0) return DEFAULT_TEMPLATE_ID;
  return decorated[Math.floor(Math.random() * decorated.length)].id;
}

export function isValidTemplateId(id: unknown): id is string {
  return typeof id === "string" && MOTION_TEMPLATES.some((t) => t.id === id);
}

/**
 * The nearest look the old Mac render (`remotion/TemplatedVideo.tsx`) knows,
 * for the backup pipeline: it only draws clean_frame, framed_cream and
 * editorial, and renders a newer id as no template at all.
 */
export function legacyTemplateId(id: string | null | undefined): string {
  switch (id) {
    case "bold_pop":
      return "clean_frame";
    case "cinematic":
      return "editorial";
    default:
      return id ?? DEFAULT_TEMPLATE_ID;
  }
}
