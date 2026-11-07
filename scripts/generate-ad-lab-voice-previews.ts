/**
 * Generate static voice samples for the Ad Lab AI Avatar voice picker.
 *
 * Usage:
 *   npx tsx scripts/generate-ad-lab-voice-previews.ts            # skip existing files
 *   npx tsx scripts/generate-ad-lab-voice-previews.ts --force    # regenerate all
 *
 * Writes public/ad-lab/voice-previews/<slug>.mp3 for each AD_LAB_AVATAR_VOICES
 * entry. Each generated file is a paid ElevenLabs call.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const projectRoot = path.join(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env.local") });

const SAMPLE_TEXT = "สวัสดี นี่คือตัวอย่างเสียงของฉัน";
const force = process.argv.includes("--force");

async function main(): Promise<void> {
  // Loaded after dotenv so AI_CONFIG sees the ElevenLabs settings.
  const { AD_LAB_AVATAR_VOICES } = require("../src/config/elevenLabsVoices") as typeof import("../src/config/elevenLabsVoices");
  const { synthesizeSpeech } = require("../src/lib/ai/elevenLabsTtsService") as typeof import("../src/lib/ai/elevenLabsTtsService");

  const outDir = path.join(projectRoot, "public", "ad-lab", "voice-previews");
  fs.mkdirSync(outDir, { recursive: true });

  let failures = 0;
  for (const voice of AD_LAB_AVATAR_VOICES) {
    const outPath = path.join(outDir, `${voice.slug}.mp3`);
    if (!force && fs.existsSync(outPath)) {
      console.log(`[skip] ${voice.label} (${voice.id}): ${outPath} exists (use --force to regenerate)`);
      continue;
    }
    try {
      const audio = await synthesizeSpeech({ text: SAMPLE_TEXT, voiceId: voice.id });
      fs.writeFileSync(outPath, audio);
      console.log(`[ok] ${voice.label} (${voice.id}): ${outPath} ${audio.length} bytes`);
    } catch (error) {
      failures += 1;
      console.error(`[error] ${voice.label} (${voice.id}): ${String(error).slice(0, 500)}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

void main();
