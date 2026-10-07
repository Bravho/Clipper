/**
 * Tests for the Gemini caption-chunking step: the alignment call returns short,
 * phrase-complete caption chunks; the server cleans them, checks the Thai is the
 * script verbatim and names stay whole, and retries once on a problem.
 */

const generateContentMock = jest.fn();

jest.mock("@/lib/spaces", () => ({
  spacesClient: {
    send: async () => ({
      ContentType: "audio/mpeg",
      Body: (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    }),
  },
}));
jest.mock("@/config/aiTools", () => ({
  AI_CONFIG: { gemini: { textModel: "gemini-2.5-flash" } },
  requireGeminiApiKey: () => "test-key",
}));
jest.mock("@aws-sdk/client-s3", () => ({ GetObjectCommand: class {} }));
jest.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContentMock(...args) };
  },
  Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING", NUMBER: "NUMBER", INTEGER: "INTEGER" },
}));

import {
  alignAudioWithScript,
  captionChunkProblems,
  normalizeCaptionChunks,
  splitSegmentsForDisplay,
  type TimedSegment,
} from "@/lib/ai/geminiSubtitlesService";

const SCRIPT = "ใครชอบชาบูต้องไม่พลาดเลยนะคะ เนื้อวากิวนุ่มละลายในปากจริงๆ";

const GOOD = [
  { sentenceNumber: 1, textThai: "ใครชอบชาบู", textEnglish: "Shabu lovers,", textChinese: "喜欢涮涮锅的朋友，", startSecond: 0, endSecond: 1.2 },
  { sentenceNumber: 2, textThai: "ต้องไม่พลาดเลยนะคะ", textEnglish: "don't miss this!", textChinese: "千万别错过！", startSecond: 1.2, endSecond: 2.6 },
  { sentenceNumber: 3, textThai: "เนื้อวากิวนุ่ม", textEnglish: "The wagyu is so tender", textChinese: "和牛超嫩", startSecond: 2.8, endSecond: 3.9 },
  { sentenceNumber: 4, textThai: "ละลายในปากจริงๆ", textEnglish: "it melts in your mouth.", textChinese: "真的入口即化。", startSecond: 3.9, endSecond: 5.2 },
];

const reply = (segments: unknown) => ({ text: JSON.stringify({ segments }) });

describe("normalizeCaptionChunks", () => {
  it("drops trailing Chinese pauses and leading punctuation, keeps ！", () => {
    const out = normalizeCaptionChunks(
      [
        { textThai: "ก", textEnglish: "a", textChinese: "，喜欢涮涮锅的朋友，", startSecond: 0, endSecond: 1 },
        { textThai: "ข", textEnglish: "b", textChinese: "千万别错过！", startSecond: 1, endSecond: 2 },
      ],
      5
    );
    expect(out.map((c) => c.textChinese)).toEqual(["喜欢涮涮锅的朋友", "千万别错过！"]);
  });

  it("clamps to the audio, removes overlaps, closes tiny gaps and renumbers", () => {
    const out = normalizeCaptionChunks(
      [
        { textThai: "หนึ่ง", textEnglish: "", textChinese: "", startSecond: -0.5, endSecond: 1.5 },
        { textThai: "สอง", textEnglish: "", textChinese: "", startSecond: 1.2, endSecond: 2.0 }, // overlaps
        { textThai: "สาม", textEnglish: "", textChinese: "", startSecond: 2.2, endSecond: 9 }, // tiny gap, past end
        { textThai: "", textEnglish: "", textChinese: "", startSecond: 3, endSecond: 4 }, // empty
      ],
      4
    );
    expect(out).toHaveLength(3);
    expect(out[0].startSecond).toBe(0);
    expect(out[1].startSecond).toBeCloseTo(1.5);
    expect(out[1].endSecond).toBeCloseTo(2.2); // gap closed
    expect(out[2].endSecond).toBe(4);
    expect(out.map((c) => c.sentenceNumber)).toEqual([1, 2, 3]);
  });
});

