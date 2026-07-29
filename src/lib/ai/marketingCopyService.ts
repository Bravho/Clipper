import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";
import type { AppLocale } from "@/i18n/config";

/**
 * Lightweight Gemini TEXT helper that translates the per-channel publishing copy
 * (title + caption) into the requester's active UI language.
 *
 * This deliberately does NOT re-run the expensive multimodal vision/content call
 * (`chatGptVisionService`) — the marketing copy already exists in Thai (and often
 * English) from that earlier step. When the distribution-review step needs the
 * copy in another header locale (e.g. Vietnamese, or English when it wasn't
 * pre-generated), we spend one small text-only call here instead.
 *
 * Fail-open by design: on any error (missing key, bad JSON, network) it returns
 * the source text unchanged so the distribution step never breaks over a
 * translation hiccup — the requester can still edit the copy by hand.
 */

const LANGUAGE_NAME: Record<AppLocale, string> = {
  th: "Thai",
  en: "English",
  vi: "Vietnamese",
};

export async function translateMarketingCopy(params: {
  caption: string;
  title?: string;
  targetLanguage: AppLocale;
}): Promise<{ caption: string; title: string }> {
  const caption = params.caption ?? "";
  const title = params.title ?? "";
  if (!caption.trim() && !title.trim()) return { caption, title };

  try {
    const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });

    const prompt = `You are localizing social-media post copy for a short-form promotional video.
Translate the TITLE and CAPTION below into ${LANGUAGE_NAME[params.targetLanguage]}.
Keep the tone natural, punchy and marketing-friendly for short-form video.
Preserve unchanged: #hashtags, @mentions, emojis, URLs, phone numbers, and brand/place names.
Do not add commentary or extra hashtags.

Return ONLY a valid JSON object of the form:
{ "title": "translated title", "caption": "translated caption" }

TITLE: "${title.replace(/"/g, '\\"')}"
CAPTION: "${caption.replace(/"/g, '\\"')}"`;

    const response = await ai.models.generateContent({
      model: AI_CONFIG.gemini.textModel,
      contents: [{ text: prompt }],
      config: { responseMimeType: "application/json", temperature: 0.3 },
    });

    const raw = response.text ?? "";
    if (!raw) return { caption, title };

    const parsed = JSON.parse(raw) as { title?: string; caption?: string };
    return {
      caption: (parsed.caption ?? "").trim() || caption,
      title: parsed.title != null ? String(parsed.title).trim() : title,
    };
  } catch (err) {
    console.error("[marketingCopy] translate failed:", err);
    return { caption, title };
  }
}
