/**
 * Phase 6 — pure-helper tests for dynamic compose duration + voice-aware music
 * ducking. These cover the logic that decides the export length and builds the
 * sidechain-compression filter chain, without spawning FFmpeg.
 *
 * The heavy module-load dependencies of ffmpegService (Spaces/S3 client, config)
 * are mocked so importing the module is side-effect free.
 */

jest.mock("@/lib/spaces", () => ({
  spacesClient: {},
  spacesPublicUrl: (k: string) => `https://cdn.example.com/${k}`,
}));
jest.mock("@/config/aiTools", () => ({
  AI_CONFIG: { ffmpeg: { path: "ffmpeg" } },
}));
jest.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {},
  PutObjectCommand: class {},
}));
jest.mock("@/lib/spacesKeys", () => ({
  buildFinalClipKey: (...parts: string[]) => parts.join("/"),
}));

import {
  resolveComposeDuration,
  buildMusicMixFilters,
  DEFAULT_COMPOSE_DURATION_SECONDS,
  MUSIC_BED_VOLUME,
} from "@/lib/ai/ffmpegService";

describe("resolveComposeDuration", () => {
  it("returns the probed duration when it is a positive finite number", () => {
    expect(resolveComposeDuration(23.4)).toBe(23.4);
    expect(resolveComposeDuration(0.5)).toBe(0.5);
  });

  it("falls back to the default for missing / zero / negative / NaN inputs", () => {
    expect(resolveComposeDuration(undefined)).toBe(DEFAULT_COMPOSE_DURATION_SECONDS);
    expect(resolveComposeDuration(0)).toBe(DEFAULT_COMPOSE_DURATION_SECONDS);
    expect(resolveComposeDuration(-3)).toBe(DEFAULT_COMPOSE_DURATION_SECONDS);
    expect(resolveComposeDuration(NaN)).toBe(DEFAULT_COMPOSE_DURATION_SECONDS);
    expect(resolveComposeDuration(Infinity)).toBe(DEFAULT_COMPOSE_DURATION_SECONDS);
  });
});

describe("buildMusicMixFilters", () => {
  it("trims the looped music to the full clip length (not a hardcoded 15s)", () => {
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 32.5, leadInSeconds: 0 });
    const musicLine = filters.find((f) => f.includes("aloop"))!;
    expect(musicLine).toContain("atrim=0:32.500");
    expect(musicLine).not.toContain("atrim=0:15");
    expect(musicLine).toContain(`volume=${MUSIC_BED_VOLUME}`);
  });

  it("trims the music to the FULL clip length regardless of the lead-in (music covers intro + ending)", () => {
    // totalDurationSeconds is the whole clip (voice + intro + ending), so the
    // lead-in is already included — it must NOT be added again.
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 20.6, leadInSeconds: 0.6 });
    const musicLine = filters.find((f) => f.includes("aloop"))!;
    expect(musicLine).toContain("atrim=0:20.600");
  });

  it("delays the voice (and its sidechain key) by the lead-in so the clip opens on music", () => {
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 20, leadInSeconds: 0.6 });
    // 0.6s = 600ms, applied to all channels before the asplit feeds [sc]+[voice].
    expect(filters[0]).toContain("adelay=600:all=1");
    expect(filters[0]).toContain("asplit=2[sc][voice]");
  });

  it("references the given music + voice input indices", () => {
    const filters = buildMusicMixFilters({
      voiceInputIdx: 1,
      musicInputIdx: 3,
      totalDurationSeconds: 10,
    });
    expect(filters[0]).toContain("[1:a]loudnorm");
    expect(filters.some((f) => f.startsWith("[3:a]aloop"))).toBe(true);
  });

  it("ducks gently + quick-recover (fast attack/release, moderate ratio so the bed stays audible)", () => {
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 20 });
    const duck = filters.find((f) => f.includes("sidechaincompress"))!;
    expect(duck).toContain("attack=20");
    expect(duck).toContain("release=300");
    expect(duck).toContain("ratio=4");
    // Sanity: the slow legacy release + harsh ratio must be gone.
    expect(duck).not.toContain("release=1500");
    expect(duck).not.toContain("ratio=8");
  });

  it("exposes the final mix on [aout]", () => {
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 20 });
    expect(filters[filters.length - 1]).toContain("[aout]");
  });

  it("falls back to the default duration when given a bad value", () => {
    const filters = buildMusicMixFilters({ musicInputIdx: 2, totalDurationSeconds: 0, leadInSeconds: 0 });
    const musicLine = filters.find((f) => f.includes("aloop"))!;
    expect(musicLine).toContain(`atrim=0:${DEFAULT_COMPOSE_DURATION_SECONDS.toFixed(3)}`);
  });
});
