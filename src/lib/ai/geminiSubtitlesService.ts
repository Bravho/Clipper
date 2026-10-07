import { GoogleGenAI, Type } from "@google/genai";
import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";
import { spacesClient } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export interface TimedSegment {
  sentenceNumber: number;
  textThai: string;
  textEnglish: string;
  /** Optional for legacy subtitle timelines created before Chinese support. */
  textChinese?: string;
  startSecond: number;
  endSecond: number;
}

export interface ImageCoordinates {
  ymin: number; // 0 to 1000
  xmin: number; // 0 to 1000
  ymax: number; // 0 to 1000
  xmax: number; // 0 to 1000
}

/** Extract Spaces storage key from public URL */
function extractStorageKey(url: string): string {
  const bucket = process.env.DO_SPACES_BUCKET ?? "";
  const cdnEndpoint = process.env.DO_SPACES_CDN_ENDPOINT;
  if (cdnEndpoint && url.startsWith(cdnEndpoint)) {
    return url.slice(cdnEndpoint.length).replace(/^\//, "");
  }
  const parts = url.split(`/${bucket}/`);
  if (parts.length >= 2) return parts.slice(1).join(`/${bucket}/`);
  return url.replace(/^https?:\/\/[^/]+\//, "");
}

/** Download file from DO Spaces as base64 */
async function downloadAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const key = extractStorageKey(url);
  const bucket = process.env.DO_SPACES_BUCKET!;
  const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return {
    data: buffer.toString("base64"),
    mimeType: res.ContentType ?? "application/octet-stream",
  };
}

/**
 * Per-language budget for ONE caption chunk returned by the alignment call.
 * Each chunk is shown as one on-screen line, so these match the phone /
 * Remotion one-line budgets (`maxChars` in `deviceRenderCaptions.ts` and
 * `LANG_STYLE` in `remotion/TemplatedVideo.tsx`): a chunk inside them is never
 * re-split by `splitSegmentsForDisplay` nor re-wrapped by the renderers, so
 * the break Gemini chose is the break the viewer sees. Thai is counted the way
 * the renderers count it — every code point, vowel and tone marks included.
 */
export const CAPTION_CHUNK_LIMITS: Record<SubtitleLanguage, number> = {
  th: 26,
  en: 30,
  zh: 16,
};

/** Gaps between chunks shorter than this are closed so captions don't flicker. */
const MAX_CLOSED_GAP_SECONDS = 0.35;

/** Chinese punctuation that must not start a caption line. */
const ZH_NO_LEADING = /^[，。！？、；：,.!?;:）」』】》〉…·\s]+/;
/** Trailing Chinese pauses dropped from a caption (subtitle convention). Keeps ！？ */
const ZH_DROP_TRAILING = /[，。、；：,.;:\s]+$/;

function buildAlignmentPrompt(params: {
  scriptThai: string;
  scriptEnglish: string;
  scriptChinese?: string;
  durationSeconds: number;
  protectedPhrases: string[];
  feedback?: string;
}): string {
  const protectedLine = params.protectedPhrases.length
    ? `- NEVER split these names across two chunks; each must sit whole inside one chunk: ${params.protectedPhrases
        .map((p) => `"${p}"`)
        .join(", ")}.\n`
    : "";
  const chinese = params.scriptChinese
    ? `Chinese (Simplified) translation: "${params.scriptChinese}"`
    : "No Chinese translation is given — translate each chunk into natural Simplified Chinese yourself.";
  const feedback = params.feedback
    ? `\nYOUR PREVIOUS ANSWER WAS REJECTED: ${params.feedback}\nFix exactly that and answer again.\n`
    : "";

  return `You are making on-screen SUBTITLES for a short social-media video. Listen to this Thai voice-over (exactly ${params.durationSeconds} seconds long) and cut its script into short caption CHUNKS, each one shown on screen as ONE line while it is being spoken.

Thai script (what is spoken): "${params.scriptThai}"
English translation: "${params.scriptEnglish}"
${chinese}

HOW TO CUT THE THAI INTO CHUNKS
- Copy the Thai script EXACTLY, in order. Joined together, the chunks' textThai must equal the script (spaces may be dropped). Do not add, remove, fix or reorder any Thai character.
- Each chunk is one natural spoken phrase — break where a Thai speaker pauses: at a space in the script, or between clauses.
- Each textThai is at most ${CAPTION_CHUNK_LIMITS.th} characters counting EVERY Thai character including vowel and tone marks (about 3–6 words).
- NEVER break inside a word, a compound word or a loanword (e.g. ร้านอาหาร, น้ำซุป, เข้มข้น, เริ่มต้น, ชาบู, วากิว, บุฟเฟ่ต์, คาเฟ่), a menu item, a person or place name, or a brand.
- NEVER start a chunk with a particle or repeat mark (ครับ, ค่ะ, คะ, นะ, จ้า, เลย, ด้วย, ๆ) — keep it with the word before it.
- NEVER end a chunk on a word that needs what follows (ที่, ของ, และ, กับ, ใน, แต่, ก็, จะ, ไม่, การ, ความ, ให้, ว่า, แค่).
- Keep a number with its unit (50 บาท, 10 นาที, 2 คน).
${protectedLine}- No chunk may be shorter than 2 words unless it is the whole sentence.

TRANSLATIONS PER CHUNK
- textEnglish and textChinese must translate THAT chunk only, so all three lines mean the same thing at the same moment. Use the given translations as the source, re-cut to match the Thai chunks; light rewording for natural word order is fine, but keep the overall meaning.
- textEnglish: at most ${CAPTION_CHUNK_LIMITS.en} characters; do not end a chunk on "the", "a", "at", "in", "of", "to", "and"; keep numbers with their units and names whole.
- textChinese: Simplified Chinese, at most ${CAPTION_CHUNK_LIMITS.zh} characters; never start with punctuation; no trailing ，or 。; keep numbers with their measure words and names whole.

TIMING
- startSecond / endSecond: when that chunk is actually spoken in the audio, in seconds (e.g. 1.25). Chunks are in order and do not overlap; all times are between 0 and ${params.durationSeconds}.
${feedback}
Return ONLY JSON: { "segments": [ { "sentenceNumber": 1, "textThai": "...", "textEnglish": "...", "textChinese": "...", "startSecond": 0.0, "endSecond": 1.8 } ] }`;
}

const ALIGNMENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sentenceNumber: { type: Type.INTEGER },
          textThai: { type: Type.STRING },
          textEnglish: { type: Type.STRING },
          textChinese: { type: Type.STRING },
          startSecond: { type: Type.NUMBER },
          endSecond: { type: Type.NUMBER },
        },
        required: ["sentenceNumber", "textThai", "textEnglish", "textChinese", "startSecond", "endSecond"],
        propertyOrdering: ["sentenceNumber", "textThai", "textEnglish", "textChinese", "startSecond", "endSecond"],
      },
    },
  },
  required: ["segments"],
};

