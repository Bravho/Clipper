import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import { videoPublishingService } from "@/services/staff/VideoPublishingService";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);

    const job = await videoGenerationService.getCurrentJob(params.id);
    if (!job) return NextResponse.json({ status: null }, { status: 200 });

    const status = await videoPublishingService.getPublishStatus(job.id);
    return NextResponse.json({ status }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
