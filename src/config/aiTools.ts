export const AI_CONFIG = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    /** Vision model — used for image analysis + scene/script generation */
    visionModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.0-flash",
    /** Text model — used for lightweight text tasks */
    textModel: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.0-flash",
    scriptWordTarget: 45,
    scenesTarget: 3,
  },
  kling: {
    apiKey: process.env.KLING_API_KEY ?? "",
    apiSecret: process.env.KLING_API_SECRET ?? "",
    baseUrl: "https://api.klingai.com",
    model: process.env.KLING_MODEL,
    mode: process.env.KLING_MODE,
  },
  rvc: {
    // Prefer the Cloudflare tunnel URL — reachable from both the browser and the Next.js server
    // even when the RVC Mac Mini binds only to localhost. Fall back to the LAN IP when the
    // server is bound to 0.0.0.0 and Next.js is on the same subnet.
    serverUrl: (
      (process.env.NEXT_PUBLIC_RVC_SERVER_URL ?? "").trim() ||
      (process.env.RVC_SERVER_URL ?? "").trim()
    ),
    defaultVoiceModel: (process.env.RVC_DEFAULT_VOICE_MODEL ?? "mind_model").trim(),
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: "claude-sonnet-4-6",
  },
  ffmpeg: {
    path: process.env.FFMPEG_PATH ?? "ffmpeg",
    tmpDir: process.env.FFMPEG_TMP_DIR ?? "/tmp/clipper",
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