const compactThai = (s: string) => s.normalize("NFC").replace(/\s+/g, "");
const codePoints = (s: string) => Array.from(s).length;

/**
 * Clean up Gemini's caption chunks: drop empties, coerce numbers, clamp to the
 * audio, put them in order without overlaps, close tiny gaps, tidy Chinese
 * punctuation and renumber. Pure — exported for tests.
 */
export function normalizeCaptionChunks(raw: unknown, durationSeconds: number): TimedSegment[] {
  const list = Array.isArray(raw) ? raw : [];
  const duration = durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const chunks = list
    .map((item) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const start = num(r.startSecond);
      const end = num(r.endSecond);
      return {
        textThai: str(r.textThai).normalize("NFC"),
        textEnglish: str(r.textEnglish).replace(/\s+/g, " "),
        textChinese: str(r.textChinese).replace(ZH_NO_LEADING, "").replace(ZH_DROP_TRAILING, ""),
        startSecond: Number.isFinite(start) ? Math.max(0, Math.min(duration, start)) : NaN,
        endSecond: Number.isFinite(end) ? Math.max(0, Math.min(duration, end)) : NaN,
      };
    })
    .filter((c) => c.textThai || c.textEnglish || c.textChinese)
    .filter((c) => Number.isFinite(c.startSecond) && Number.isFinite(c.endSecond));

  // Keep Gemini's order (it follows the script); only repair the times.
  const out: TimedSegment[] = [];
  let cursor = 0;
  for (const c of chunks) {
    const start = Math.max(c.startSecond, cursor);
    let end = Math.max(c.endSecond, start);
    if (end - start < 0.2) end = Math.min(duration, start + 0.2);
    if (!(end > start)) continue;
    const prev = out[out.length - 1];
    if (prev && start - prev.endSecond > 0 && start - prev.endSecond < MAX_CLOSED_GAP_SECONDS) {
      prev.endSecond = start;
    }
    out.push({ sentenceNumber: out.length + 1, ...c, startSecond: start, endSecond: end });
    cursor = end;
  }
  return out;
}

