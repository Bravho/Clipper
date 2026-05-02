import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { getCurrentUser } from "@/lib/auth/helpers";
import { staffUploadService } from "@/services/staff/StaffUploadService";
import { z } from "zod";

const schema = z.object({
  assetId: z.string().trim().min(1),
});

/**
 * POST /api/staff/requests/[id]/clip-upload/confirm
 *
 * Step 2 of the edited clip upload flow.
 * Confirms the upload: copies from tmp/ to clips/ and marks the asset as Uploaded.
 */
export async function POST(
  req: NextRequest,
  { params: _params }: { params: { id: string } }
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

    const asset = await staffUploadService.confirmClipUpload(parsed.data.assetId, user.id);
    return NextResponse.json({ asset });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
