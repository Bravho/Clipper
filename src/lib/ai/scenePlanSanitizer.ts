import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

const MORPH_SCENE_PREFIX = "Morphing scene (8 seconds): ";
const URL_OR_STORAGE_PATH =
  /\b(?:https?:\/\/\S+|(?:tmp|request_mat|uploads|images|clips)\/[^\s"'<>]+)\b/gi;
const FILE_NAME =
  /(^|[\s("'`])[\w.-]+\.(?:jpe?g|png|webp|gif|heic|heif|mp4|mov|webm)\b/gi;
const IMAGE_REFERENCE =
  /\b(?:image|img|photo|picture|file)\s*(?:number|no\.?|#)?\s*\d+\b/gi;
const ENGLISH_TEXT_RENDER_INSTRUCTION =
  /\b(?:add|show|display|render|include|place|put|overlay|write|draw|create)\s+[^,;.!?。]*\b(?:text|caption|subtitle|title card|label|typography|price|cta|call[- ]to[- ]action|hashtag|words?|letters?)\b[^,;.!?。]*/gi;
const THAI_TEXT_RENDER_INSTRUCTION =
  /(?:ใส่|เพิ่ม|แสดง|ขึ้น|เขียน|พิมพ์|วาง|สร้าง|ทำ)\s*[^,;.!?。]*(?:ข้อความ|ตัวอักษร|ตัวหนังสือ|คำบรรยาย|ซับไตเติล|แคปชั่น|ป้ายข้อความ|ชื่อเรื่อง|ราคา|คำกระตุ้น|แฮชแท็ก|คำว่า)(?:(?!แล้ว)[^,;.!?。])*/g;
const TEXT_RENDER_TERMS =
  /\b(?:text overlay|on-screen text|caption|subtitle|title card|typography|cta text|hashtag)\b|(?:ข้อความบนจอ|ข้อความ|ตัวอักษร|ตัวหนังสือ|คำบรรยาย|ซับไตเติล|แคปชั่น|ป้ายข้อความ|ชื่อเรื่อง|แฮชแท็ก)/i;

function removeTextRenderInstructions(input: string): string {
  return input
    .replace(ENGLISH_TEXT_RENDER_INSTRUCTION, "")
    .replace(THAI_TEXT_RENDER_INSTRUCTION, "")
    .split(/(?<=[.!?;。])\s+|[,;]\s*/)
    .filter((part) => !TEXT_RENDER_TERMS.test(part))
    .join(" ");
}

export function sanitizeSceneDescription(input: string | null | undefined): string {
  return removeTextRenderInstructions(input ?? "")
    .replace(URL_OR_STORAGE_PATH, "")
    .replace(FILE_NAME, "$1")
    .replace(IMAGE_REFERENCE, "source visual")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeScenePlanDescriptions(scenePlan: ScenePlan[]): ScenePlan[] {
  return scenePlan.map((scene) => {
    const imageIndexes = Array.isArray(scene.imageIndexes)
      ? scene.imageIndexes.filter((idx) => Number.isInteger(idx) && idx >= 0).slice(0, 2)
      : [];
    const isMorphingScene = imageIndexes.length > 1;
    const visualDescription = scene.visualDescription
      ? sanitizeSceneDescription(scene.visualDescription)
      : scene.visualDescription;
    let visualDescriptionThai =
      sanitizeSceneDescription(scene.visualDescriptionThai) ||
      visualDescription ||
      scene.visualDescriptionThai;

    if (isMorphingScene) {
      visualDescriptionThai = visualDescriptionThai.startsWith(MORPH_SCENE_PREFIX)
        ? visualDescriptionThai
        : `${MORPH_SCENE_PREFIX}${visualDescriptionThai}`;
    }

    return {
      ...scene,
      imageIndexes,
      durationSeconds: isMorphingScene ? 8 : scene.durationSeconds,
      visualDescription,
      visualDescriptionThai,
    };
  });
}
