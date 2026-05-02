import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { dueDateConfirmationService } from "@/services/staff/DueDateConfirmationService";
import {
  confirmDueDateSchema,
  updateEffortClassSchema,
} from "@/features/staff/validation/staffActionSchemas";

/**
 * POST /api/staff/requests/[id]/due-date
 * Confirm the due date for a request.
 *
 * Body: { confirmedDate: "YYYY-MM-DD", note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = confirmDueDateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const confirmedDate = new Date(parsed.data.confirmedDate + "T00:00:00Z");
    const request = await dueDateConfirmationService.confirmDueDate(
      params.id,
      confirmedDate,
      parsed.data.note
    );
    return NextResponse.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PATCH /api/staff/requests/[id]/due-date
 * Update the effort class (resets due date confirmation).
 *
 * Body: { effortClass: EffortClass }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = updateEffortClassSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const request = await dueDateConfirmationService.updateEffortClass(
      params.id,
      parsed.data.effortClass
    );
    return NextResponse.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
