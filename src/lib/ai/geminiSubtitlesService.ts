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

  for (const seg of segments) {
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