/**
 * Problems with a set of caption chunks, worst first. An empty list means the
 * chunks can be used as they are. Pure — exported for tests.
 */
export function captionChunkProblems(
  chunks: TimedSegment[],
  scriptThai: string,
  protectedPhrases: string[] = []
): { fatal: string[]; soft: string[] } {
  const fatal: string[] = [];
  const soft: string[] = [];
  if (chunks.length === 0) {
    fatal.push("no usable segments were returned");
    return { fatal, soft };
  }
  const joined = compactThai(chunks.map((c) => c.textThai).join(""));
  if (joined !== compactThai(scriptThai)) {
    fatal.push(
      "the textThai chunks joined together do not equal the Thai script exactly — copy it character for character"
    );
  }
  for (const phrase of protectedPhrases.map(compactThai).filter(Boolean)) {
    if (!compactThai(scriptThai).includes(phrase)) continue;
    if (!chunks.some((c) => compactThai(c.textThai).includes(phrase))) {
      fatal.push(`the name "${phrase}" was split across chunks`);
    }
  }
  const tooLong = (lang: SubtitleLanguage, field: keyof TimedSegment) =>
    chunks
      .map((c) => String(c[field] ?? ""))
      .filter((t) => codePoints(t) > CAPTION_CHUNK_LIMITS[lang]);
  const longTh = tooLong("th", "textThai");
  if (longTh.length) soft.push(`these Thai chunks are longer than ${CAPTION_CHUNK_LIMITS.th} characters: ${longTh.map((t) => `"${t}"`).join(", ")}`);
  const longEn = tooLong("en", "textEnglish");
  if (longEn.length) soft.push(`these English chunks are longer than ${CAPTION_CHUNK_LIMITS.en} characters: ${longEn.map((t) => `"${t}"`).join(", ")}`);
  const longZh = tooLong("zh", "textChinese");
  if (longZh.length) soft.push(`these Chinese chunks are longer than ${CAPTION_CHUNK_LIMITS.zh} characters: ${longZh.map((t) => `"${t}"`).join(", ")}`);
  return { fatal, soft };
}

/**
 * Align the voice track with its script AND cut it into subtitle chunks, in one
 * Gemini call. Gemini does the phrasing (where a Thai line may break, and the
 * matching English / Chinese for each chunk) because a dictionary word splitter
 * cuts Thai loanwords and compounds mid-word and cannot keep the three
 * languages saying the same thing at the same moment.
 *
 * The chunks are checked: the Thai must be the script verbatim (or the
 * captions would not match the voice), protected names must stay whole, and
 * every chunk should fit one line. On a problem the call is retried ONCE with
 * the problem spelled out; the better of the two answers is kept, and anything
 * still too long is split later by `splitSegmentsForDisplay` as a safety net.
 */
