import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";
import { spacesClient } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs/promises";
import * as path from "path";

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
 * Align vocal audio track with scripts using Gemini 2.0 Flash Audio capability.
 */
export async function alignAudioWithScript(params: {
  audioUrl: string;
  scriptThai: string;
  scriptEnglish: string;
  scriptChinese?: string;
  durationSeconds: number;
}): Promise<TimedSegment[]> {
  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });

  // Download vocal file and encode as base64
  const { data, mimeType } = await downloadAsBase64(params.audioUrl);

  const prompt = `Listen carefully to this spoken vocal track and align it word-for-word/sentence-for-sentence with the script segments provided below.
  Determine the exact starting and ending times (in seconds, e.g. 1.25) for each sentence segment.
  The audio file is exactly ${params.durationSeconds} seconds long.

  Thai Script: "${params.scriptThai}"
  English Translation: "${params.scriptEnglish}"
  ${params.scriptChinese ? `Chinese (Simplified) Translation: "${params.scriptChinese}"` : "Also translate each sentence into Simplified Chinese yourself."}

  Return ONLY a valid JSON object matching the schema below:
  {
    "segments": [
      {
        "sentenceNumber": 1,
        "textThai": "Thai sentence string",
        "textEnglish": "English sentence string",
        "textChinese": "Simplified Chinese sentence string",
        "startSecond": number,
        "endSecond": number
      }
    ]
  }`;

  const contents = [
    { inlineData: { data, mimeType } },
    { text: prompt }
  ];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.gemini.textModel, // "gemini-2.0-flash"
    contents,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const raw = response.text ?? "";
  if (!raw) throw new Error("Gemini audio alignment returned empty response");

  const parsed = JSON.parse(raw);
  return parsed.segments as TimedSegment[];
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
function splitTextIntoParts(text: string, n: number, lang: SubtitleLanguage): string[] {
  const trimmed = text.trim();
  if (n <= 1) return [trimmed];
  const { units, joiner } = tokenizeForDisplay(trimmed, lang);
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
  languages: SubtitleLanguage[] = ["en", "zh"]
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
      th: splitTextIntoParts(textByLang.th, cueCount, "th"),
      en: splitTextIntoParts(textByLang.en, cueCount, "en"),
      zh: splitTextIntoParts(textByLang.zh, cueCount, "zh"),
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
 * Defaults to English + Simplified Chinese, matching the Tvent App
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
