import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdLabUser } from "../../_guard";
import { avatarService } from "../_service";
import { avatarErrorResponse } from "../_avatarGuard";
import { HEYGEN_ASPECT_RATIOS } from "@/config/heygenAspectRatios";

export const dynamic = "force-dynamic";

const ASSET_ID = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/, "Invalid asset id.");
const LOOK_ID = z.string().trim().min(1).max(255);

const audioBodySchema = z.object({
  mode: z.literal("audio").optional(),
  kind: z.enum(["test", "production"]).optional(),
  draftId: z.string().trim().min(1).max(255),
  audioAssetId: ASSET_ID,
  assetToken: z.string().trim().min(1).max(128),
  lookId: LOOK_ID,
  idempotencyKey: z.string().trim().min(8).max(255),
  voiceChars: z.number().int().positive().optional(),
  aspectRatio: z.enum(HEYGEN_ASPECT_RATIOS).optional(),
  // Validated strictly (allowlists/ranges) and filtered per engine/mode in the service.
  settings: z.unknown().optional(),
  confirmCost: z.literal(true, {
    errorMap: () => ({ message: "confirmCost must be true (confirm the cost first)." }),
  }),
});

const ttsBodySchema = z.object({
  mode: z.literal("tts"),
  kind: z.enum(["test", "production"]),
  draftId: z.string().trim().min(1).max(255),
  script: z.string().trim().min(1).max(5000),
  aspectRatio: z.enum(HEYGEN_ASPECT_RATIOS).optional(),
  // Validated strictly (allowlists/ranges) and filtered per engine/mode in the service.
  settings: z.unknown().optional(),
  lookId: LOOK_ID,
  idempotencyKey: z.string().trim().min(8).max(255),
  confirmCost: z.literal(true, {
    errorMap: () => ({ message: "confirmCost must be true (confirm the cost first)." }),
  }),
});

const deleteBodySchema = z.object({
  draftId: z.string().trim().min(1).max(255),
  videoKey: z.string().trim().min(1).max(1024),
});

/**
 * POST /api/ad-lab/avatar/video
 * mode "audio" (default): submit Avatar V job with ElevenLabs audio asset.
 * mode "tts": submit Avatar V job using HeyGen TTS (server resolves defaultVoiceId from look).
 */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try { raw = await request.json(); } catch { raw = null; }

  const modeHint = (raw as Record<string, unknown> | null)?.mode;

  if (modeHint === "tts") {
    const parsed = ttsBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    try {
      return NextResponse.json(
        await avatarService.createTtsVideo(guard.user.id, {
          draftId: parsed.data.draftId,
          lookId: parsed.data.lookId,
          script: parsed.data.script,
          idempotencyKey: parsed.data.idempotencyKey,
          kind: parsed.data.kind,
          aspectRatio: parsed.data.aspectRatio,
          settings: parsed.data.settings,
        })
      );
    } catch (err) {
      return avatarErrorResponse("POST /api/ad-lab/avatar/video (tts)", err);
    }
  }

  // audio mode (default)
  const parsed = audioBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await avatarService.createVideo(guard.user.id, {
        draftId: parsed.data.draftId,
        audioAssetId: parsed.data.audioAssetId,
        assetToken: parsed.data.assetToken,
        lookId: parsed.data.lookId,
        idempotencyKey: parsed.data.idempotencyKey,
        voiceChars: parsed.data.voiceChars,
        aspectRatio: parsed.data.aspectRatio,
        settings: parsed.data.settings,
      })
    );
  } catch (err) {
    return avatarErrorResponse("POST /api/ad-lab/avatar/video", err);
  }
}

/**
 * DELETE /api/ad-lab/avatar/video
 * Deletes a single Spaces object whose key belongs to the caller's avatar prefix.
 * Does NOT modify the workspace — the client removes the entry from videos[].
 */
export async function DELETE(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;

  let raw: unknown;
  try { raw = await request.json(); } catch { raw = null; }

  const parsed = deleteBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    await avatarService.deleteVideoFile(guard.user.id, {
      draftId: parsed.data.draftId,
      videoKey: parsed.data.videoKey,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return avatarErrorResponse("DELETE /api/ad-lab/avatar/video", err);
  }
}
