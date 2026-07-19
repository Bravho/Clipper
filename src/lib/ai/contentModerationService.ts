import { GoogleGenAI } from "@google/genai";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";
import { extractVideoFrames, framesForDuration } from "@/lib/ai/videoFrames";

/**
 * Phase 8 — pre-publishing content moderation.
 *
 * Before a channel's post goes out, the caption/title/hashtags AND a few sampled
 * still frames of the distribution video are screened by Gemini for anything that
 * would make the post unsafe or non-compliant: law violations, inappropriate or
 * offensive wording, nudity/sexual content, violence/gore, or personal-privacy
 * violations (visible ID cards, license plates, phone numbers, other people's
 * faces used without consent, etc.).
 *
 * We deliberately DO NOT send the whole video — only duration-scaled sample
 * frames (1 for ≤15s, 2 for ≤30s, 3 for >30s; see {@link framesForDuration}),
 * which is enough for a visual safety pass at a fraction of the token cost.
 *
 * Fail closed when moderation cannot reach a reliable verdict. Infrastructure or
 * malformed-response failures require staff review rather than allowing an
 * unreviewed public post.
 */

export interface ModerationResult {
  /** true → safe to publish; false → blocked, show `reason` to the user. */
  approved: boolean;
  /** Thai-language explanation shown to the requester when blocked. */
  reason: string | null;
  /** Machine-ish category tags for the violations found (for logging/analytics). */
  violations: string[];
  /** How many video frames were actually screened (0 when none available). */
  framesChecked: number;
}

interface ModerateParams {
  /** Spaces storage key of the exact captioned export being published. */
  videoStorageKey?: string | null;
  /** Human-readable channel name, e.g. "TikTok" (used in the prompt + message). */
  platformLabel: string;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
}

/** Download a Spaces object into a Buffer. */
async function downloadBuffer(storageKey: string): Promise<Buffer> {
  const res = await spacesClient.send(
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: storageKey })
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Screen one channel's post (text + sampled video frames) for policy violations.
 * Never throws — infrastructure failures resolve to `approved: false`.
 */
export async function moderatePublishingContent(
  params: ModerateParams
): Promise<ModerationResult> {
  const { platformLabel, title, caption, hashtags } = params;
  const apiKey = AI_CONFIG.gemini.apiKey;

  // No key → cannot establish safety, so require manual review.
  if (!apiKey) {
    console.warn(
      "[contentModeration] GEMINI_API_KEY not set — publishing blocked."
    );
    return {
      approved: false,
      reason: "ระบบตรวจสอบเนื้อหาไม่พร้อมใช้งาน กรุณาให้ทีมงานตรวจสอบก่อนเผยแพร่",
      violations: ["moderation_unavailable"],
      framesChecked: 0,
    };
  }

  // Sample the distribution video's frames (best-effort — text-only if it fails).
  let frames: { data: string; mimeType: "image/jpeg" }[] = [];
  if (params.videoStorageKey) {
    try {
      const buffer = await downloadBuffer(params.videoStorageKey);
      frames = await extractVideoFrames(buffer);
    } catch (err) {
      console.error("[contentModeration] frame sampling failed:", err);
    }
  }

  const hashtagLine = (hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  const textBlock = [
    title ? `TITLE: ${title}` : null,
    caption ? `CAPTION: ${caption}` : null,
    hashtagLine ? `HASHTAGS: ${hashtagLine}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a strict pre-publishing content-safety reviewer for a marketing platform that publishes short promotional videos for local businesses to public social channels (this post targets ${platformLabel}).

Review BOTH the post text below AND the attached still frames sampled from the video that will be published. Decide whether this post is safe and lawful to publish publicly.

Reject (approved=false) if the text OR any frame contains any of:
- Illegal content or clear law violations (e.g. drugs, weapons sales, counterfeit goods, gambling where prohibited, unlicensed alcohol/tobacco promotion, misleading health/medical or financial claims).
- Inappropriate, offensive, hateful, harassing, discriminatory, or profane wording.
- Nudity, sexual or sexually suggestive content.
- Violence, gore, blood, weapons used threateningly, or graphic injury.
- Personal-privacy violations: readable ID cards/passports, license plates, phone numbers, home addresses, credit-card numbers, or identifiable non-consenting individuals used for promotion.
- Any other content clearly unsuitable for a public brand post.

Otherwise approve (approved=true).

POST TEXT:
${textBlock || "(no text provided)"}

Respond with ONLY a valid JSON object of this exact shape:
{
  "approved": boolean,
  "violations": string[],   // short category tags, empty when approved
  "reason": string          // if rejected: ONE clear sentence in THAI explaining what was found and why it was blocked; if approved: empty string ""
}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = [
      ...frames.map((f) => ({ inlineData: { data: f.data, mimeType: f.mimeType } })),
      { text: prompt },
    ];

    const response = await ai.models.generateContent({
      model: AI_CONFIG.gemini.visionModel,
      contents,
      config: { responseMimeType: "application/json", temperature: 0 },
    });

    const raw = response.text ?? "";
    if (!raw) {
      console.warn("[contentModeration] empty model response — publishing blocked.");
      return {
        approved: false,
        reason: "ไม่สามารถยืนยันความปลอดภัยของเนื้อหาได้ กรุณาให้ทีมงานตรวจสอบ",
        violations: ["moderation_inconclusive"],
        framesChecked: frames.length,
      };
    }

    const parsed = JSON.parse(raw) as {
      approved?: boolean;
      violations?: string[];
      reason?: string;
    };

    const approved = parsed.approved === true;
    return {
      approved,
      reason: approved
        ? null
        : parsed.reason?.trim() ||
          "เนื้อหานี้ไม่ผ่านการตรวจสอบความเหมาะสม จึงไม่สามารถเผยแพร่ได้",
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      framesChecked: frames.length,
    };
  } catch (err) {
    console.error("[contentModeration] moderation call failed — publishing blocked:", err);
    return {
      approved: false,
      reason: "ระบบตรวจสอบเนื้อหาขัดข้อง กรุณาให้ทีมงานตรวจสอบก่อนเผยแพร่",
      violations: ["moderation_error"],
      framesChecked: frames.length,
    };
  }
}
