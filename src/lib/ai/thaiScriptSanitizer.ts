const INVISIBLE_MARKS = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const LEADING_WRAPPER = /^(?:```(?:json|text|thai)?|["'`“”‘’«»]+)\s*/i;
const TRAILING_WRAPPER = /\s*(?:```|["'`“”‘’«»]+)$/;
const LEADING_BRACKETED_NON_THAI = /^(?:\[[^\]\u0E00-\u0E7F]*\]|\([^)\u0E00-\u0E7F]*\)|【[^】\u0E00-\u0E7F]*】)\s*/;
const LEADING_LABEL =
  /^(?:(?:thai|script|spoken\s+script|voice\s*over|voiceover|tts|hook|caption|ภาษาไทย|สคริปต์|บทพูด|เสียงพากย์|คำพูด)\s*)[:：\-–—]\s*/i;
const LEADING_LIST_MARKER = /^(?:[-*•]+|\d+[.)]|[๐-๙]+[.)])\s*/;

/**
 * Cleans AI/requester text before Thai TTS. ElevenLabs can pronounce the
 * opening words with an English accent when the script starts with labels,
 * timing tags, invisible marks, or Latin-only wrappers such as "Thai:".
 */
export function sanitizeThaiVoiceScript(input: string): string {
  let text = input
    .normalize("NFC")
    .replace(INVISIBLE_MARKS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text
      .replace(LEADING_WRAPPER, "")
      .replace(LEADING_BRACKETED_NON_THAI, "")
      .replace(LEADING_LABEL, "")
      .replace(LEADING_LIST_MARKER, "")
      .trim();
  }

  const firstThaiIndex = text.search(/[\u0E00-\u0E7F]/);
  if (firstThaiIndex > 0) {
    const prefix = text.slice(0, firstThaiIndex);
    if (!/[\u0E00-\u0E7F]/.test(prefix)) {
      text = text.slice(firstThaiIndex).trim();
    }
  }

  return text.replace(TRAILING_WRAPPER, "").replace(/\s+/g, " ").trim();
}
