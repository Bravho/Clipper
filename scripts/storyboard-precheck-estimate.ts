/**
 * storyboard-precheck-estimate.ts
 *
 * Builds the REAL Gemini prompt for a realistic sample LINE storyboard
 * (6-8 scenes, shop menu with ~10 items) WITHOUT calling Gemini and prints:
 *   - total prompt characters
 *   - estimated input tokens (chars / ~2.5 — Thai-heavy text heuristic)
 *   - configured STORYBOARD_AI_PRECHECK_MAX_OUTPUT_TOKENS (or default 1024)
 *
 * Token estimation method: divide character count by 2.5.
 * Thai script typically encodes 2-4 chars per SentencePiece/BPE token in
 * Gemini tokenisation; 2.5 is a conservative mid-range estimate appropriate
 * for mixed Thai/JSON content. countTokens() is NOT called (network call).
 *
 * Usage (no Gemini key needed):
 *   npx ts-node -e "require('./scripts/storyboard-precheck-estimate.ts')"
 *   node --loader ts-node/esm scripts/storyboard-precheck-estimate.ts
 *   ts-node scripts/storyboard-precheck-estimate.ts
 */

import { buildSceneEditPrompt, editParseConfig } from '../src/services/line/LineSceneEditService';

const SAMPLE_SCRIPT_THAI =
  'ต้องมาลอง! บุฟเฟ่ต์อาหารทะเลสดใหม่ ราคาเพียง 599 บาท ปู กุ้ง หอย ปลา ครบ ทุกเมนู ' +
  'เปิดทุกวัน 11.00–22.00 น. ชั้น 3 ห้างเซ็นทรัล ลาดพร้าว สำรองที่นั่งได้เลย!';

const SAMPLE_STORYBOARD = JSON.stringify([
  {
    sceneNumber: 1,
    summary: 'ภาพกว้างของบุฟเฟ่ต์อาหารทะเลเต็มรูปแบบ มีปู กุ้ง หอยนางรม วางอยู่บนน้ำแข็งสด',
    assetIndexes: [0],
    roughDurationHint: 8,
  },
  {
    sceneNumber: 2,
    summary: 'โคลสอัพปูม้านึ่งสด ควันกำลังขึ้น สีส้มสวยงาม',
    assetIndexes: [1],
    roughDurationHint: 7,
  },
  {
    sceneNumber: 3,
    summary: 'กุ้งแม่น้ำเผาขนาดใหญ่วางเรียงกันบนตะแกรง ราดด้วยซอสพริก',
    assetIndexes: [2],
    roughDurationHint: 8,
  },
  {
    sceneNumber: 4,
    summary: 'หอยนางรมสดขนาดใหญ่ ราดมะนาวพร้อมเสิร์ฟ ลูกค้าหยิบชิมด้วยสีหน้ายิ้มแย้ม',
    assetIndexes: [3],
    roughDurationHint: 8,
  },
  {
    sceneNumber: 5,
    summary: 'ภาพบรรยากาศร้านอาหาร โต๊ะเต็ม ครอบครัวนั่งรับประทานอย่างมีความสุข',
    assetIndexes: [4],
    roughDurationHint: 7,
  },
  {
    sceneNumber: 6,
    summary: 'ป้ายราคา 599 บาท/คน และเวลาเปิดปิดร้าน พร้อม QR Code จองโต๊ะ',
    assetIndexes: [5],
    roughDurationHint: 7,
  },
  {
    sceneNumber: 7,
    summary: 'สลัดผลไม้และของหวาน ไอศกรีม เค้ก วางอยู่ส่วนหนึ่งของบุฟเฟ่ต์',
    assetIndexes: [6],
    roughDurationHint: 7,
  },
  {
    sceneNumber: 8,
    summary: 'โลโก้ร้านและข้อความ CTA "จองโต๊ะได้เลย! โทร 02-xxx-xxxx"',
    assetIndexes: [7],
    roughDurationHint: 8,
  },
], null, 2);

// Matches buildPrecheckPrompt in StoryboardPrecheckService.ts
function buildPrompt(scriptThai: string, storyboardJson: string): string {
  return (
    'You are a LINE marketing video quality reviewer. Review this Thai storyboard and script for a short social media video.\n\n' +
    `Script (Thai):\n${scriptThai}\n\n` +
    `Storyboard (JSON):\n${storyboardJson}\n\n` +
    'Evaluate and return ONLY valid JSON with no markdown fences:\n' +
    '{"score": <0-100>, "issues": ["<short Thai issue 1>", ...], "pass": <true|false>}\n\n' +
    'Check:\n' +
    '- Brief coverage: does the script clearly cover the product/service?\n' +
    '- Hook: does scene 1 have a strong opening hook?\n' +
    '- Scene order: logical flow from hook to CTA?\n' +
    '- Thai typos: obvious spelling/tonal errors?\n\n' +
    'Pass when score >= 70 and no critical issues. Issues must be short Thai phrases. No PII.'
  );
}

const precheckPrompt = buildPrompt(SAMPLE_SCRIPT_THAI, SAMPLE_STORYBOARD);
const chars = precheckPrompt.length;
const CHARS_PER_TOKEN = 2.5; // Thai-heavy text heuristic (no network call)
const estimatedInputTokens = Math.ceil(chars / CHARS_PER_TOKEN);
const maxOutputTokens = Number(process.env.STORYBOARD_AI_PRECHECK_MAX_OUTPUT_TOKENS ?? '1024');

console.log('=== Storyboard Pre-review Gemini Token Estimate ===');
console.log(`Prompt characters   : ${chars}`);
console.log(`Estimation method   : chars / ${CHARS_PER_TOKEN} (Thai-heavy text heuristic)`);
console.log(`Est. input tokens   : ~${estimatedInputTokens}`);
console.log(`Max output tokens   : ${maxOutputTokens}  (STORYBOARD_AI_PRECHECK_MAX_OUTPUT_TOKENS or default 1024)`);
console.log('');
console.log('Sample storyboard   : 8 scenes, Thai script ~150 chars, menu with 10 items');
const editSample = { id: 'saved-storyboard-version', scenes: JSON.parse(SAMPLE_STORYBOARD).map((s: { sceneNumber: number; summary: string; assetIndexes: number[]; roughDurationHint: number }) => ({
  ...s, assetIds: ['00000000-0000-4000-8000-000000000001'], onScreenText: s.summary,
  voiceScript: 'อาหารทะเลสดใหม่ ปูนึ่ง กุ้งเผา พร้อมเสิร์ฟทุกวัน',
})) };
const editPrompt = buildSceneEditPrompt(editSample, 'ช่วยเพิ่มเวลาฉาก 2 เป็น 9 วินาที และสลับฉาก 3 กับฉาก 4', ['00000000-0000-4000-8000-000000000001']);
console.log(`LINE scene edit REAL prompt: chars=${editPrompt.length}; estimated input tokens=${Math.ceil(editPrompt.length / 2.5)} (chars/2.5 Thai-heavy heuristic); max output tokens=${editParseConfig().maxOutputTokens}`);
