import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { adminUserService } from "@/services/admin/AdminUserService";
import { createEditorSchema } from "@/features/admin/validation/adminActionSchemas";

/**
 * POST /api/admin/users
 * Provision a new editor account.
 * Admin only.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole(Role.Admin);
    const body = await req.json();
    const parsed = createEditorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message },
        { status: 400 }
      );
    }
    const user = await adminUserService.createEditorAccount(parsed.data);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
