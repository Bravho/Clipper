import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import {
  evaluateMontageCoverage,
  sceneMontageSeconds,
} from "@/config/montage";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest || clipRequest.userId !== session.user.id) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const jobId = body?.jobId;
  const scenePlan = body?.scenePlan as ScenePlan[] | undefined;
  const durationSeconds = Number(body?.durationSeconds);

  if (!jobId || !Array.isArray(scenePlan) || scenePlan.length === 0) {
    return NextResponse.json({ error: "Missing scene design fields." }, { status: 400 });
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 5 || durationSeconds > 30) {
    return NextResponse.json({ error: "Invalid durationSeconds." }, { status: 400 });
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Use the same strict coverage rule as the later merge approval so a plan that
  // passes here cannot be rejected at the next step or require black padding.
  const totalSceneSeconds = scenePlan.reduce((sum, s) => sum + sceneMontageSeconds(s), 0);
  const coverage = evaluateMontageCoverage({
    voiceDurationSeconds: job.voiceDurationSeconds,
    totalSceneSeconds,
  });
  if (!coverage.isCovered) {
    return NextResponse.json(
      {
        error: `ความยาววิดีโอรวมต้องอย่างน้อย ${Math.ceil(coverage.requiredVisualSeconds * 10) / 10} วินาที เพื่อคลุมเสียงพากย์โดยไม่มีช่วงจอดำ`,
      },
      { status: 422 }
    );
  }

  try {
    const updated = await videoGenerationService.approveSceneDesignByRequester(
      jobId,
      session.user.id,
      {
        scenePlan: JSON.stringify(scenePlan),
        durationSeconds,
      }
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve scene design.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