describe("captionChunkProblems", () => {
  const segs = normalizeCaptionChunks(GOOD, 6);

  it("accepts chunks that copy the script and fit one line", () => {
    expect(captionChunkProblems(segs, SCRIPT)).toEqual({ fatal: [], soft: [] });
  });

  it("flags Thai that is not the script verbatim", () => {
    const changed = segs.map((c, i) => (i === 0 ? { ...c, textThai: "ใครชอบชาบูมาก" } : c));
    expect(captionChunkProblems(changed, SCRIPT).fatal.length).toBe(1);
  });

  it("flags a protected name split across chunks", () => {
    const script = "วันนี้มาที่ครัวคุณยายค่ะ";
    const split: TimedSegment[] = [
      { sentenceNumber: 1, textThai: "วันนี้มาที่ครัว", textEnglish: "", textChinese: "", startSecond: 0, endSecond: 1 },
      { sentenceNumber: 2, textThai: "คุณยายค่ะ", textEnglish: "", textChinese: "", startSecond: 1, endSecond: 2 },
    ];
    expect(captionChunkProblems(split, script, ["ครัวคุณยาย"]).fatal).toHaveLength(1);
  });

  it("reports over-long chunks as soft problems", () => {
    const long = segs.map((c, i) => (i === 0 ? { ...c, textEnglish: "x".repeat(40) } : c));
    const p = captionChunkProblems(long, SCRIPT);
    expect(p.fatal).toEqual([]);
    expect(p.soft).toHaveLength(1);
  });
});

describe("alignAudioWithScript (Gemini chunking)", () => {
  beforeEach(() => generateContentMock.mockReset());

  const params = {
    audioUrl: "https://cdn.example.com/voice.mp3",
    scriptThai: SCRIPT,
    scriptEnglish: "Shabu lovers, don't miss this! The wagyu melts in your mouth.",
    scriptChinese: "喜欢涮涮锅的朋友千万别错过，和牛入口即化！",
    durationSeconds: 6,
    protectedPhrases: [],
  };

  it("uses the first answer when it is clean, with a response schema", async () => {
    generateContentMock.mockResolvedValueOnce(reply(GOOD));
    const out = await alignAudioWithScript(params);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock.mock.calls[0][0].config.responseSchema).toBeDefined();
    expect(out.map((c) => c.textThai).join("")).toBe(SCRIPT.replace(/\s/g, ""));
    expect(out[0].textChinese).toBe("喜欢涮涮锅的朋友");
  });

  it("retries once with the problem spelled out, and keeps the fixed answer", async () => {
    const bad = GOOD.map((c, i) => (i === 3 ? { ...c, textThai: "ละลายในปาก" } : c)); // dropped จริงๆ
    generateContentMock.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(GOOD));
    const out = await alignAudioWithScript(params);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    const retryPrompt = generateContentMock.mock.calls[1][0].contents[1].text as string;
    expect(retryPrompt).toContain("PREVIOUS ANSWER WAS REJECTED");
    expect(out[3].textThai).toBe("ละลายในปากจริงๆ");
  });

  it("keeps the first answer if the retry is worse", async () => {
    const soft = GOOD.map((c, i) => (i === 0 ? { ...c, textEnglish: "x".repeat(40) } : c));
    generateContentMock.mockResolvedValueOnce(reply(soft)).mockResolvedValueOnce(reply([]));
    const out = await alignAudioWithScript(params);
    expect(out).toHaveLength(4);
    expect(out[0].textEnglish).toBe("x".repeat(40));
  });

  it("puts the protected name into the prompt", async () => {
    generateContentMock.mockResolvedValueOnce(reply(GOOD));
    await alignAudioWithScript({ ...params, protectedPhrases: ["ครัวคุณยาย"] });
    expect(generateContentMock.mock.calls[0][0].contents[1].text).toContain('"ครัวคุณยาย"');
  });

  it("chunks that fit one line are not re-split for display", async () => {
    generateContentMock.mockResolvedValueOnce(reply(GOOD));
    const out = await alignAudioWithScript(params);
    expect(splitSegmentsForDisplay(out, ["th", "en", "zh"])).toEqual(out);
  });
});
