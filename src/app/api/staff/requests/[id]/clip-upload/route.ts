import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { getCurrentUser } from "@/lib/auth/helpers";
import { staffUploadService } from "@/services/staff/StaffUploadService";
import { z } from "zod";

const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(1),
});

/**
 * POST /api/staff/requests/[id]/clip-upload
 *
 * Step 1 of the edited clip upload flow.
 * Returns a presigned PUT URL. The client uploads directly to DO Spaces.
 * Call /clip-upload/confirm after the PUT succeeds.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }

    const result = await staffUploadService.createPresignedClipUpload({
      requestId: params.id,
      staffId: user.id,
      fileName: parsed.data.fileName,
      fileSizeBytes: parsed.data.fileSizeBytes,
      mimeType: parsed.data.mimeType,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
