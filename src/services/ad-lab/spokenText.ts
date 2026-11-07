import type { AdLabScriptDraft } from "@/domain/models/AdLab";

/** Section headers such as "\u30101. topic\u3011" are visual labels, never spoken. */
const SECTION_HEADER = /\u3010[^\u3011]*\u3011/g;

/** Strip section headers, collapse spaces/tabs, drop blank lines. */
export function normalizeSpokenText(raw: string): string {
  return raw
    .replace(SECTION_HEADER, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();
}

/**
 * Drafts saved by the first version of the avatar script editor (Oct 2026)
 * moved the first edited line into mainHook and the rest into scriptPlan,
 * clearing scriptPlanHtml. Create-generated bodies always carry section
 * headers (formatScriptDocument), so "no HTML + no headers + body does not
 * already start with the hook" identifies those drafts; for them the hook is
 * the user's own first line and must still be spoken once.
 */
export function isLegacyAvatarSplitEdit(draft: AdLabScriptDraft): boolean {
  const hook = (draft.mainHook ?? "").trim();
  const body = draft.scriptPlan ?? "";
  if (!hook || !body.trim() || draft.scriptPlanHtml) return false;
  if (new RegExp(SECTION_HEADER.source).test(body)) return false;
  return !normalizeSpokenText(body).startsWith(normalizeSpokenText(hook));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain lines in the same <div>-per-line shape the Create editor produces. */
export function plainTextToEditorHtml(text: string): string {
  return text.split("\n").map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

/**
 * Map a user-edited spoken text back onto a draft: the whole text becomes the
 * script body (scriptPlan); mainHook is left untouched (no split, no re-add).
 * scriptPlanHtml is rebuilt as plain lines so the Create editor shows the
 * edited text (old emphasis/size formatting no longer matches it).
 * Guarantees buildSpokenText(result) === normalizeSpokenText(newText).
 */
export function applySpokenTextEdit(draft: AdLabScriptDraft, newText: string): AdLabScriptDraft {
  const scriptPlan = normalizeSpokenText(newText);
  return { ...draft, scriptPlan, scriptPlanHtml: plainTextToEditorHtml(scriptPlan) };
}

/**
 * The text the voice step speaks: exactly the script body shown on the Create
 * page (scriptPlan, headers stripped). The Main Hook is a separate field and
 * is NOT prepended, except for legacy avatar-editor splits (see above).
 * Drafts without scriptPlan fall back to the legacy body fields (no mainHook).
 * No node imports - safe in browser/edge runtimes.
 */
export function buildSpokenText(draft: AdLabScriptDraft): string {
  if (draft.scriptPlan && draft.scriptPlan.trim()) {
    const raw = isLegacyAvatarSplitEdit(draft)
      ? `${draft.mainHook}\n${draft.scriptPlan}`
      : draft.scriptPlan;
    return normalizeSpokenText(raw);
  }
  return normalizeSpokenText(
    [
      draft.hooks,
      draft.painPointsOrIntroduction,
      draft.content,
      draft.solution,
      draft.conversion,
      draft.closing,
    ]
      .filter(Boolean)
      .join("\n")
  );
}