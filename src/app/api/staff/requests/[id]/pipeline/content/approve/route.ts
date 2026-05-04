import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";

const schema = z.object({
  jobId: z.string().min(1),
  scenePlan: z.string().min(1),
  scriptThai: z.string().min(1),
  scriptEnglish: z.string().min(1),
  hookThai: z.string().min(1),
  hookEnglish: z.string().min(1),
  captionThai: z.string().min(1),
  captionEnglish: z.string().min(1),
  captionChinese: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const staff = await requireRole(Role.Editor, Role.Admin);
    const body = schema.parse(await req.json());

    const job = await videoGenerationService.approveContent(
      body.jobId,
      staff.id,
      {
        scenePlan: body.scenePlan,
        scriptThai: body.scriptThai,
        scriptEnglish: body.scriptEnglish,
        hookThai: body.hookThai,
        hookEnglish: body.hookEnglish,
        captionThai: body.captionThai,
        captionEnglish: body.captionEnglish,
        captionChinese: body.captionChinese,
      }
    );

    return NextResponse.json({ job }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
