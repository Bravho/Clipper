import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";

const schema = z.object({
  jobId: z.string().min(1),
  backToStep: z.enum(["video", "voice", "composition"]),
});

export async function POST(req: NextRequest) {
  try {
    const staff = await requireRole(Role.Editor, Role.Admin);
    const body = schema.parse(await req.json());
    const job = await videoGenerationService.rejectFinalVideo(body.jobId, staff.id, body.backToStep);
    return NextResponse.json({ job }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
