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
  kling: {
    apiKey: process.env.KLING_API_KEY ?? "",
    apiSecret: process.env.KLING_API_SECRET ?? "",
    baseUrl: "https://api.klingai.com",
    /** e.g. "kling-v3-omni-std", "kling-v1-6", "kling-v2-1-master". KLING_MODEL kept for back-compat. */
    modelName: process.env.KLING_MODEL_NAME ?? process.env.KLING_MODEL,
    /** "std" | "pro" — only meaningful for models that support a mode/tier. */
    mode: process.env.KLING_MODE,
    /** Fallback duration (seconds) used only if a request has no durationSeconds. */
    defaultDuration: process.env.KLING_DURATION ? Number(process.env.KLING_DURATION) : undefined,
    /** Fallback aspect ratio used only if a request has no aspectRatio. */
    defaultAspectRatio: process.env.KLING_ASPECT_RATIO,
    /** "on" | "off" — generate native audio (kling-v3 models only). */
    sound: process.env.KLING_SOUND,
    /** Keep the original audio track from the source image/video, if any. */
    keepOriginalSound: process.env.KLING_KEEP_ORIGINAL_SOUND === "true",
    /** Whether Kling should burn its watermark into the output. */
    watermark: process.env.KLING_WATERMARK === "true",
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
    model: "claude-sonnet-4-6",
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