export async function alignAudioWithScript(params: {
  audioUrl: string;
  scriptThai: string;
  scriptEnglish: string;
  scriptChinese?: string;
  durationSeconds: number;
  /** Names that must never be split across captions (e.g. the place name). */
  protectedPhrases?: string[];
}): Promise<TimedSegment[]> {
  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  const { data, mimeType } = await downloadAsBase64(params.audioUrl);
  const protectedPhrases = (params.protectedPhrases ?? []).map((p) => p.trim()).filter(Boolean);

  const attempt = async (feedback?: string) => {
    const response = await ai.models.generateContent({
      model: AI_CONFIG.gemini.textModel,
      contents: [
        { inlineData: { data, mimeType } },
        { text: buildAlignmentPrompt({ ...params, protectedPhrases, feedback }) },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: ALIGNMENT_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });
    const raw = response.text ?? "";
    if (!raw) throw new Error("Gemini audio alignment returned empty response");
    const segments = normalizeCaptionChunks(JSON.parse(raw)?.segments, params.durationSeconds);
    return { segments, problems: captionChunkProblems(segments, params.scriptThai, protectedPhrases) };
  };

  const first = await attempt();
  if (first.problems.fatal.length === 0 && first.problems.soft.length === 0) return first.segments;

  let second: Awaited<ReturnType<typeof attempt>> | null = null;
  try {
    second = await attempt([...first.problems.fatal, ...first.problems.soft].join("; "));
  } catch (err) {
    console.warn("[GeminiAlignment] retry failed, keeping first answer:", err);
  }

  const score = (r: Awaited<ReturnType<typeof attempt>>) =>
    r.problems.fatal.length * 100 + r.problems.soft.length;
  const best = second && score(second) <= score(first) ? second : first;
  if (best.problems.fatal.length || best.problems.soft.length) {
    console.warn("[GeminiAlignment] caption chunks kept with problems:", best.problems);
  }
  if (best.segments.length === 0) throw new Error("Gemini audio alignment returned no usable segments");
  return best.segments;
}

/**
 * Detect coordinates of primary subject/product in images.
 */
export async function detectProductCoordinates(
  imageUrls: string[]
): Promise<ImageCoordinates[]> {
  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });

  const imageParts = await Promise.all(
    imageUrls.map(async (url) => {
      const { data, mimeType } = await downloadAsBase64(url);
      return { inlineData: { data, mimeType } };
    })
  );

  const prompt = `Locate the main focus object or physical product (such as a dish of food, cafe sign, spa table, hotel bed, product package) in each image.
  For each image index, return the bounding box coordinates using normalized values from 0 to 1000 relative to the image borders:
  - ymin: Top edge (0 to 1000)
  - xmin: Left edge (0 to 1000)
  - ymax: Bottom edge (0 to 1000)
  - xmax: Right edge (0 to 1000)

  Return ONLY a valid JSON object matching this schema:
  {
    "coordinates": [
      {
        "ymin": number,
        "xmin": number,
        "ymax": number,
        "xmax": number
      }
    ]
  }`;

  const contents = [...imageParts, { text: prompt }];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.gemini.textModel, // "gemini-2.0-flash"
    contents,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const raw = response.text ?? "";
  if (!raw) throw new Error("Gemini coordinates detection returned empty response");

  const parsed = JSON.parse(raw);
  return parsed.coordinates as ImageCoordinates[];
}

/** Helper to format seconds to ASS timestamp format (H:MM:SS.cs) */
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export type SubtitleLanguage = "th" | "en" | "zh";

/** Per-language style definitions, stacked top-to-bottom by MarginV. */
const SUBTITLE_STYLES: Record<
  SubtitleLanguage,
  { name: string; field: keyof TimedSegment; styleLine: string }
> = {
  th: {
    name: "ThaiStyle",
    field: "textThai",
    styleLine: "Style: ThaiStyle,Prompt,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,50,50,300,1",
  },
  en: {
    name: "EngStyle",
    field: "textEnglish",
    styleLine: "Style: EngStyle,Prompt,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,50,50,200,1",
  },
  zh: {
    name: "ChiStyle",
    field: "textChinese",
    styleLine: "Style: ChiStyle,Microsoft YaHei,42,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,50,50,100,1",
  },
};

/**
 * Maximum characters a single on-screen caption cue should hold PER LANGUAGE
 * before it is split into multiple sequential cues. These are deliberately
 * conservative (roughly one short line, ~two at most) because up to three
 * language lines are stacked on screen at once — a long sentence rendered as a
 * single cue wraps into many lines and overlaps the language above it. CJK
 * glyphs are wider and Thai has no word spaces, so both get lower limits.
 */
