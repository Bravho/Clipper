import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import { videoPublishingService } from "@/services/staff/VideoPublishingService";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);

    let job = await videoGenerationService.getCurrentJob(params.id);
    if (!job) return NextResponse.json({ job: null }, { status: 200 });

    // If Kling is running, poll for completion and advance step if ready
    if (job.currentStep === VideoGenerationStep.GeneratingBaseVideo) {
      job = await videoGenerationService.checkBaseVideoReady(job.id);
    }

    // Attach publish status if in publishing step
    let publishStatus = null;
    if (job.currentStep === VideoGenerationStep.Publishing || job.currentStep === VideoGenerationStep.Complete) {
      publishStatus = await videoPublishingService.getPublishStatus(job.id);
    }

    return NextResponse.json({ job, publishStatus }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
