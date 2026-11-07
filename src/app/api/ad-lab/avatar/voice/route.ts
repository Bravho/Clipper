import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";
import {
  isValidSpeedId,
  isValidToneId,
  type AdLabVoiceSpeedId,
  type AdLabVoiceToneId,
} from "@/config/adLabVoiceOptions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  draftId: z.string().trim().min(1).max(255),
  voiceId: z.string().trim().min(1).max(255),
  speedId: z.string().optional(),
  toneId: z.string().optional(),
  confirmCost: z.literal(true, {
    errorMap: () => ({ message: "confirmCost ต้องเป็น true (ยืนยันค่าใช้จ่ายก่อน)" }),
  }),
});

/** POST /api/ad-lab/avatar/voice — synthesize ElevenLabs voice and upload to Spaces. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { draftId, voiceId, speedId, toneId } = parsed.data;

  if (speedId !== undefined && !isValidSpeedId(speedId)) {
    return NextResponse.json(
      { error: "invalid_voice_settings", reason: `speedId "${speedId}" ไม่รองรับ` },
      { status: 400 }
    );
  }
  if (toneId !== undefined && !isValidToneId(toneId)) {
    return NextResponse.json(
      { error: "invalid_voice_settings", reason: `toneId "${toneId}" ไม่รองรับ` },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await avatarService.generateVoice(guard.user.id, {
        draftId,
        voiceId,
        speedId: speedId as AdLabVoiceSpeedId | undefined,
        toneId: toneId as AdLabVoiceToneId | undefined,
      })
    );
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/voice", err);
  }
}