const MAX_CHARS_PER_CUE: Record<SubtitleLanguage, number> = {
  th: 30,
  en: 42,
  zh: 16,
};

/** Never split one sentence into more than this many cues (guards odd inputs). */
const MAX_CUES_PER_SEGMENT = 6;

/**
 * Minimal typed accessor for `Intl.Segmenter` so this compiles regardless of the
 * project's TS `lib` setting (older libs don't declare `Intl.Segmenter`).
 */
type SegmenterLike = { segment: (s: string) => Iterable<{ segment: string }> };
const SegmenterCtor = (
  Intl as unknown as {
    Segmenter?: new (locale: string, opts: { granularity: "word" }) => SegmenterLike;
  }
).Segmenter;

/**
 * Break text into word-like tokens for cue splitting:
 *  - English: whitespace-delimited words (joined back with a space).
 *  - Thai/Chinese: these scripts have NO inter-word spaces, so a naive
 *    character split cuts words in half (e.g. an orphaned "ะ" or a fragment like
 *    "ทานค"). We use the built-in `Intl.Segmenter` (ICU dictionary-based word
 *    segmentation) — free and no external service — to get real word boundaries,
 *    joined back with no space. Falls back to per-character if ICU word data is
 *    unavailable, so behavior degrades gracefully rather than breaking.
 */
function tokenizeForDisplay(
  text: string,
  lang: SubtitleLanguage
): { units: string[]; joiner: string } {
  if (lang === "en") {
    return { units: text.split(/\s+/).filter(Boolean), joiner: " " };
  }
  const locale = lang === "zh" ? "zh" : "th";
  if (SegmenterCtor) {
    try {
      const segmenter = new SegmenterCtor(locale, { granularity: "word" });
      const units = Array.from(segmenter.segment(text), (s) => s.segment).filter(
        (u) => u.length > 0
      );
      if (units.length > 0) return { units, joiner: "" };
    } catch {
      /* ICU word segmentation unavailable — fall through to per-character */
    }
  }
  return { units: Array.from(text), joiner: "" };
}

/**
 * Split `text` into exactly `n` contiguous pieces on WORD boundaries (never
 * mid-word). Some pieces may be empty when the text has fewer units than `n` —
 * callers tolerate empty cue lines (they render nothing for that window).
 */
function splitTextIntoParts(
  text: string,
  n: number,
  lang: SubtitleLanguage,
  protectedPhrases: string[]
): string[] {
  const trimmed = text.trim();
  if (n <= 1) return [trimmed];
  const replacements = new Map<string, string>();
  let protectedText = trimmed.normalize("NFC");
  protectedPhrases
    .map((phrase) => phrase.trim().normalize("NFC"))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .forEach((phrase, index) => {
      const placeholder = `RCLIPPERPROTECTED${index}TOKEN`;
      if (!protectedText.includes(phrase)) return;
      replacements.set(placeholder, phrase);
      protectedText = protectedText.split(phrase).join(placeholder);
    });

  const tokenized = tokenizeForDisplay(protectedText, lang);
  const units = tokenized.units.map((unit) => {
    let restored = unit;
    for (const [placeholder, phrase] of replacements) {
      restored = restored.split(placeholder).join(phrase);
    }
    return restored;
  });
  const { joiner } = tokenized;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * units.length) / n);
    const end = Math.floor(((i + 1) * units.length) / n);
    parts.push(units.slice(start, end).join(joiner));
  }
  return parts;
}

/**
 * Break long timed segments into shorter, readable subtitle cues BEFORE they
 * are rendered (ASS burn-in or the Remotion caption overlay).
 *
 * The alignment step returns one segment per SENTENCE, which can be long enough
 * to wrap into several lines and collide with the other stacked language lines.
 * Here each segment whose text exceeds the per-language cue limit is divided
 * into the fewest cues that bring every ACTIVE language under its limit, and the
 * segment's time window is distributed across those cues (weighted by cue length
 * so longer phrases stay on screen longer). All languages are split into the
 * SAME number of cues sharing the SAME time boundaries, so the lines stay
 * synchronised with each other and with the voiceover.
 *
 * NOTE: this operates on the SUBTITLE timeline only — it does NOT touch the
 * speaking script sent to TTS, so the voiceover keeps its natural full-sentence
 * prosody. Splitting belongs here (the display/timeline stage), not in the
 * voice-script generation stage.
 */
