import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/authOptions";
import { clipRequestService } from "@/services/ClipRequestService";
import { pool } from "@/lib/db";

const reportSchema = z.object({
  reportType: z.enum(["feedback", "safety"]),
  reason: z.enum([
    "unsafe",
    "sexual",
    "violent",
    "hate",
    "privacy",
    "impersonation",
    "copyright",
    "misleading",
    "other",
    "video_quality",
    "scene_selection",
    "motion_direction",
    "audio_music",
    "subtitles",
    "aspect_ratio",
    "other_feedback",
  ]),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  details: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  const feedbackReasons = new Set([
    "video_quality", "scene_selection", "motion_direction", "audio_music",
    "subtitles", "aspect_ratio", "other_feedback",
  ]);
  if ((value.reportType === "feedback") !== feedbackReasons.has(value.reason)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reason does not match report type." });
  }
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const { id } = await params;
  try {
    await clipRequestService.getOwnedRequest(id, session.user.id);
  } catch {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report." }, { status: 422 });
  }
  await pool.query(
    `INSERT INTO ai_content_reports
       (user_id, request_id, report_type, reason, rating, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      session.user.id,
      id,
      parsed.data.reportType,
      parsed.data.reason,
      parsed.data.reportType === "feedback" ? parsed.data.rating ?? null : null,
      parsed.data.details || null,
    ]
  );
  return NextResponse.json({ ok: true }, { status: 201 });
}
