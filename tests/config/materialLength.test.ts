import {
  materialAllowanceSeconds,
  materialSeconds,
  maxVoiceSecondsForMaterial,
  PHOTO_MATERIAL_SECONDS,
  scriptTargetSeconds,
  voiceFitsMaterial,
} from "@/config/materialLength";
import {
  materialSecondsOfDescriptors,
  speakingScriptSeconds,
} from "@/services/VideoGenerationService";

describe("material length", () => {
  it("adds clip lengths and counts each photo as 3 s", () => {
    expect(PHOTO_MATERIAL_SECONDS).toBe(3);
    expect(
      materialSeconds([
        { isClip: true, durationSeconds: 12.34 },
        { isClip: true, durationSeconds: 8 },
        { isClip: false },
        { isClip: false, durationSeconds: null },
      ])
    ).toBe(26.3);
  });

  it("ignores a clip with no known length", () => {
    expect(materialSeconds([{ isClip: true, durationSeconds: null }])).toBe(0);
  });

  it("allows 5% of the material, never less than 2 s", () => {
    expect(materialAllowanceSeconds(20)).toBe(2);
    expect(materialAllowanceSeconds(60)).toBe(3);
    expect(maxVoiceSecondsForMaterial(35)).toBe(33);
    expect(maxVoiceSecondsForMaterial(60)).toBe(57);
    expect(maxVoiceSecondsForMaterial(1)).toBe(0);
  });

  it("writes the script for the voice limit, within 5 s and the video cap", () => {
    expect(scriptTargetSeconds(35, 90)).toBe(33);
    expect(scriptTargetSeconds(200, 90)).toBe(90);
    expect(scriptTargetSeconds(3, 90)).toBe(5);
  });

  it("accepts a voice up to the limit and refuses one past it", () => {
    expect(voiceFitsMaterial(33, 35)).toBe(true);
    expect(voiceFitsMaterial(33.2, 35)).toBe(false);
  });
});

describe("server script length", () => {
  const clip = (seconds: number) => ({
    localId: `c${seconds}`,
    fileName: "a.mp4",
    mimeType: "video/mp4" as const,
    fileSizeBytes: 10,
    durationSeconds: seconds,
  });
  const photo = {
    localId: "p",
    fileName: "a.jpg",
    mimeType: "image/jpeg" as const,
    fileSizeBytes: 10,
    durationSeconds: null,
  };

  it("sizes a studio request's script to its material, not the brief", () => {
    expect(materialSecondsOfDescriptors([clip(10), clip(20), photo])).toBe(33);
    expect(speakingScriptSeconds({ durationSeconds: 60 }, [clip(10), clip(20), photo])).toBe(31);
  });

  it("keeps the brief's length for a request without material", () => {
    expect(speakingScriptSeconds({ durationSeconds: 45 }, undefined)).toBe(45);
    expect(speakingScriptSeconds(null, [])).toBe(15);
  });
});