export function splitSegmentsForDisplay(
  segments: TimedSegment[],
  languages: SubtitleLanguage[] = ["en", "zh"],
  protectedPhrases: string[] = []
): TimedSegment[] {
  const active = languages.length > 0 ? languages : (["en", "zh"] as SubtitleLanguage[]);

  const out: TimedSegment[] = [];
  for (const seg of segments) {
    const textByLang: Record<SubtitleLanguage, string> = {
      th: ((seg.textThai as string) ?? "").trim(),
      en: ((seg.textEnglish as string) ?? "").trim(),
      zh: ((seg.textChinese as string) ?? "").trim(),
    };

    // Fewest cues that bring every active language under its per-cue limit.
    let cueCount = 1;
    for (const lang of active) {
      const len = Array.from(textByLang[lang]).length;
      if (len === 0) continue;
      cueCount = Math.max(cueCount, Math.ceil(len / MAX_CHARS_PER_CUE[lang]));
    }
    cueCount = Math.min(cueCount, MAX_CUES_PER_SEGMENT);

    const span = seg.endSecond - seg.startSecond;
    if (cueCount <= 1 || !(span > 0)) {
      out.push(seg);
      continue;
    }

    const partsByLang: Record<SubtitleLanguage, string[]> = {
      th: splitTextIntoParts(textByLang.th, cueCount, "th", protectedPhrases),
      en: splitTextIntoParts(textByLang.en, cueCount, "en", protectedPhrases),
      zh: splitTextIntoParts(textByLang.zh, cueCount, "zh", protectedPhrases),
    };

    // Time weights from the first active language that has text (fall back to
    // equal weighting), so cue durations track how much text each cue shows.
    const refLang = active.find((l) => textByLang[l]) ?? active[0];
    const weights = partsByLang[refLang].map((p) => Math.max(1, Array.from(p).length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let accWeight = 0;
    for (let i = 0; i < cueCount; i++) {
      const cueStart = seg.startSecond + (span * accWeight) / totalWeight;
      accWeight += weights[i];
      const cueEnd = seg.startSecond + (span * accWeight) / totalWeight;
      out.push({
        sentenceNumber: seg.sentenceNumber,
        textThai: partsByLang.th[i] ?? "",
        textEnglish: partsByLang.en[i] ?? "",
        textChinese: partsByLang.zh[i] ?? "",
        startSecond: cueStart,
        endSecond: cueEnd,
      });
    }
  }
  return out;
}

/**
 * Generate a .ass subtitle file content containing only the requested
 * subtitle languages, stacked top-to-bottom (Thai above English above
 * Chinese). Segments missing a requested language's text (e.g. legacy
 * timelines without textChinese) simply omit that line.
 *
 * Defaults to English + Simplified Chinese, matching the Travy App
 * requirement.
 */
export function generateAssSubtitles(
  segments: TimedSegment[],
  languages: SubtitleLanguage[] = ["en", "zh"]
): string {
  const activeLanguages = languages.length > 0 ? languages : (["en", "zh"] as SubtitleLanguage[]);

  // Break long sentences into short cues so burned-in lines don't wrap into many
  // rows and collide with the stacked language above them.
  const displaySegments = splitSegmentsForDisplay(segments, activeLanguages);

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...activeLanguages.map((lang) => SUBTITLE_STYLES[lang].styleLine),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];

  for (const seg of displaySegments) {
    const start = formatAssTime(seg.startSecond);
    const end = formatAssTime(seg.endSecond);

    for (const lang of activeLanguages) {
      const style = SUBTITLE_STYLES[lang];
      const text = (seg[style.field] as string | undefined) ?? "";
      if (!text) continue;
      const cleanText = text.replace(/\\/g, "\\\\");
      lines.push(`Dialogue: 0,${start},${end},${style.name},,0,0,0,,${cleanText}`);
    }
  }

  return lines.join("\n");
}
