import { GoogleGenAI, Type } from "@google/genai";

import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";
import {
  subjectFromBox2d,
  unionBoxes,
  type ShotFocusBoxes,
  type SubjectBox,
} from "@/lib/mobile/shotFraming";

/**
 * Where the subject is in each SHOT of the storyboard, for framing the video in
 * every channel shape (see `frameForShape`).
 *
 * The phone sends one small frame for a photo and a few for a clip, taken from
 * inside the shot's own trimmed window — the part that is actually in the
 * video. A clip's poster frame is its first quarter-second, which is often not
 * where the product is by the time the shot plays. Frames are small JPEGs made
 * on the phone (like the storyboard's derivatives); nothing is stored.
 *
 * For each frame the AI gives two boxes: the subject, which must never be cut,
 * and the subject with the context that makes the shot, which is kept when the
 * shape allows. A clip's boxes are the union over its frames, so a dish that
 * moves through the shot stays in view the whole time.
 */

export interface ShotFramesInput {
  /** Base64 JPEG/PNG/WebP frames from inside the shot, at most a few. */
  frames: { data: string; mimeType: string }[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    frames: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          frame: { type: Type.INTEGER },
          subject: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          keep: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        },
        required: ["frame", "subject"],
      },
    },
  },
  required: ["frames"],
};

const PROMPT = `These are frames from a short promotional video for a small business (restaurant, cafe, shop, spa, hotel). Each frame is labelled "Frame N".

The video will be cropped to other shapes (tall 9:16, wide 16:9, square 1:1, 4:5). For every frame, mark what the crop must keep:
- "subject": the main thing being promoted — the dish or drink, the product, the sign, the room or the treatment — the WHOLE of it, including the plate, glass or package edges. If several items are the point of the shot (a table of dishes), include all of them. If a person is presenting the product, the subject is the product, not the person.
- "keep": the subject plus the context that makes the shot work: the hands holding it, the presenter's face, readable text or a logo next to it. Leave out empty background, walls, ceiling and floor.

Give each box as box_2d [ymin, xmin, ymax, xmax], integers 0–1000 relative to that frame. Return one entry per frame, with "frame" set to its label number. If nothing in a frame is worth keeping, box the most interesting area.`;

/**
 * Boxes for each shot, in input order; null where the AI found nothing usable.
 * Throws on an AI or network error — the caller fails open.
 */
export async function detectShotFocusBoxes(
  shots: ShotFramesInput[]
): Promise<(ShotFocusBoxes | null)[]> {
  // Number every frame across all shots, remembering whose it is.
  const owner: number[] = [];
  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
  shots.forEach((shot, shotIndex) => {
    for (const frame of shot.frames) {
      owner.push(shotIndex);
      parts.push({ text: `Frame ${owner.length}:` });
      parts.push({ inlineData: { data: frame.data, mimeType: frame.mimeType } });
    }
  });
  if (owner.length === 0) return shots.map(() => null);
  parts.push({ text: PROMPT });

  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  const response = await ai.models.generateContent({
    model: AI_CONFIG.gemini.visionModel,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
      // Box finding needs no reasoning; thinking only adds cost and latency.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const raw = response.text ?? "";
  if (!raw) throw new Error("Gemini shot framing returned an empty response");
  return shotBoxesFromAnswer(JSON.parse(raw), owner, shots.length);
}

/**
 * Turn the AI's per-frame answer into per-shot boxes. Pure, for testing.
 * Entries are matched by their frame LABEL, never by position, so a skipped
 * frame cannot shift every later box onto the wrong shot.
 */
export function shotBoxesFromAnswer(
  answer: unknown,
  owner: number[],
  shotCount: number
): (ShotFocusBoxes | null)[] {
  const subjects: SubjectBox[][] = Array.from({ length: shotCount }, () => []);
  const keeps: SubjectBox[][] = Array.from({ length: shotCount }, () => []);
  const entries = (answer as { frames?: unknown })?.frames;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { frame, subject, keep } = entry as { frame?: unknown; subject?: unknown; keep?: unknown };
      const label = Number(frame);
      if (!Number.isInteger(label) || label < 1 || label > owner.length) continue;
      const shot = owner[label - 1];
      const subjectBox = subjectFromBox2d(subject);
      if (!subjectBox) continue;
      subjects[shot].push(subjectBox);
      keeps[shot].push(subjectFromBox2d(keep) ?? subjectBox);
    }
  }
  return subjects.map((list, shot) => {
    const subject = unionBoxes(list);
    if (!subject) return null;
    return { subject, keep: unionBoxes([...keeps[shot], subject]) };
  });
}
