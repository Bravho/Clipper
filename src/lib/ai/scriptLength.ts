/**
 * How much speaking script fits a given number of seconds — counted in code,
 * not left to the model.
 *
 * WHY. The script prompt used to say "about 2.5–3 Thai words per second". Thai
 * has no spaces between words, so neither the model nor anyone else can count
 * "words" in it, and the model reliably overshot: the voice made from the script
 * came out longer than the picked scenes could cover. The budget is now a hard
 * number of countable units per language, stated in the prompt AND checked
 * after generation (one "shorten it" retry, then a sentence-boundary trim).
 *
 * Units and rates (deliberately on the slow side of an AI voice, so a script
 * at the limit still finishes inside the material):
 *   - Thai: spoken letters — Thai characters without the stacked vowel and
 *     tone marks, which add no length to speech. An AI Thai voice says about
 *     10 of these a second; the budget allows 8.
 *   - Vietnamese: syllables (Vietnamese writes one syllable per word), ~3/s.
 *   - English: words, ~2.2/s.
 */
import type { AppLocale } from "@/i18n/config";

export type ScriptLanguage = "th" | "en" | "vi";

/** Units per second the budget allows. */
export const SCRIPT_UNITS_PER_SECOND: Record<ScriptLanguage, number> = {
  th: 8,
  vi: 3,
  en: 2.2,
};

/** Thai marks written above/below a letter: no extra spoken length. */
const THAI_STACKED_MARKS = /[ัิ-ฺ็-๎]/g;
const THAI_LETTER = /[ก-ะาำเ-ๆ๐-๙]/g;

export function scriptLanguageOf(locale: AppLocale | string | null | undefined): ScriptLanguage {
  return locale === "en" || locale === "vi" ? locale : "th";
}

/** How the budget is counted, in words for the prompt. */
export function scriptUnitName(language: ScriptLanguage): string {
  switch (language) {
    case "th":
      return "Thai letters (count consonants and vowels written on the line; do not count spaces, punctuation, or vowel/tone marks written above or below a letter)";
    case "vi":
      return "Vietnamese syllables (space-separated words)";
    default:
      return "English words";
  }
}

/** Countable units in a script. */
export function countScriptUnits(text: string, language: ScriptLanguage): number {
  const clean = text.normalize("NFC").trim();
  if (!clean) return 0;
  if (language === "th") {
    const thai = clean.replace(THAI_STACKED_MARKS, "").match(THAI_LETTER)?.length ?? 0;
    // Latin words or digits that slipped through still take time to say.
    const other = clean.replace(/[฀-๿]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    return thai + other * 4;
  }
  return clean.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The most units a script for `seconds` of voice may have. */
export function maxScriptUnits(seconds: number, language: ScriptLanguage): number {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 15;
  return Math.max(1, Math.floor(safe * SCRIPT_UNITS_PER_SECOND[language]));
}

export function scriptFits(text: string, seconds: number, language: ScriptLanguage): boolean {
  return countScriptUnits(text, language) <= maxScriptUnits(seconds, language);
}

/**
 * Last resort: keep whole sentences/phrases from the start while they fit, and
 * keep the closing sentence (the gentle call-to-action) when it fits too.
 * Thai separates phrases with spaces, so a space is a phrase boundary there.
 */
export function trimScriptToFit(text: string, seconds: number, language: ScriptLanguage): string {
  const max = maxScriptUnits(seconds, language);
  if (countScriptUnits(text, language) <= max) return text;

  const pieces = (
    language === "th"
      ? text.split(/(?<=\s)/)
      : text.split(/(?<=[.!?…])\s+/)
  ).map((p) => p.trim()).filter(Boolean);
  if (pieces.length <= 1) return text;

  const joiner = " ";
  const closing = pieces[pieces.length - 1];
  const closingUnits = countScriptUnits(closing, language);
  const room = closingUnits < max / 3 ? max - closingUnits : max;

  const kept: string[] = [];
  let used = 0;
  for (const piece of pieces.slice(0, -1)) {
    const units = countScriptUnits(piece, language);
    if (used + units > room) break;
    kept.push(piece);
    used += units;
  }
  if (room !== max) kept.push(closing);
  if (kept.length === 0) kept.push(pieces[0]);
  return kept.join(joiner).trim();
}
