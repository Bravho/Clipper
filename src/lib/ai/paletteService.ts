import { AI_CONFIG, requireGeminiApiKey } from "@/config/aiTools";

/**
 * Brand/content-derived color palette for the decorative motion-graphics layer
 * (waves, triangles, blobs, sparkles) and the English text-graphic accents.
 *
 * Derived from the business profile (category, name) + the promo script, with a
 * deterministic category fallback so a render never blocks on the AI call.
 */
export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
}

/** Vibrant, food-promo-friendly default when nothing else is known. */
export const DEFAULT_PALETTE: Palette = {
  primary: "#FF6B35",
  secondary: "#FFB703",
  accent: "#06D6A0",
  neutral: "#FFFFFF",
};

/** Category → cohesive palette. Keys are matched as substrings (case-insensitive). */
const CATEGORY_PALETTES: Record<string, Palette> = {
  restaurant: { primary: "#E63946", secondary: "#F4A261", accent: "#FFD166", neutral: "#FFF8F0" },
  food: { primary: "#EF476F", secondary: "#FFD166", accent: "#06D6A0", neutral: "#FFF8F0" },
  cafe: { primary: "#A1683A", secondary: "#D7B899", accent: "#E9C46A", neutral: "#FFFDF7" },
  coffee: { primary: "#6F4E37", secondary: "#C8A27C", accent: "#E9C46A", neutral: "#FFFDF7" },
  dessert: { primary: "#FF7AA2", secondary: "#FFC2D1", accent: "#FFE066", neutral: "#FFF7FA" },
  bar: { primary: "#7209B7", secondary: "#F72585", accent: "#4CC9F0", neutral: "#FBF7FF" },
  spa: { primary: "#2A9D8F", secondary: "#83C5BE", accent: "#E9C46A", neutral: "#F4FBFA" },
  hotel: { primary: "#264653", secondary: "#2A9D8F", accent: "#E9C46A", neutral: "#F7F9FA" },
};

function fallbackByCategory(category?: string | null): Palette {
  if (!category) return DEFAULT_PALETTE;
  const key = category.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_PALETTES)) {
    if (key.includes(k)) return v;
  }
  return DEFAULT_PALETTE;
}

function validHex(s: unknown): string | null {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s.trim()) ? s.trim() : null;
}

/**
 * Derive a cohesive 4-color palette from the business + script. Uses Gemini
 * (graceful — any failure falls back to the category/default palette).
 */
export async function derivePalette(params: {
  businessName?: string | null;
  category?: string | null;
  scriptEnglish?: string | null;
  scriptThai?: string | null;
}): Promise<Palette> {
  const fallback = fallbackByCategory(params.category);

  try {
    const apiKey = requireGeminiApiKey();
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const script = (params.scriptEnglish || params.scriptThai || "").slice(0, 600);
    const prompt = `You are a brand color designer for short-form food/restaurant promo videos.
Choose a cohesive, vibrant 4-color palette for animated motion-graphic decorations (waves,
triangles, blobs, sparkles) that sit OVER real food video — colors must be lively and read
clearly over busy footage (avoid muddy/low-contrast colors and avoid pure black).

Business name: "${params.businessName ?? "(unknown)"}"
Category: "${params.category ?? "(unknown)"}"
Promo script: "${script}"

Return ONLY JSON: { "primary": "#RRGGBB", "secondary": "#RRGGBB", "accent": "#RRGGBB", "neutral": "#RRGGBB" }`;

    const res = await ai.models.generateContent({
      model: AI_CONFIG.gemini.textModel,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.4 },
    });

    const parsed = JSON.parse(res.text ?? "{}");
    return {
      primary: validHex(parsed.primary) ?? fallback.primary,
      secondary: validHex(parsed.secondary) ?? fallback.secondary,
      accent: validHex(parsed.accent) ?? fallback.accent,
      neutral: validHex(parsed.neutral) ?? fallback.neutral,
    };
  } catch (err) {
    console.error("[paletteService] palette derivation failed, using fallback:", err);
    return fallback;
  }
}
