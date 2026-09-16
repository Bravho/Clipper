import type { StudioScriptPlan } from "./StudioPrototypeService";

export type ScriptDocumentSections = Pick<
  StudioScriptPlan,
  "title" | "mainHook" | "hooks" | "painPointsOrIntroduction" | "content" | "conversion" | "solution" | "closing"
>;

type ScriptDocumentSource = ScriptDocumentSections & {
  sections?: StudioScriptPlan["sections"];
};

/** Build only the 3–4 editable body sections; title and hook have separate inputs. */
export function formatScriptDocument(script: ScriptDocumentSource): string {
  const contextualSections = script.sections?.length
    ? script.sections.slice(0, 4)
    : [
        { topic: "สถานการณ์และสิ่งที่ผู้ชมกำลังเจอ", script: `${script.hooks} ${script.painPointsOrIntroduction}` },
        { topic: "มุมมองสำคัญที่เปลี่ยนความเข้าใจ", script: script.content },
        { topic: "ทางเลือกและผลลัพธ์ที่เป็นไปได้", script: `${script.conversion} ${script.solution}` },
        { topic: "สิ่งที่ผู้ชมทำต่อได้ทันที", script: script.closing },
      ];

  return contextualSections
    .filter((section) => section.script.trim())
    .map((section, index) => `【${index + 1}. ${section.topic.trim()}】\n${section.script.trim()}`)
    .join("\n\n");
}

/** Recover legacy fields used by Publishing from a dynamic 3–4 section body. */
export function parseScriptDocument(
  document: string,
  identity: Pick<ScriptDocumentSections, "title" | "mainHook">
): ScriptDocumentSections {
  const matches = Array.from(document.matchAll(/【[^】\n]+】/g));
  const bodies = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? document.length;
    return document.slice(start, end).trim();
  }).filter(Boolean);
  const resolvedBodies = bodies.length > 0 ? bodies : [document.trim()].filter(Boolean);
  const first = resolvedBodies[0] ?? "";
  const second = resolvedBodies[1] ?? first;
  const penultimate = resolvedBodies.at(-2) ?? second;
  const last = resolvedBodies.at(-1) ?? first;

  return {
    title: identity.title.trim(),
    mainHook: identity.mainHook.trim(),
    hooks: first,
    painPointsOrIntroduction: first,
    content: second,
    conversion: resolvedBodies.slice(1, -1).join(" ") || second,
    solution: penultimate,
    closing: last,
  };
}
