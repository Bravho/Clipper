import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import { videoPublishingService } from "@/services/staff/VideoPublishingService";
import { Platform } from "@/domain/enums/Platform";

const VALID_PLATFORMS = Object.values(Platform) as string[];

const schema = z.object({
  jobId: z.string().min(1),
  caption: z.string().min(1).max(2200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; platform: string } }
) {
  try {
    const staff = await requireRole(Role.Editor, Role.Admin);
    const body = schema.parse(await req.json());

    if (!VALID_PLATFORMS.includes(params.platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const platform = params.platform as Platform;
    const record = await videoPublishingService.publishToPlatform(
      body.jobId,
      staff.id,
      platform,
      body.caption
    );

    return NextResponse.json({ record }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
