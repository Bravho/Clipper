/**
 * The speaking script written FROM the approved storyboard: one line per
 * scene, about that scene's pictures, held to that scene's time.
 */
const generateContent = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent } })),
}));
jest.mock("@/lib/spaces", () => ({ spacesClient: { send: jest.fn() } }));

import {
  generateScriptForStoryboard,
  sceneLineUnits,
  speakSecondsForScenes,
  type ScriptSceneTiming,
} from "@/lib/ai/chatGptVisionService";
import { countScriptUnits, unitsForVoiceSeconds } from "@/lib/ai/scriptLength";

const frame = (assetIndex: number) => ({
  localId: `l${assetIndex}`,
  assetIndex,
  mimeType: "image/jpeg" as const,
  dataBase64: "AAAA",
});

const base = {
  imageUrls: ["a", "b", "c"],
  inlineFrames: [frame(0), frame(1), frame(2)],
  description: "ร้านข้าวซอย",
  targetAudience: "",
  targetPlatforms: [],
  preferredStyle: "",
  contentLanguage: "th" as const,
};

const scenes: ScriptSceneTiming[] = [
  { sceneNumber: 1, summary: "หน้าร้าน", seconds: 6, speakSeconds: 5.4, shots: [{ assetIndex: 0, kind: "image", seconds: 6 }] },
  { sceneNumber: 2, summary: "ข้าวซอย", seconds: 8, speakSeconds: 8, shots: [{ assetIndex: 1, kind: "image", seconds: 4 }, { assetIndex: 2, kind: "clip", seconds: 4 }] },
  { sceneNumber: 3, summary: "ปิดท้าย", seconds: 4, speakSeconds: 3, shots: [{ assetIndex: 2, kind: "clip", seconds: 4 }] },
];

describe("speakSecondsForScenes", () => {
  it("takes the music intro from the first scene and the ending from the last", () => {
    expect(speakSecondsForScenes([6, 8, 4], 0.6, 1)).toEqual([5.4, 8, 3]);
  });

  it("spills into the next scene when one is too short to absorb it", () => {
    expect(speakSecondsForScenes([0.4, 5, 0.5], 0.6, 1)).toEqual([0, 4.3, 0]);
  });

  it("keeps the whole first scene for speech with no music", () => {
    expect(speakSecondsForScenes([6, 4], 0, 1)).toEqual([6, 3]);
  });
});

describe("generateScriptForStoryboard", () => {
  beforeEach(() => generateContent.mockReset());

  it("asks for a script a little LONGER than the scenes, with a hard ceiling", () => {
    const { target, max } = sceneLineUnits(10, "th");
    expect(target).toBe(unitsForVoiceSeconds(11, "th"));
    expect(max).toBe(unitsForVoiceSeconds(12, "th"));
    expect(sceneLineUnits(0.3, "th")).toEqual({ target: 0, max: 0 });
  });

  it("states every scene's length, pictures and line target to the writer", async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        scenes: [
          { sceneNumber: 1, line: "มาที่ร้านนี้กัน" },
          { sceneNumber: 2, line: "ข้าวซอยน้ำข้นหอมมาก" },
          { sceneNumber: 3, line: "แวะมาลองนะ" },
        ],
      }),
    });
    const out = await generateScriptForStoryboard({ ...base, scenes });
    const prompt = generateContent.mock.calls[0][0].contents.at(-1).text as string;
    expect(prompt).toContain("APPROVED STORYBOARD — 3 scene(s), 18.0 seconds");
    const { target, max } = sceneLineUnits(8, "th");
    expect(prompt).toContain(
      `Scene 2: 8.0 s on screen (about 8.0 s of speech); line target ${target}, maximum ${max}.`
    );
    expect(prompt).toContain("asset index 1 (image, 4.0 s), asset index 2 (clip, 4.0 s)");
    expect(out.sceneLines).toEqual(["มาที่ร้านนี้กัน", "ข้าวซอยน้ำข้นหอมมาก", "แวะมาลองนะ"]);
    expect(out.scriptThai).toBe("มาที่ร้านนี้กัน ข้าวซอยน้ำข้นหอมมาก แวะมาลองนะ");
  });

  it("holds each scene's line to that scene's time", async () => {
    const long = Array.from({ length: 20 }, () => "อร่อยมากจริงๆเลยนะ").join(" ");
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        scenes: [
          { sceneNumber: 1, line: "มาที่ร้านนี้กัน" },
          { sceneNumber: 2, line: "ข้าวซอย" },
          { sceneNumber: 3, line: long },
        ],
      }),
    });
    const out = await generateScriptForStoryboard({ ...base, scenes });
    expect(countScriptUnits(out.sceneLines[2], "th")).toBeLessThanOrEqual(sceneLineUnits(3, "th").max);
  });
});
