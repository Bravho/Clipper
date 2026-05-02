import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { staffWorkflowService } from "@/services/staff/StaffWorkflowService";
import { z } from "zod";
import { EffortClass } from "@/domain/enums/EffortClass";

/**
 * POST /api/staff/requests/[id]/accept-editing
 *
 * Combined action: staff confirms due date and accepts the request for editing.
 * Both due date and effort class are REQUIRED — cannot accept without them.
 *
 * Body: {
 *   confirmedDate: "YYYY-MM-DD",  // required
 *   effortClass: EffortClass,     // required
 *   note?: string
 * }
 */
const schema = z.object({
  confirmedDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format."),
  effortClass: z.nativeEnum(EffortClass, {
    message: "Effort class is required (simple, standard, or complex).",
  }),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole(Role.Editor, Role.Admin);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message },
        { status: 400 }
      );
    }

    const confirmedDate = new Date(parsed.data.confirmedDate + "T00:00:00Z");

    const request = await staffWorkflowService.acceptAndStartEditing(
      params.id,
      user.id,
      confirmedDate,
      parsed.data.effortClass,
      parsed.data.note
    );

    return NextResponse.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
