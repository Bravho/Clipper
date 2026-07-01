/**
 * Returns the Gemini API key or throws a clear setup error.
 * Prevents cryptic 403 PERMISSION_DENIED ("unregistered callers") responses
 * when GEMINI_API_KEY is missing from .env.local.
 */
export function requireGeminiApiKey(): string {
  const key = AI_CONFIG.gemini.apiKey;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add GEMINI_API_KEY=<your key> to .env.local and restart the dev server."
    );
  }
  return key;
}

export const AI_CONFIG = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    /** Vision model - used for image analysis + scene/script generation */
    visionModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash",
    /** Text model - used for lightweight text tasks */
    textModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash",
    scriptWordTarget: 45,
    scenesTarget: 3,
  },
  veo: {
    /**
     * Google Veo runs through the Gemini API, so it reuses the Gemini API key
     * by default. VEO_API_KEY can override it if a separate key is preferred.
     */
    apiKey: (process.env.VEO_API_KEY ?? process.env.GEMINI_API_KEY ?? "").trim(),
    /** Veo model id. Defaults to Veo 3.1 Fast so video extension is available. */
    modelName: process.env.VEO_MODEL_NAME ?? "veo-3.1-fast-generate-preview",
    /** "720p" | "1080p"; video extension is limited to 720p. */
    resolution: process.env.VEO_RESOLUTION ?? "720p",
    /** Fallback duration (seconds, one of 4/6/8) when a scene has no duration. */
    defaultDuration: process.env.VEO_DURATION ? Number(process.env.VEO_DURATION) : 8,
    /** Fallback aspect ratio ("16:9" | "9:16") used when none is supplied. */
    defaultAspectRatio: process.env.VEO_ASPECT_RATIO ?? "9:16",
    /** Optional global negative prompt applied to every generation. */
    negativePrompt: process.env.VEO_NEGATIVE_PROMPT ?? "",
  },
  elevenLabs: {
    // ElevenLabs cloud TTS — current pipeline voice engine. No local server.
    apiKey: (process.env.ELEVENLABS_API_KEY ?? "").trim(),
    // "Sarah" premade voice (free-tier API usable)
    voiceId: (process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL").trim(),
    // eleven_v3 is the only ElevenLabs model that supports Thai
    model: (process.env.ELEVENLABS_TTS_MODEL ?? "eleven_v3").trim(),
    // v3 stability presets: 0.0 = Creative, 0.5 = Natural, 1.0 = Robust
    stability: Number(process.env.ELEVENLABS_STABILITY ?? "0.0"),
    languageCode: "th",
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    // Overridable so the deployed model id / API version can be corrected
    // without a code change if the API rejects the default. The Phase-7
    // animation step logs the full 400 body, so a bad model id is diagnosable.
    model: (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6").trim(),
    apiVersion: (process.env.ANTHROPIC_VERSION ?? "2023-06-01").trim(),
  },
  ffmpeg: {
    path: process.env.FFMPEG_PATH ?? "ffmpeg",
    tmpDir: process.env.FFMPEG_TMP_DIR ?? "/tmp/clipper",
    /**
     * Path to a TTF/OTF font file with Thai glyph support, used by drawtext.
     * Required on Windows builds of ffmpeg where libfontconfig has no default
     * config file ("Fontconfig error: Cannot load default config file").
     * Specifying fontfile= bypasses fontconfig lookup entirely.
     */
    fontFile: process.env.FFMPEG_FONT_FILE ?? "C:\\Windows\\Fonts\\tahoma.ttf",
  },
  social: {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID ?? "",
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN ?? "",
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
      accessToken: process.env.TIKTOK_ACCESS_TOKEN ?? "",
    },
    instagram: {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
      pageId: process.env.INSTAGRAM_PAGE_ID ?? "",
    },
    facebook: {
      pageToken: process.env.FACEBOOK_PAGE_TOKEN ?? "",
      pageId: process.env.FACEBOOK_PAGE_ID ?? "",
    },
    tvent: {
      apiKey: process.env.TVENT_API_KEY ?? "",
      apiUrl: process.env.TVENT_API_URL ?? "",
    },
  },
};
